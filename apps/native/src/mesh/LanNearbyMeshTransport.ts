/**
 * Wi-Fi transport, for running in Expo Go.
 *
 * Expo Go's native half is fixed when Expo builds it, so the BLE module cannot
 * load there. WebSocket, however, is part of the JS runtime — so this speaks to
 * a small relay on the same network and satisfies exactly the same
 * NearbyMeshTransport interface the radio does.
 *
 * Everything above this file is unchanged: the same envelopes, the same
 * signatures, the same reducer, the same store. Only the pipe differs.
 *
 * This is NOT Bluetooth. No screen may describe it as such.
 */

import type { MeshEnvelope, MeshStatus, PeerPresence } from './MeshEnvelope';
import {
  TransportUnavailableError,
  type AckListener,
  type EnvelopeListener,
  type NearbyMeshTransport,
  type PeerListener,
  type Unsubscribe,
} from './NearbyMeshTransport';

type Frame =
  | { t: 'env'; from: string; envelope: MeshEnvelope }
  | { t: 'peers'; peers: { peerId: string; displayName: string | null }[] }
  | { t: 'ack'; messageId: string; peerId: string };

export type LanTransportOptions = {
  url: string;
  peerId: string;
  displayName: string;
  persist: (envelope: MeshEnvelope, fromPeerId: string) => Promise<void>;
  hasSeen: (messageId: string) => Promise<boolean>;
};

export class LanNearbyMeshTransport implements NearbyMeshTransport {
  private socket: WebSocket | null = null;
  private roomId: string | null = null;
  private connected = false;
  private closing = false;
  private peers: PeerPresence[] = [];

  private readonly envelopeListeners = new Set<EnvelopeListener>();
  private readonly peerListeners = new Set<PeerListener>();
  private readonly ackListeners = new Set<AckListener>();

  /** Sent once the socket opens, so nothing is lost during a reconnect. */
  private readonly pending: MeshEnvelope[] = [];

  constructor(private readonly options: LanTransportOptions) {}

  async start(roomId: string): Promise<void> {
    if (this.connected) {
      throw new TransportUnavailableError('already_running', 'Already running.');
    }
    this.roomId = roomId;
    this.closing = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(
          new TransportUnavailableError(
            'bluetooth_unsupported',
            `No nearby relay answered at ${this.options.url}.`,
          ),
        );
      }, 6000);

      socket.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        socket.send(
          JSON.stringify({
            t: 'hello',
            peerId: this.options.peerId,
            displayName: this.options.displayName,
            roomId,
          }),
        );
        for (const envelope of this.pending.splice(0)) {
          socket.send(JSON.stringify({ t: 'env', envelope }));
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.onmessage = (event) => {
        void this.receive(String(event.data));
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new TransportUnavailableError(
            'bluetooth_unsupported',
            `Could not reach the nearby relay at ${this.options.url}.`,
          ),
        );
      };

      socket.onclose = () => {
        this.connected = false;
        this.peers = [];
        this.emitPeers();
        if (!this.closing) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    const roomId = this.roomId;
    if (roomId === null) return;
    setTimeout(() => {
      if (this.closing || this.connected) return;
      void this.start(roomId).catch(() => {
        // Retried again by the next close.
      });
    }, 2000);
  }

  private async receive(raw: string): Promise<void> {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }

    if (frame.t === 'peers') {
      this.peers = frame.peers.map((peer) => ({
        peerId: peer.peerId,
        displayName: peer.displayName,
        lastSeenAtMs: Date.now(),
        rssi: null,
      }));
      this.emitPeers();
      return;
    }

    if (frame.t === 'ack') {
      for (const listener of this.ackListeners) {
        listener({
          messageId: frame.messageId,
          peerId: frame.peerId,
          receivedAtMs: Date.now(),
        });
      }
      return;
    }

    if (frame.t !== 'env') return;

    const envelope = frame.envelope;
    if (typeof envelope?.messageId !== 'string') return;

    // Duplicate suppression stays the responsibility of the store, exactly as
    // it is over the radio.
    if (await this.options.hasSeen(envelope.messageId)) return;

    await this.options.persist(envelope, frame.from);

    // Acknowledge only after it is on disk. "Shared with a nearby peer" must
    // mean persisted, never merely received.
    this.socket?.send(
      JSON.stringify({ t: 'ack', messageId: envelope.messageId, to: frame.from }),
    );

    for (const listener of this.envelopeListeners) {
      listener(envelope, frame.from);
    }
  }

  private emitPeers(): void {
    for (const listener of this.peerListeners) listener([...this.peers]);
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    this.peers = [];
  }

  async broadcast(envelope: MeshEnvelope): Promise<void> {
    if (this.socket === null || !this.connected) {
      this.pending.push(envelope);
      return;
    }
    this.socket.send(JSON.stringify({ t: 'env', envelope }));
  }

  onEnvelope(listener: EnvelopeListener): Unsubscribe {
    this.envelopeListeners.add(listener);
    return () => this.envelopeListeners.delete(listener);
  }

  onPeerChange(listener: PeerListener): Unsubscribe {
    this.peerListeners.add(listener);
    listener([...this.peers]);
    return () => this.peerListeners.delete(listener);
  }

  onAck(listener: AckListener): Unsubscribe {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  async getStatus(): Promise<MeshStatus> {
    return {
      running: this.connected,
      // Honest: there is no radio here at all.
      bluetoothState: 'unsupported',
      advertising: this.connected,
      scanning: this.connected,
      roomId: this.roomId,
      localPeerId: this.options.peerId,
      connectedPeerCount: this.peers.length,
    };
  }
}
