import WebSocket from "ws";
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

export interface PhoneBridgeOptions {
  url?: string;
  /** Injected WebSocket for tests. */
  webSocketFactory?: (url: string) => WebSocket;
}

interface BridgeFrame {
  v: number;
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
}

/**
 * Loopback WebSocket adapter to the iOS companion.
 * Does not touch Core Bluetooth — companion owns the mesh.
 */
export class PhoneBridgeMeshTransport implements CommonThreadMeshTransport {
  private readonly url: string;
  private readonly factory: (url: string) => WebSocket;
  private ws: WebSocket | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }
  >();
  private readonly pushQueue: ReceivedCommonThreadEvent[] = [];
  private readonly waiters: Array<
    (v: IteratorResult<ReceivedCommonThreadEvent>) => void
  > = [];
  private connectPromise: Promise<void> | null = null;

  readonly receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent>;

  constructor(options: PhoneBridgeOptions = {}) {
    this.url = options.url ?? "ws://127.0.0.1:17832";
    this.factory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url));

    this.receivedPublicEvents = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (this.pushQueue.length > 0) {
            return { value: this.pushQueue.shift()!, done: false };
          }
          return new Promise<IteratorResult<ReceivedCommonThreadEvent>>(
            (resolve) => {
              this.waiters.push(resolve);
            },
          );
        },
      }),
    };
  }

  private pushReceived(item: ReceivedCommonThreadEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.pushQueue.push(item);
    }
  }

  private handleFrame(frame: BridgeFrame): void {
    if (frame.type === "public_event" && frame.payload) {
      try {
        const event = parseCommonThreadEvent(frame.payload.event);
        const upstreamMessageID = String(frame.payload.upstreamMessageID);
        const receivedAt = new Date(String(frame.payload.receivedAt));
        this.pushReceived({ event, upstreamMessageID, receivedAt });
      } catch {
        // Ignore invalid envelopes from companion.
      }
      return;
    }

    if (frame.id && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      if (frame.type === "error") {
        p.reject(
          new Error(
            String(frame.payload?.message ?? "bridge error"),
          ),
        );
      } else {
        p.resolve(frame);
      }
    }
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = this.factory(this.url);
      this.ws = ws;
      ws.on("open", () => {
        const hello: BridgeFrame = {
          v: 1,
          id: crypto.randomUUID(),
          type: "hello",
          payload: { client: "common-thread-core", protocol: 1 },
        };
        ws.send(JSON.stringify(hello));
        resolve();
      });
      ws.on("message", (data) => {
        try {
          const frame = JSON.parse(String(data)) as BridgeFrame;
          this.handleFrame(frame);
        } catch {
          // ignore malformed
        }
      });
      ws.on("error", (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      ws.on("close", () => {
        this.ws = null;
        this.connectPromise = null;
      });
    });
    return this.connectPromise;
  }

  private async request(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<BridgeFrame> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Phone bridge offline");
    }
    const id = crypto.randomUUID();
    const frame: BridgeFrame = { v: 1, id, type, payload };
    const result = new Promise<BridgeFrame>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as BridgeFrame),
        reject,
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Phone bridge request timeout"));
        }
      }, 10_000);
    });
    this.ws.send(JSON.stringify(frame));
    return result;
  }

  async publishPublicEvent(event: CommonThreadEvent): Promise<{
    upstreamMessageID: string;
    state: "queued" | "sent" | "failed" | "unknown";
  }> {
    const wire = encodeWirePayload(event);
    const frame = await this.request("publish_public", { event, wire });
    if (frame.type !== "delivery_state" || !frame.payload) {
      return { upstreamMessageID: "", state: "unknown" };
    }
    const state = String(frame.payload.state) as
      | "queued"
      | "sent"
      | "failed"
      | "unknown";
    return {
      upstreamMessageID: String(frame.payload.upstreamMessageID ?? ""),
      state:
        state === "queued" ||
        state === "sent" ||
        state === "failed" ||
        state === "unknown"
          ? state
          : "unknown",
    };
  }

  async canOpenEncryptedPrivateConversation(peerID: PeerID): Promise<boolean> {
    const frame = await this.request("can_open_private", { peerID });
    if (frame.type !== "can_open_private_result" || !frame.payload) {
      return false;
    }
    return Boolean(frame.payload.available);
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }
}
