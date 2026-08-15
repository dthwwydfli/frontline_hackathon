/**
 * PLD-05 wire protocol, shared by every WebSocket-based mesh adapter.
 *
 * Two servers speak it:
 *   - the iOS companion over loopback (`PhoneBridgeMeshTransport`)
 *   - the LAN relay hub over a local network (`LanRelayMeshTransport`)
 *
 * The core PLD-05 frame set is fixed. Relay-only frames are additive and
 * carry transport metadata (peer presence, backlog) that must never appear
 * inside a `CommonThreadEvent` body.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

/** PLD-05 §"Message envelope". */
export interface BridgeFrame {
  v: number;
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export type DeliveryState = "queued" | "sent" | "failed" | "unknown";

/** Frames defined by PLD-05. */
export type BridgeFrameType =
  | "hello"
  | "hello_ack"
  | "publish_public"
  | "delivery_state"
  | "public_event"
  | "can_open_private"
  | "can_open_private_result"
  | "error";

/**
 * Additive frames used only by the LAN relay. The companion ignores them.
 *
 * - `presence` / `presence_state`: display names for nearby peers. Nicknames
 *   only — never contact details, and never persisted into events.
 * - `backlog`: store-and-forward replay so a device that joins late sees the
 *   threads that already exist.
 */
export type RelayFrameType = "presence" | "presence_state" | "backlog";

export interface PeerPresence {
  peerID: string;
  displayName: string;
}

export function makeFrame(
  type: BridgeFrameType | RelayFrameType,
  payload?: Record<string, unknown>,
  id?: string,
): BridgeFrame {
  return { v: BRIDGE_PROTOCOL_VERSION, ...(id ? { id } : {}), type, payload };
}

export function encodeFrame(frame: BridgeFrame): string {
  return JSON.stringify(frame);
}

/** Returns null for anything that is not a well-formed frame. */
export function parseFrame(raw: unknown): BridgeFrame | null {
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as BridgeFrame).type !== "string"
    ) {
      return null;
    }
    return parsed as BridgeFrame;
  } catch {
    return null;
  }
}

export function coerceDeliveryState(value: unknown): DeliveryState {
  const state = String(value);
  return state === "queued" ||
    state === "sent" ||
    state === "failed" ||
    state === "unknown"
    ? state
    : "unknown";
}

export function coercePresence(value: unknown): PeerPresence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PeerPresence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const peerID = (item as PeerPresence).peerID;
    if (typeof peerID !== "string" || peerID.length === 0) {
      continue;
    }
    out.push({
      peerID,
      displayName: String((item as PeerPresence).displayName ?? ""),
    });
  }
  return out;
}

interface PendingEntry {
  resolve: (frame: BridgeFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Correlates request frames with their responses by `id`.
 * Shared so both adapters time out and fail identically.
 */
export class PendingRequests {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(
    private readonly timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly timeoutMessage = "Bridge request timeout",
  ) {}

  register(id: string): Promise<BridgeFrame> {
    return new Promise<BridgeFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(id);
        reject(new Error(this.timeoutMessage));
      }, this.timeoutMs);
      // Never hold a Node process open waiting on a bridge reply.
      (timer as unknown as { unref?: () => void }).unref?.();
      this.entries.set(id, { resolve, reject, timer });
    });
  }

  /** True when the frame was a response to a tracked request. */
  settle(frame: BridgeFrame): boolean {
    if (!frame.id) {
      return false;
    }
    const entry = this.entries.get(frame.id);
    if (!entry) {
      return false;
    }
    this.entries.delete(frame.id);
    clearTimeout(entry.timer);
    if (frame.type === "error") {
      entry.reject(new Error(String(frame.payload?.message ?? "bridge error")));
    } else {
      entry.resolve(frame);
    }
    return true;
  }

  rejectAll(error: Error): void {
    for (const [id, entry] of this.entries) {
      this.entries.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
