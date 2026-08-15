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
import { AsyncEventQueue } from "./AsyncEventQueue.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  PendingRequests,
  coerceDeliveryState,
  encodeFrame,
  makeFrame,
  parseFrame,
  type BridgeFrame,
  type DeliveryState,
} from "./BridgeProtocol.js";
import { randomUUID } from "../Domain/RandomId.js";

export interface PhoneBridgeOptions {
  url?: string;
  /** Injected WebSocket for tests. */
  webSocketFactory?: (url: string) => WebSocket;
}

/**
 * Loopback WebSocket adapter to the iOS companion.
 * Does not touch Core Bluetooth — companion owns the mesh.
 */
export class PhoneBridgeMeshTransport implements CommonThreadMeshTransport {
  private readonly url: string;
  private readonly factory: (url: string) => WebSocket;
  private ws: WebSocket | null = null;
  private readonly pending = new PendingRequests(
    10_000,
    "Phone bridge request timeout",
  );
  private readonly inbound = new AsyncEventQueue();
  private connectPromise: Promise<void> | null = null;

  readonly receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent>;

  constructor(options: PhoneBridgeOptions = {}) {
    this.url = options.url ?? "ws://127.0.0.1:17832";
    this.factory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    this.receivedPublicEvents = this.inbound.iterable;
  }

  private handleFrame(frame: BridgeFrame): void {
    if (frame.type === "public_event" && frame.payload) {
      try {
        const event = parseCommonThreadEvent(frame.payload.event);
        this.inbound.push({
          event,
          upstreamMessageID: String(frame.payload.upstreamMessageID),
          receivedAt: new Date(String(frame.payload.receivedAt)),
        });
      } catch {
        // Ignore invalid envelopes from companion.
      }
      return;
    }
    this.pending.settle(frame);
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
        ws.send(
          encodeFrame(
            makeFrame(
              "hello",
              {
                client: "common-thread-core",
                protocol: BRIDGE_PROTOCOL_VERSION,
              },
              randomUUID(),
            ),
          ),
        );
        resolve();
      });
      ws.on("message", (data) => {
        const frame = parseFrame(data);
        if (frame) {
          this.handleFrame(frame);
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
    type: "publish_public" | "can_open_private",
    payload: Record<string, unknown>,
  ): Promise<BridgeFrame> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Phone bridge offline");
    }
    const id = randomUUID();
    const result = this.pending.register(id);
    this.ws.send(encodeFrame(makeFrame(type, payload, id)));
    return result;
  }

  async publishPublicEvent(event: CommonThreadEvent): Promise<{
    upstreamMessageID: string;
    state: DeliveryState;
  }> {
    const wire = encodeWirePayload(event);
    const frame = await this.request("publish_public", { event, wire });
    if (frame.type !== "delivery_state" || !frame.payload) {
      return { upstreamMessageID: "", state: "unknown" };
    }
    return {
      upstreamMessageID: String(frame.payload.upstreamMessageID ?? ""),
      state: coerceDeliveryState(frame.payload.state),
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
    this.pending.rejectAll(new Error("Phone bridge closed"));
    this.inbound.close();
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }
}
