/**
 * NearbyMeshTransport over the nearby-ble native module.
 *
 * Everything protocol-shaped lives here rather than in Swift or Kotlin, so the
 * two platforms cannot disagree about validation, fragmentation, dedup or hop
 * limits. The native side moves opaque frames and nothing else.
 */

import {
  NearbyBle,
  type FrameReceivedEvent,
  type NativePeer,
  type PeersChangedEvent,
  type StateChangedEvent,
} from '../../modules/nearby-ble';
import { fromBase64, toBase64 } from '../crypto/base64';
import {
  decodeEnvelope,
  encodeEnvelope,
  type RoomSecret,
} from './EnvelopeCodec';
import { FragmentAssembler, fragment } from './Fragmentation';
import type { MeshEnvelope, MeshStatus, PeerPresence } from './MeshEnvelope';
import {
  TransportUnavailableError,
  type AckListener,
  type EnvelopeListener,
  type NearbyMeshTransport,
  type PeerListener,
  type TransportBlocker,
  type Unsubscribe,
} from './NearbyMeshTransport';

/**
 * Envelope type carrying a persistence acknowledgement back to a sender.
 * Sent as a normal signed envelope so a peer cannot forge acks for a room it
 * has not joined.
 */
const ACK_TYPE = 'presence' as const;
const ACK_MARKER = 'ct.ack';

export type BleTransportOptions = {
  displayName: string;
  secret: RoomSecret;
  /** Injected for tests and deterministic replay. */
  now?: () => number;
  /**
   * Called after an inbound envelope has been persisted. The ack is only sent
   * once this resolves, so "Shared with a nearby peer" means the far side has
   * it on disk, not merely in memory.
   */
  persist: (envelope: MeshEnvelope, fromPeerId: string) => Promise<void>;
  /** True when this message id has already been stored. */
  hasSeen: (messageId: string) => Promise<boolean>;
};

function blockerFromError(error: unknown): TransportBlocker | null {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : error instanceof Error
        ? error.message.split(':')[0]
        : '';

  switch (code) {
    case 'bluetooth_unsupported':
    case 'bluetooth_off':
    case 'permission_denied':
    case 'advertising_unsupported':
      return code;
    default:
      return null;
  }
}

export class BleNearbyMeshTransport implements NearbyMeshTransport {
  private readonly envelopeListeners = new Set<EnvelopeListener>();
  private readonly peerListeners = new Set<PeerListener>();
  private readonly ackListeners = new Set<AckListener>();

  /** One assembler per peer so a peer cannot corrupt another's in-flight set. */
  private readonly assemblers = new Map<string, FragmentAssembler>();

  private readonly subscriptions: { remove: () => void }[] = [];
  private readonly now: () => number;

  private peers: PeerPresence[] = [];
  private roomId: string | null = null;
  private started = false;

