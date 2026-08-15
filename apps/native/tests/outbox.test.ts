import { beforeEach, describe, expect, it } from 'vitest';

import { utf8Encode } from '../src/crypto/bytes';
import { EventStore } from '../src/db/EventStore';
import { createEnvelope, type RoomSecret } from '../src/mesh/EnvelopeCodec';
import type { MeshEnvelope, MeshStatus, PeerPresence } from '../src/mesh/MeshEnvelope';
import type {
  AckListener,
  EnvelopeListener,
  NearbyMeshTransport,
  PeerListener,
} from '../src/mesh/NearbyMeshTransport';
import { OutboxSender } from '../src/mesh/OutboxSender';
import { FakeDatabase } from './support/FakeDatabase';

const NOW = 1_700_000_000_000;

const secret: RoomSecret = {
  roomId: 'room-alpha',
  key: utf8Encode('a-high-entropy-room-secret-value'),
};

function envelope(messageId: string): MeshEnvelope {
  return createEnvelope(
    {
      messageId,
      senderId: 'device-a',
      type: 'thread.created',
      payload: { title: 'Need blankets' },
      createdAtMs: NOW,
      ttlMs: 60 * 60 * 1000,
    },
    secret,
  );
}

/** Transport double that records what was broadcast and lets tests drive
 *  peer-presence and ack events by hand. */
class FakeTransport implements NearbyMeshTransport {
  readonly broadcasts: string[] = [];
  private peerListeners: PeerListener[] = [];
  private ackListeners: AckListener[] = [];

  /** Set to make the next broadcast fail, as a radio would when a peer walks off. */
  failNextBroadcast = false;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async broadcast(e: MeshEnvelope): Promise<void> {
    if (this.failNextBroadcast) {
      this.failNextBroadcast = false;
      throw new Error('radio unavailable');
    }
    this.broadcasts.push(e.messageId);
  }

  onEnvelope(_listener: EnvelopeListener): () => void {
    return () => {};
  }

  onPeerChange(listener: PeerListener): () => void {
    this.peerListeners.push(listener);
    return () => {
      this.peerListeners = this.peerListeners.filter((l) => l !== listener);
    };
  }

  onAck(listener: AckListener): () => void {
    this.ackListeners.push(listener);
    return () => {
      this.ackListeners = this.ackListeners.filter((l) => l !== listener);
    };
  }

  async getStatus(): Promise<MeshStatus> {
    return {
      running: true,
      bluetoothState: 'on',
      advertising: true,
      scanning: true,
      roomId: 'room-alpha',
      localPeerId: 'device-a',
      connectedPeerCount: this.peerCount,
    };
  }

  private peerCount = 0;

  emitPeers(peers: PeerPresence[]): void {
    this.peerCount = peers.length;
    for (const listener of this.peerListeners) listener(peers);
  }

  emitAck(messageId: string): void {
    for (const listener of this.ackListeners) {
      listener({ messageId, peerId: 'peer-b', receivedAtMs: NOW });
    }
  }

