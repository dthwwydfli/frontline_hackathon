/** Opaque peer identity from upstream mesh. */

import { randomUUID } from "./RandomId.js";
export type PeerID = string;

export const PROTOCOL_VERSION = 1;
export const DEFAULT_AREA = "riverside-estate";
export const MAX_PUBLIC_TEXT_CODE_POINTS = 300;
export const WIRE_PREFIX = "CT1:";

export type EventKind =
  | "thread.created"
  | "thread.reply.created"
  | "thread.offer.accepted"
  | "thread.resolved"
  | "guidance.shared";

export type ThreadCreatedType = "request" | "offer" | "update";

export interface ThreadCreatedBody {
  type: ThreadCreatedType;
  title: string;
  text: string;
  roughPlace: string;
  category: string;
  expiresAt?: string;
}

export interface ThreadReplyBody {
  text: string;
}

export interface ThreadOfferAcceptedBody {
  acceptedOfferEventID: string;
}

export interface ThreadResolvedBody {
  note?: string;
}

export interface GuidanceSharedBody {
  title: string;
  text: string;
}

export type EventBody =
  | ThreadCreatedBody
  | ThreadReplyBody
  | ThreadOfferAcceptedBody
  | ThreadResolvedBody
  | GuidanceSharedBody;

export interface CommonThreadEvent {
  v: number;
  eventID: string;
  threadID: string;
  area: string;
  kind: EventKind;
  authorPeerID: PeerID;
  createdAt: string;
  body: EventBody;
}

export function unicodeLength(text: string): number {
  return [...text].length;
}

export function assertPublicTextBound(text: string, field: string): void {
  if (unicodeLength(text) > MAX_PUBLIC_TEXT_CODE_POINTS) {
    throw new Error(
      `${field} exceeds ${MAX_PUBLIC_TEXT_CODE_POINTS} Unicode characters`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing or invalid string field: ${key}`);
  }
  return v;
}

function parseBody(kind: EventKind, raw: unknown): EventBody {
  if (!isRecord(raw)) {
    throw new Error("Event body must be an object");
  }
  switch (kind) {
    case "thread.created": {
      const type = requireString(raw, "type");
      if (type !== "request" && type !== "offer" && type !== "update") {
        throw new Error("thread.created type must be request|offer|update");
      }
      const title = requireString(raw, "title");
      const text = requireString(raw, "text");
      const roughPlace = requireString(raw, "roughPlace");
      const category = requireString(raw, "category");
      assertPublicTextBound(title, "title");
      assertPublicTextBound(text, "text");
      assertPublicTextBound(roughPlace, "roughPlace");
      assertPublicTextBound(category, "category");
      const body: ThreadCreatedBody = {
        type,
        title,
        text,
        roughPlace,
        category,
      };
      if (raw.expiresAt !== undefined) {
        if (typeof raw.expiresAt !== "string") {
          throw new Error("expiresAt must be an ISO string");
        }
        body.expiresAt = raw.expiresAt;
      }
      return body;
    }
    case "thread.reply.created": {
      const text = requireString(raw, "text");
      assertPublicTextBound(text, "text");
      return { text };
    }
    case "thread.offer.accepted": {
      return {
        acceptedOfferEventID: requireString(raw, "acceptedOfferEventID"),
      };
    }
    case "thread.resolved": {
      if (raw.note !== undefined) {
        if (typeof raw.note !== "string") {
          throw new Error("note must be a string");
        }
        assertPublicTextBound(raw.note, "note");
        return { note: raw.note };
      }
      return {};
    }
    case "guidance.shared": {
      const title = requireString(raw, "title");
      const text = requireString(raw, "text");
      assertPublicTextBound(title, "title");
      assertPublicTextBound(text, "text");
      return { title, text };
    }
    default:
      throw new Error(`Unknown event kind: ${kind as string}`);
  }
}

const KINDS = new Set<EventKind>([
  "thread.created",
  "thread.reply.created",
  "thread.offer.accepted",
  "thread.resolved",
  "guidance.shared",
]);

export function parseCommonThreadEvent(raw: unknown): CommonThreadEvent {
  if (!isRecord(raw)) {
    throw new Error("Event must be an object");
  }
  const v = raw.v;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error("Invalid protocol version");
  }
  const kindRaw = requireString(raw, "kind");
  if (!KINDS.has(kindRaw as EventKind)) {
    throw new Error(`Unknown event kind: ${kindRaw}`);
  }
  const kind = kindRaw as EventKind;
  const event: CommonThreadEvent = {
    v,
    eventID: requireString(raw, "eventID"),
    threadID: requireString(raw, "threadID"),
    area: requireString(raw, "area"),
    kind,
    authorPeerID: requireString(raw, "authorPeerID"),
    createdAt: requireString(raw, "createdAt"),
    body: parseBody(kind, raw.body),
  };
  return event;
}

export function encodeCommonThreadEvent(event: CommonThreadEvent): string {
  // Re-parse to enforce bounds before wire encode.
  const validated = parseCommonThreadEvent(event);
  return JSON.stringify(validated);
}

export function encodeWirePayload(event: CommonThreadEvent): string {
  return `${WIRE_PREFIX}${encodeCommonThreadEvent(event)}`;
}

export function decodeWirePayload(wire: string): CommonThreadEvent {
  if (!wire.startsWith(WIRE_PREFIX)) {
    throw new Error("Not a Common Thread wire payload");
  }
  const json = wire.slice(WIRE_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON in Common Thread wire payload");
  }
  return parseCommonThreadEvent(parsed);
}

export function compareEventOrder(
  a: CommonThreadEvent,
  b: CommonThreadEvent,
): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) {
    return ta - tb;
  }
  return a.eventID < b.eventID ? -1 : a.eventID > b.eventID ? 1 : 0;
}

export function newId(): string {
  return randomUUID();
}