  constructor(private readonly options: BleTransportOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async start(roomId: string): Promise<void> {
    if (this.started) {
      throw new TransportUnavailableError(
        'already_running',
        'Nearby communication is already running.',
      );
    }

    this.attachListeners();

    try {
      await NearbyBle.start(roomId, this.options.displayName);
    } catch (error) {
      this.detachListeners();
      const blocker = blockerFromError(error);
      if (blocker) {
        throw new TransportUnavailableError(
          blocker,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }

    this.roomId = roomId;
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.roomId = null;

    await NearbyBle.stop();
    this.detachListeners();
    this.assemblers.clear();
    this.peers = [];
    this.emitPeers();
  }

  async broadcast(envelope: MeshEnvelope): Promise<void> {
    if (!this.started) {
      throw new TransportUnavailableError(
        'already_running',
        'Nearby communication is not running.',
      );
    }

    const status = await NearbyBle.getStatus();
    const frames = fragment(
      encodeEnvelope(envelope),
      envelope.messageId,
      Math.max(20, status.maxFrameBytes),
    );

    // Sequential rather than parallel: BLE links serialise anyway, and firing
    // every fragment at once reliably overruns the transmit queue.
    for (const frame of frames) {
      await NearbyBle.broadcastFrame(toBase64(frame));
    }
  }

  onEnvelope(listener: EnvelopeListener): Unsubscribe {
    this.envelopeListeners.add(listener);
    return () => this.envelopeListeners.delete(listener);
  }

  onPeerChange(listener: PeerListener): Unsubscribe {
    this.peerListeners.add(listener);
    return () => this.peerListeners.delete(listener);
  }

  onAck(listener: AckListener): Unsubscribe {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  async getStatus(): Promise<MeshStatus> {
    const native = await NearbyBle.getStatus();
    return {
      running: native.running,
      bluetoothState: native.bluetoothState,
      advertising: native.advertising,
      scanning: native.scanning,
      roomId: native.roomId,
      localPeerId: native.localPeerId,
      connectedPeerCount: native.connectedPeerCount,
    };
  }

  // -------------------------------------------------------------------
  // Native event plumbing
  // -------------------------------------------------------------------

  private attachListeners(): void {
    this.subscriptions.push(
      NearbyBle.addListener('onFrameReceived', (event: FrameReceivedEvent) => {
        void this.handleFrame(event);
      }),
      NearbyBle.addListener('onPeersChanged', (event: PeersChangedEvent) => {
        this.peers = event.peers.map(toPeerPresence);
        this.emitPeers();
      }),
      NearbyBle.addListener('onStateChanged', (_event: StateChangedEvent) => {
        // Adapter transitions are surfaced through getStatus(); the UI polls
        // it on this signal rather than caching a second copy of the state.
      }),
    );
  }

  private detachListeners(): void {
    for (const subscription of this.subscriptions) {
      subscription.remove();
    }
    this.subscriptions.length = 0;
  }

  private assemblerFor(peerId: string): FragmentAssembler {
    let assembler = this.assemblers.get(peerId);
    if (assembler === undefined) {
      assembler = new FragmentAssembler();
      this.assemblers.set(peerId, assembler);
    }
    return assembler;
  }

  private async handleFrame(event: FrameReceivedEvent): Promise<void> {
    const assembler = this.assemblerFor(event.peerId);
    const result = assembler.accept(fromBase64(event.data), this.now());

    if (result.status !== 'complete') return;

    const decoded = decodeEnvelope(result.message, this.options.secret, this.now());
    if (!decoded.ok) {
      // Malformed or foreign traffic is expected on an open radio. Drop it
      // silently rather than surfacing noise as an error to the user.
      return;
    }

    const envelope = decoded.envelope;

    if (isAck(envelope)) {
      this.handleAck(envelope, event.peerId);
      return;
    }

    if (await this.options.hasSeen(envelope.messageId)) {
      // Already stored. Still ack so a sender retrying after a lost ack can
      // clear its outbox instead of retransmitting forever.
      await this.sendAck(envelope.messageId, event.peerId);
      return;
    }

    // Persist before presenting or forwarding. An ack must mean "on disk".
    await this.options.persist(envelope, event.peerId);

    for (const listener of this.envelopeListeners) {
      listener(envelope, event.peerId);
    }

    await this.sendAck(envelope.messageId, event.peerId);
  }

  private handleAck(envelope: MeshEnvelope, fromPeerId: string): void {
    const acked = envelope.payload[ACK_MARKER];
    if (typeof acked !== 'string') return;

    for (const listener of this.ackListeners) {
      listener({
        messageId: acked,
        peerId: fromPeerId,
        receivedAtMs: this.now(),
      });
    }
  }

  private async sendAck(messageId: string, peerId: string): Promise<void> {
    const { createEnvelope } = await import('./EnvelopeCodec');
    const status = await NearbyBle.getStatus();

    const ack = createEnvelope(
      {
        messageId: `ack-${messageId}`,
        senderId: status.localPeerId ?? 'local',
        type: ACK_TYPE,
        payload: { [ACK_MARKER]: messageId },
        createdAtMs: this.now(),
        ttlMs: 60_000,
        // Acks are strictly point-to-point. Never relay one.
        maxHops: 1,
      },
      this.options.secret,
    );

    const frames = fragment(
      encodeEnvelope(ack),
      ack.messageId,
      Math.max(20, status.maxFrameBytes),
    );

    for (const frame of frames) {
      await NearbyBle.sendFrameTo(peerId, toBase64(frame));
    }
  }

  private emitPeers(): void {
    for (const listener of this.peerListeners) {
      listener(this.peers);
    }
  }
}

function isAck(envelope: MeshEnvelope): boolean {
  return envelope.type === ACK_TYPE && ACK_MARKER in envelope.payload;
}

function toPeerPresence(peer: NativePeer): PeerPresence {
  return {
    peerId: peer.peerId,
    displayName: peer.displayName,
    lastSeenAtMs: peer.lastSeenAtMs,
    rssi: peer.rssi,
  };
}
