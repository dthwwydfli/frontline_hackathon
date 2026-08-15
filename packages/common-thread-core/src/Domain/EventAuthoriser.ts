import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  compareEventOrder,
  parseCommonThreadEvent,
  type CommonThreadEvent,
  type ThreadCreatedBody,
  type ThreadOfferAcceptedBody,
} from "./CommonThreadEvent.js";

export type AuthorisationFailureCode =
  | "schema"
  | "version"
  | "area"
  | "authority"
  | "reference"
  | "duplicate_root"
  | "malformed";

export interface AuthorisationResult {
  ok: boolean;
  code?: AuthorisationFailureCode;
  reason?: string;
}

export interface AuthoriserContext {
  /** Events already accepted for this thread (valid only). */
  existingThreadEvents: readonly CommonThreadEvent[];
  /** Allowed area; defaults to riverside-estate. */
  allowedArea?: string;
}

/**
 * Validates schema version, area, content bounds (via parse), creator
 * authority for state transitions, and references to root/offer events.
 */
export class EventAuthoriser {
  authorise(
    event: unknown,
    context: AuthoriserContext,
  ): AuthorisationResult {
    let parsed: CommonThreadEvent;
    try {
      parsed = parseCommonThreadEvent(event);
    } catch (err) {
      return {
        ok: false,
        code: "schema",
        reason: err instanceof Error ? err.message : "schema error",
      };
    }

    if (parsed.v !== PROTOCOL_VERSION) {
      return {
        ok: false,
        code: "version",
        reason: `Unsupported protocol version ${parsed.v}`,
      };
    }

    const area = context.allowedArea ?? DEFAULT_AREA;
    if (parsed.area !== area) {
      return {
        ok: false,
        code: "area",
        reason: `Out-of-area event: ${parsed.area}`,
      };
    }

    const existing = context.existingThreadEvents.filter(
      (e) => e.threadID === parsed.threadID,
    );
    // The root is the *earliest* thread.created, matching `reduceThread`.
    // Never the first element of the array: a store is free to return rows in
    // any order (IndexedDB returns them by key, not by insertion), and picking
    // positionally would treat a later offer as the root and reject the real
    // creator's accept/resolve.
    const root = existing
      .filter((e) => e.kind === "thread.created")
      .sort(compareEventOrder)[0];

    switch (parsed.kind) {
      case "thread.created": {
        if (root) {
          const body = parsed.body as ThreadCreatedBody;
          // Additional offers allowed; second request/update roots rejected.
          if (body.type !== "offer") {
            return {
              ok: false,
              code: "duplicate_root",
              reason: "Thread already has a root event",
            };
          }
        }
        return { ok: true };
      }
      case "thread.reply.created": {
        if (!root) {
          return {
            ok: false,
            code: "reference",
            reason: "No root event for thread",
          };
        }
        return { ok: true };
      }
      case "thread.offer.accepted": {
        if (!root) {
          return {
            ok: false,
            code: "reference",
            reason: "No root event for thread",
          };
        }
        if (parsed.authorPeerID !== root.authorPeerID) {
          return {
            ok: false,
            code: "authority",
            reason: "Only the request creator may accept an offer",
          };
        }
        const body = parsed.body as ThreadOfferAcceptedBody;
        const offer = existing.find(
          (e) =>
            e.eventID === body.acceptedOfferEventID &&
            e.kind === "thread.created" &&
            (e.body as ThreadCreatedBody).type === "offer",
        );
        if (!offer) {
          return {
            ok: false,
            code: "reference",
            reason: "acceptedOfferEventID does not reference a known offer",
          };
        }
        return { ok: true };
      }
      case "thread.resolved": {
        if (!root) {
          return {
            ok: false,
            code: "reference",
            reason: "No root event for thread",
          };
        }
        if (parsed.authorPeerID !== root.authorPeerID) {
          return {
            ok: false,
            code: "authority",
            reason: "Only the request creator may resolve the thread",
          };
        }
        return { ok: true };
      }
      case "guidance.shared":
        return { ok: true };
      default:
        return { ok: false, code: "malformed", reason: "Unknown kind" };
    }
  }
}
