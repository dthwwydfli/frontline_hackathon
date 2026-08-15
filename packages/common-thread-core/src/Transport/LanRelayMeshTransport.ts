import {
  encodeWirePayload,
  parseCommonThreadEvent,
  type CommonThreadEvent,
  type PeerID,
} from "../Domain/CommonThreadEvent.js";
import type {
  CommonThreadMeshTransport,
  ReceivedCommonThreadEvent,
} from "./CommonThreadMeshTransport.js";
import { AsyncEventQueue } from "./AsyncEventQueue.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  PendingRequests,
  coerceDeliveryState,
  coercePresence,
  encodeFrame,
  makeFrame,
  parseFrame,
  type BridgeFrame,
  type DeliveryState,
  type PeerPresence,
} from "./BridgeProtocol.js";

export type MeshConnectionState = "connecting" | "online" | "offline";

export interface MeshStatus {
  connection: MeshConnectionState;
  /** Peers the relay currently has connected, excluding this device. */
  peers: PeerPresence[];
  /** Events accepted locally but not yet handed to the relay. */
  queued: number;
  /** Populated by the relay so a desktop can render a join QR code. */
  joinUrl?: string;
}

export interface LanRelayOptions {
  url?: string;
  displayName?: string;
  /** Injected for tests; defaults to the global WebSocket. */
  webSocketFactory?: (url: string) => WebSocket;
  /** Backoff bounds for reconnection, in milliseconds. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  /** Where the outbox survives a reload. Defaults to localStorage. */
  outboxStorage?: OutboxStorage;
}

interface OutboxEntry {
  event: CommonThreadEvent;
  upstreamMessageID: string;
}

/**
 * Durable home for events accepted locally but not yet handed to the relay.
 *
 * Without this the outbox dies with the page: post while offline, reload, and
 * the event is stranded in the local store forever — visible on that device
 * and nowhere else.
 */
export interface OutboxStorage {
  load(): OutboxEntry[];
  save(entries: OutboxEntry[]): void;
}

/** localStorage-backed, scoped per peer. Inert where storage is unavailable. */
export function localStorageOutbox(peerID: PeerID): OutboxStorage {
  const key = `common-thread.outbox.${peerID}`;
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) {
          return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return [];
        }
        const entries: OutboxEntry[] = [];
        for (const item of parsed) {
          try {
            // Re-validate: a corrupt or truncated entry must not wedge startup.
            entries.push({
              event: parseCommonThreadEvent(
                (item as OutboxEntry).event as unknown,
              ),
              upstreamMessageID: String(
                (item as OutboxEntry).upstreamMessageID,
              ),
            });
          } catch {
            // Skip the bad entry, keep the rest.
          }
        }
        return entries;
      } catch {
        return [];
      }
    },
    save(entries) {
      try {
        if (entries.length === 0) {
          globalThis.localStorage?.removeItem(key);
        } else {
          globalThis.localStorage?.setItem(key, JSON.stringify(entries));
        }
      } catch {
        // Private browsing or quota exceeded: degrade to in-memory only.
      }
    },
  };
}

const RELAY_PATH = "/ct-mesh";

