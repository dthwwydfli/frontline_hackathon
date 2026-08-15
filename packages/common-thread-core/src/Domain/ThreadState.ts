import type { PeerID, ThreadCreatedType } from "./CommonThreadEvent.js";
import type { ContentSafetyWarning } from "./ContentSafetyPolicy.js";

export type ThreadStatus = "Open" | "Matched" | "Resolved";

export interface MaterialisedReply {
  eventID: string;
  authorPeerID: PeerID;
  text: string;
  createdAt: string;
}

export interface MaterialisedRoot {
  eventID: string;
  authorPeerID: PeerID;
  type: ThreadCreatedType;
  title: string;
  text: string;
  roughPlace: string;
  category: string;
  expiresAt?: string;
  createdAt: string;
}

export interface MaterialisedThread {
  threadID: string;
  area: string;
  status: ThreadStatus;
  root: MaterialisedRoot;
  replies: MaterialisedReply[];
  acceptedOfferEventID?: string;
  acceptedOfferAuthorPeerID?: PeerID;
  resolutionNote?: string;
  safetyWarnings: ContentSafetyWarning[];
}
