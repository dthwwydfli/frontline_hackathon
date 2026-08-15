/**
 * Drains the durable outbox when a peer is reachable.
 *
 * Delivery language this file is allowed to produce, and nothing stronger:
 *   pending  -> "Waiting for nearby peer"
 *   acked    -> "Shared with a nearby peer"
 *
 * An ack means one adjacent device wrote the envelope to disk. It is never
 * evidence that the room received it.
 */

import type { EventStore } from '../db/EventStore';
import type { MeshEnvelope, PeerPresence } from './MeshEnvelope';
import type { NearbyMeshTransport } from './NearbyMeshTransport';

export type DeliveryState = 'pending' | 'shared';

export type DeliveryListener = (messageId: string, state: DeliveryState) => void;

export type OutboxSenderOptions = {
  store: EventStore;
  transport: NearbyMeshTransport;
  roomId: string;
  now?: () => number;
  /** Minimum gap between retries of the same message. */
  retryIntervalMs?: number;
};

const DEFAULT_RETRY_INTERVAL_MS = 5_000;

export class OutboxSender {
  private readonly now: () => number;
  private readonly retryIntervalMs: number;
  private readonly listeners = new Set<DeliveryListener>();
  private readonly unsubscribes: (() => void)[] = [];

  /** Messages currently being written to the radio, so a peer-change event
   *  arriving mid-flush does not send them twice. */
  private readonly inFlight = new Set<string>();

  private hasPeers = false;
  private stopped = false;

  /**
   * Serialises flushes. Two concurrent drains would both read the same pending
   * set and transmit duplicates, so each waits for the previous one. Awaiting
   * flush() therefore means "my pass has run", not "someone else's did".
   */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly options: OutboxSenderOptions) {
    this.now = options.now ?? (() => Date.now());
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  }

  start(): void {
    this.stopped = false;

    this.unsubscribes.push(
      this.options.transport.onPeerChange((peers: PeerPresence[]) => {
        const nowHasPeers = peers.length > 0;
        const gained = !this.hasPeers && nowHasPeers;
        this.hasPeers = nowHasPeers;

        // Only flush on the transition into "a peer exists". Retrying on every
        // presence tick would hammer the radio while peers churn.
        if (gained) void this.flush();
      }),

      this.options.transport.onAck((ack) => {
        void this.handleAck(ack.messageId);
      }),
    );
  }

  stop(): void {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.inFlight.clear();
  }

  onDeliveryChange(listener: DeliveryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Queue a locally created envelope. The event and the queue row are written
   * in one transaction before this resolves, so a crash immediately after
   * cannot lose the post or leave it invisible.
   */
  async enqueue(envelope: MeshEnvelope): Promise<void> {
    await this.options.store.recordLocalAndQueue(envelope, this.now());
    this.emit(envelope.messageId, 'pending');

    if (this.hasPeers) void this.flush();
  }

  /** Send every pending row once, after any in-progress flush finishes. */
  async flush(): Promise<void> {
    const run = this.chain.then(() => this.drain());
    // Swallow on the chain only: the returned promise still rejects for the
    // caller, but one failed pass must not poison every later flush.
    this.chain = run.catch(() => {});
    return run;
  }

  private async drain(): Promise<void> {
    if (this.stopped) return;

    const nowMs = this.now();
    const pending = await this.options.store.pendingOutbox(this.options.roomId, nowMs);

    for (const entry of pending) {
      if (this.stopped) break;
      if (this.inFlight.has(entry.messageId)) continue;

      // Already sent recently and still waiting for an ack. Resending now
      // would just duplicate traffic on a radio that is already busy.
      if (
        entry.lastAttemptMs !== null &&
        nowMs - entry.lastAttemptMs < this.retryIntervalMs
      ) {
        continue;
      }

      this.inFlight.add(entry.messageId);
      try {
        await this.options.transport.broadcast(entry.envelope);
        // Recorded only on success, so a radio failure does not start the
        // retry clock and strand the message until the interval elapses.
        await this.options.store.markAttempted(entry.messageId, nowMs);
      } catch {
        // Peers move; broadcast failures are routine. The row stays pending
        // and the next peer-change or flush retries it.
      } finally {
        this.inFlight.delete(entry.messageId);
      }
    }
  }

  private async handleAck(messageId: string): Promise<void> {
    // Only clear rows we are actually waiting on. An ack for something already
    // cleared (a duplicate, or a peer re-acking) must not emit a second
    // state change.
    const queued = await this.options.store.isQueued(messageId);
    if (!queued) return;

    await this.options.store.clearFromOutbox(messageId);
    this.emit(messageId, 'shared');
  }

  private emit(messageId: string, state: DeliveryState): void {
    for (const listener of this.listeners) listener(messageId, state);
  }
}