/** `ws(s)://<same host>/ct-mesh` — the relay rides on the page's own origin. */
export function defaultRelayUrl(): string {
  if (typeof location === "undefined") {
    return `ws://127.0.0.1:5173${RELAY_PATH}`;
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${RELAY_PATH}`;
}

/**
 * Browser-side mesh adapter over a local-network relay.
 *
 * This is NOT Bluetooth. A browser cannot advertise as a BLE peripheral, so it
 * can never be discovered by another browser; BLE lives in the iOS companion
 * (`PhoneBridgeMeshTransport`). This adapter carries the same CT1 payloads over
 * a WebSocket on the local network, with no internet involved.
 *
 * Delivery states stop at `sent` per PLD-02 — reaching the relay is not proof
 * that any peer received anything.
 */
export class LanRelayMeshTransport implements CommonThreadMeshTransport {
  private readonly url: string;
  private readonly factory: (url: string) => WebSocket;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly pending: PendingRequests;
  private readonly inbound = new AsyncEventQueue();

  private ws: WebSocket | null = null;
  private connection: MeshConnectionState = "offline";
  private peers: PeerPresence[] = [];
  private joinUrl: string | undefined;
  private outbox: OutboxEntry[] = [];
  private readonly outboxStorage: OutboxStorage;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private displayName: string;
  private readonly listeners = new Set<(status: MeshStatus) => void>();

  readonly receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent>;

  constructor(
    readonly localPeerID: PeerID,
    options: LanRelayOptions = {},
  ) {
    this.url = options.url ?? defaultRelayUrl();
    this.factory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    this.minBackoffMs = options.minBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 8_000;
    this.displayName = options.displayName ?? "";
    this.pending = new PendingRequests(
      options.requestTimeoutMs ?? 10_000,
      "Mesh request timeout",
    );
    this.receivedPublicEvents = this.inbound.iterable;
    this.outboxStorage = options.outboxStorage ?? localStorageOutbox(localPeerID);
    // Anything queued before the last reload is picked back up here, and gets
    // flushed by the same path as a live disconnect.
    this.outbox = this.outboxStorage.load();
  }

  private persistOutbox(): void {
    this.outboxStorage.save(this.outbox);
  }

  // ---------------------------------------------------------------- status

  get status(): MeshStatus {
    return {
      connection: this.connection,
      peers: this.peers,
      queued: this.outbox.length,
      joinUrl: this.joinUrl,
    };
  }

  subscribe(listener: (status: MeshStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private setConnection(next: MeshConnectionState): void {
    if (this.connection === next) {
      return;
    }
    this.connection = next;
    this.emit();
  }

  setDisplayName(displayName: string): void {
    this.displayName = displayName;
    if (this.isOpen()) {
      this.send(
        makeFrame("presence", {
          peerID: this.localPeerID,
          displayName: this.displayName,
        }),
      );
    }
  }

  // ------------------------------------------------------------ connection

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  private send(frame: BridgeFrame): void {
    this.ws?.send(encodeFrame(frame));
  }

  connect(): void {
    if (this.disposed || this.isOpen() || this.connection === "connecting") {
      return;
    }
    this.setConnection("connecting");

    let ws: WebSocket;
    try {
      ws = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.send(
        makeFrame(
          "hello",
          {
            client: "common-thread-web",
            protocol: BRIDGE_PROTOCOL_VERSION,
            peerID: this.localPeerID,
            displayName: this.displayName,
          },
          crypto.randomUUID(),
        ),
      );
      this.setConnection("online");
      void this.flushOutbox();
    };

    ws.onmessage = (message: MessageEvent) => {
      const frame = parseFrame(message.data);
      if (frame) {
        this.handleFrame(frame);
      }
    };

    ws.onerror = () => {
      // `onclose` always follows; reconnect is handled there.
    };

    ws.onclose = () => {
      this.ws = null;
      this.pending.rejectAll(new Error("Mesh offline"));
      this.setConnection("offline");
      this.peers = [];
      this.emit();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      this.maxBackoffMs,
      this.minBackoffMs * 2 ** this.attempts,
    );
    this.attempts += 1;
    this.setConnection("offline");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    (this.reconnectTimer as unknown as { unref?: () => void }).unref?.();
  }

  // --------------------------------------------------------------- inbound

  private handleFrame(frame: BridgeFrame): void {
    switch (frame.type) {
      case "hello_ack":
        this.joinUrl = frame.payload?.joinUrl
          ? String(frame.payload.joinUrl)
          : undefined;
        this.peers = coercePresence(frame.payload?.peers).filter(
          (peer) => peer.peerID !== this.localPeerID,
        );
        this.emit();
        return;

      case "presence_state":
        this.peers = coercePresence(frame.payload?.peers).filter(
          (peer) => peer.peerID !== this.localPeerID,
        );
        this.emit();
        return;

      case "public_event":
        this.acceptPublicEvent(frame.payload);
        return;

      case "backlog": {
        const items = frame.payload?.events;
        if (Array.isArray(items)) {
          for (const item of items) {
            this.acceptPublicEvent(item as Record<string, unknown>);
          }
        }
        return;
      }

      default:
        this.pending.settle(frame);
    }
  }

  private acceptPublicEvent(payload: Record<string, unknown> | undefined): void {
    if (!payload) {
      return;
    }
    try {
      this.inbound.push({
        event: parseCommonThreadEvent(payload.event),
        upstreamMessageID: String(payload.upstreamMessageID),
        receivedAt: new Date(String(payload.receivedAt)),
      });
    } catch {
      // Ignore anything that is not a valid CT envelope.
    }
  }

  /** Non-blocking drain, for tests and synchronous demo stepping. */
  drainPending(): ReceivedCommonThreadEvent[] {
    return this.inbound.drainPending();
  }

  // -------------------------------------------------------------- outbound

  /**
   * The client mints the upstream ID so an event keeps one identity whether it
   * was sent immediately or queued and flushed later. The relay dedupes on it,
   * which is what makes an outbox flush idempotent.
   */
  private mintUpstreamID(event: CommonThreadEvent): string {
    return `lan-${this.localPeerID}-${event.eventID}`;
  }

  async publishPublicEvent(event: CommonThreadEvent): Promise<{
    upstreamMessageID: string;
    state: DeliveryState;
  }> {
    const upstreamMessageID = this.mintUpstreamID(event);

    if (!this.isOpen()) {
      this.outbox.push({ event, upstreamMessageID });
      this.persistOutbox();
      this.emit();
      this.connect();
      return { upstreamMessageID, state: "queued" };
    }

    try {
      const state = await this.sendPublish(event, upstreamMessageID);
      return { upstreamMessageID, state };
    } catch {
      this.outbox.push({ event, upstreamMessageID });
      this.persistOutbox();
      this.emit();
      return { upstreamMessageID, state: "queued" };
    }
  }

  private async sendPublish(
    event: CommonThreadEvent,
    upstreamMessageID: string,
  ): Promise<DeliveryState> {
    const id = crypto.randomUUID();
    const result = this.pending.register(id);
    this.send(
      makeFrame(
        "publish_public",
        { event, wire: encodeWirePayload(event), upstreamMessageID },
        id,
      ),
    );
    const frame = await result;
    if (frame.type !== "delivery_state" || !frame.payload) {
      return "unknown";
    }
    return coerceDeliveryState(frame.payload.state);
  }

  private async flushOutbox(): Promise<void> {
    if (this.outbox.length === 0) {
      return;
    }
    const batch = this.outbox;
    this.outbox = [];
    this.persistOutbox();
    this.emit();

    const failed: OutboxEntry[] = [];
    for (const entry of batch) {
      if (!this.isOpen()) {
        failed.push(entry);
        continue;
      }
      try {
        await this.sendPublish(entry.event, entry.upstreamMessageID);
      } catch {
        failed.push(entry);
      }
    }
    if (failed.length > 0) {
      // Anything that did not make it goes back to the front, still durable.
      this.outbox = [...failed, ...this.outbox];
      this.persistOutbox();
      this.emit();
    }
  }

  /**
   * A LAN relay has no Noise sessions. This reports only that both peers are
   * currently reachable — the honest limit of what this transport knows.
   */
  async canOpenEncryptedPrivateConversation(peerID: PeerID): Promise<boolean> {
    if (!this.isOpen()) {
      return false;
    }
    try {
      const id = crypto.randomUUID();
      const result = this.pending.register(id);
      this.send(makeFrame("can_open_private", { peerID }, id));
      const frame = await result;
      if (frame.type !== "can_open_private_result" || !frame.payload) {
        return false;
      }
      return Boolean(frame.payload.available);
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pending.rejectAll(new Error("Mesh closed"));
    this.inbound.close();
    this.ws?.close();
    this.ws = null;
    this.setConnection("offline");
  }
}