  /**
   * Emit an ack and let the sender's async handler finish. The transport's
   * ack callback is synchronous by contract, so the test drains the
   * microtask queue rather than the sender exposing internals.
   */
  async emitAckAndSettle(messageId: string): Promise<void> {
    this.emitAck(messageId);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
}

function peer(id: string): PeerPresence {
  return { peerId: id, displayName: null, lastSeenAtMs: NOW, rssi: null };
}

describe('OutboxSender', () => {
  let db: FakeDatabase;
  let store: EventStore;
  let transport: FakeTransport;
  let sender: OutboxSender;
  let deliveries: [string, string][];
  let clock: number;

  const RETRY_MS = 5_000;

  beforeEach(async () => {
    db = new FakeDatabase();
    store = new EventStore(db);
    await store.migrate();

    clock = NOW;
    transport = new FakeTransport();
    sender = new OutboxSender({
      store,
      transport,
      roomId: 'room-alpha',
      now: () => clock,
      retryIntervalMs: RETRY_MS,
    });

    deliveries = [];
    sender.onDeliveryChange((messageId, state) => deliveries.push([messageId, state]));
    sender.start();
  });

  it('holds a post as pending when no peer is present', async () => {
    await sender.enqueue(envelope('msg-1'));

    expect(transport.broadcasts).toEqual([]);
    // The user sees "Waiting for nearby peer", never "sent".
    expect(deliveries).toEqual([['msg-1', 'pending']]);
    expect(await store.isQueued('msg-1')).toBe(true);
  });

  it('sends when a peer appears', async () => {
    await sender.enqueue(envelope('msg-1'));
    transport.emitPeers([peer('peer-b')]);
    await sender.flush();

    expect(transport.broadcasts).toEqual(['msg-1']);
  });

  it('sends immediately when a peer is already present', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));
    await sender.flush();

    expect(transport.broadcasts).toEqual(['msg-1']);
  });

  it('keeps the row queued until a peer acknowledges persistence', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));
    await sender.flush();

    // Broadcast alone proves nothing about the far side. Still pending.
    expect(await store.isQueued('msg-1')).toBe(true);
    expect(deliveries).toEqual([['msg-1', 'pending']]);
  });

  it('clears the row and reports shared once acknowledged', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));
    await sender.flush();

    await transport.emitAckAndSettle('msg-1');

    expect(await store.isQueued('msg-1')).toBe(false);
    expect(deliveries).toEqual([
      ['msg-1', 'pending'],
      ['msg-1', 'shared'],
    ]);
  });

  it('keeps the event after the ack clears the queue row', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));
    await transport.emitAckAndSettle('msg-1');

    expect(await store.getEvent('msg-1')).not.toBeNull();
    expect(await store.hasSeen('msg-1')).toBe(true);
  });

  it('ignores a repeated ack rather than emitting a second state change', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));

    await transport.emitAckAndSettle('msg-1');
    await transport.emitAckAndSettle('msg-1');

    expect(deliveries.filter(([, state]) => state === 'shared')).toHaveLength(1);
  });

  it('ignores an ack for something never queued', async () => {
    await transport.emitAckAndSettle('unknown');
    expect(deliveries).toEqual([]);
  });

  it('does not resend while an earlier attempt is still awaiting an ack', async () => {
    await sender.enqueue(envelope('msg-1'));

    // Peers churn constantly as people move. Each re-appearance must not
    // put another copy of the same message on the radio.
    transport.emitPeers([peer('peer-b')]);
    await sender.flush();
    transport.emitPeers([]);
    transport.emitPeers([peer('peer-c')]);
    await sender.flush();
    await sender.flush();

    expect(transport.broadcasts.filter((id) => id === 'msg-1')).toHaveLength(1);
  });

  it('resends once the retry interval has elapsed with no ack', async () => {
    transport.emitPeers([peer('peer-b')]);
    await sender.enqueue(envelope('msg-1'));
    await sender.flush();

    clock += RETRY_MS + 1;
    await sender.flush();

    expect(transport.broadcasts).toEqual(['msg-1', 'msg-1']);
  });

  it('retries immediately after a radio failure', async () => {
    await sender.enqueue(envelope('msg-1'));

    // flush() directly rather than via emitPeers: a peer-change kicks off its
    // own background flush, which would consume the failure flag first.
    transport.failNextBroadcast = true;
    await sender.flush();

    expect(transport.broadcasts).toEqual([]);
    expect(await store.isQueued('msg-1')).toBe(true);

    // A failed send must not start the retry clock, or the message would sit
    // idle for the full interval despite never reaching the radio.
    await sender.flush();
    expect(transport.broadcasts).toEqual(['msg-1']);
  });

  it('sends a queued post exactly once after an app restart', async () => {
    // Post with no peer, then the process dies.
    await sender.enqueue(envelope('msg-1'));
    sender.stop();

    const restartedStore = new EventStore(db.reopen());
    const restartedTransport = new FakeTransport();
    const restarted = new OutboxSender({
      store: restartedStore,
      transport: restartedTransport,
      roomId: 'room-alpha',
      now: () => clock,
      retryIntervalMs: RETRY_MS,
    });
    restarted.start();

    restartedTransport.emitPeers([peer('peer-b')]);
    await restarted.flush();

    expect(restartedTransport.broadcasts).toEqual(['msg-1']);

    await restartedTransport.emitAckAndSettle('msg-1');

    // Once acknowledged the row is gone, so even a much later flush cannot
    // send a second copy.
    clock += RETRY_MS * 10;
    await restarted.flush();
    expect(restartedTransport.broadcasts).toEqual(['msg-1']);
  });

  it('flushes several queued posts in creation order', async () => {
    await sender.enqueue(envelope('msg-1'));
    await sender.enqueue(envelope('msg-2'));
    await sender.enqueue(envelope('msg-3'));

    transport.emitPeers([peer('peer-b')]);
    await sender.flush();

    expect(transport.broadcasts).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('stops sending after stop', async () => {
    await sender.enqueue(envelope('msg-1'));
    sender.stop();

    transport.emitPeers([peer('peer-b')]);
    await Promise.resolve();

    expect(transport.broadcasts).toEqual([]);
  });
});
