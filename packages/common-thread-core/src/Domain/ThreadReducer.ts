import {
  compareEventOrder,
  type CommonThreadEvent,
  type ThreadCreatedBody,
  type ThreadOfferAcceptedBody,
  type ThreadReplyBody,
  type ThreadResolvedBody,
} from "./CommonThreadEvent.js";
import type { MaterialisedThread } from "./ThreadState.js";
import {
  ContentSafetyPolicy,
  type ContentSafetyWarning,
} from "./ContentSafetyPolicy.js";

/**
 * Pure reducer: ordered valid events for one thread → MaterialisedThread.
 * Ordering: createdAt, then eventID. Clock skew is a known limitation —
 * we do not rewrite history to hide it.
 *
 * `thread.created` with type=offer after a root exists registers an offer
 * candidate (does not replace the root). Accept references that eventID.
 */
export function reduceThread(
  threadID: string,
  events: readonly CommonThreadEvent[],
  safety: ContentSafetyPolicy = new ContentSafetyPolicy(),
): MaterialisedThread | null {
  const ordered = [...events]
    .filter((e) => e.threadID === threadID)
    .sort(compareEventOrder);

  let materialised: MaterialisedThread | null = null;
  const offerAuthors = new Map<string, string>();
  const warnings: ContentSafetyWarning[] = [];

  for (const event of ordered) {
    switch (event.kind) {
      case "thread.created": {
        const body = event.body as ThreadCreatedBody;
        if (materialised === null) {
          warnings.push(...safety.inspectText(body.title));
          warnings.push(...safety.inspectText(body.text));
          warnings.push(...safety.inspectText(body.roughPlace));
          materialised = {
            threadID,
            area: event.area,
            status: "Open",
            root: {
              eventID: event.eventID,
              authorPeerID: event.authorPeerID,
              type: body.type,
              title: body.title,
              text: body.text,
              roughPlace: body.roughPlace,
              category: body.category,
              expiresAt: body.expiresAt,
              createdAt: event.createdAt,
            },
            replies: [],
            safetyWarnings: [],
          };
          if (body.type === "offer") {
            offerAuthors.set(event.eventID, event.authorPeerID);
          }
        } else if (body.type === "offer") {
          warnings.push(...safety.inspectText(body.title));
          warnings.push(...safety.inspectText(body.text));
          offerAuthors.set(event.eventID, event.authorPeerID);
        }
        // Duplicate or non-offer thread.created after root: ignore.
        break;
      }
      case "thread.reply.created": {
        if (!materialised) {
          continue;
        }
        const body = event.body as ThreadReplyBody;
        warnings.push(...safety.inspectText(body.text));
        materialised.replies.push({
          eventID: event.eventID,
          authorPeerID: event.authorPeerID,
          text: body.text,
          createdAt: event.createdAt,
        });
        break;
      }
      case "thread.offer.accepted": {
        if (!materialised) {
          continue;
        }
        if (event.authorPeerID !== materialised.root.authorPeerID) {
          continue;
        }
        if (materialised.status === "Resolved") {
          continue;
        }
        const body = event.body as ThreadOfferAcceptedBody;
        const offerAuthor = offerAuthors.get(body.acceptedOfferEventID);
        if (!offerAuthor) {
          continue;
        }
        materialised.acceptedOfferEventID = body.acceptedOfferEventID;
        materialised.acceptedOfferAuthorPeerID = offerAuthor;
        if (materialised.status === "Open") {
          materialised.status = "Matched";
        }
        break;
      }
      case "thread.resolved": {
        if (!materialised) {
          continue;
        }
        if (event.authorPeerID !== materialised.root.authorPeerID) {
          continue;
        }
        if (materialised.status === "Resolved") {
          continue;
        }
        const body = event.body as ThreadResolvedBody;
        if (body.note) {
          warnings.push(...safety.inspectText(body.note));
          materialised.resolutionNote = body.note;
        }
        materialised.status = "Resolved";
        break;
      }
      case "guidance.shared":
        continue;
      default:
        continue;
    }
  }

  if (!materialised) {
    return null;
  }
  materialised.safetyWarnings = warnings;
  return materialised;
}

/** @deprecated Use reduceThread — kept for call-site clarity. */
export function reduceThreadWithOffers(
  threadID: string,
  events: readonly CommonThreadEvent[],
  safety?: ContentSafetyPolicy,
): MaterialisedThread | null {
  return reduceThread(threadID, events, safety);
}

export { compareEventOrder };
