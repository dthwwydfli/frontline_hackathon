import type { PeerID } from "../Domain/CommonThreadEvent.js";
import type { MaterialisedThread } from "../Domain/ThreadState.js";
import type { CommonThreadMeshTransport } from "../Transport/CommonThreadMeshTransport.js";

export type PrivateGateDenial =
  | "no_accept"
  | "not_participant"
  | "transport_unavailable"
  | "resolved_without_match";

export interface PrivateContactGateResult {
  allowed: boolean;
  peerID?: PeerID;
  reason?: PrivateGateDenial;
}

/**
 * Returns true only when:
 * 1. A valid thread.offer.accepted exists for the request thread
 * 2. Caller is original requester or accepted-offer author
 * 3. Upstream transport reports encrypted private conversation available
 *
 * Domain never contains contact details — only eligible peer ID.
 */
export class PrivateContactGate {
  constructor(private readonly transport: CommonThreadMeshTransport) {}

  async evaluate(
    callerPeerID: PeerID,
    thread: MaterialisedThread,
  ): Promise<PrivateContactGateResult> {
    if (!thread.acceptedOfferEventID || !thread.acceptedOfferAuthorPeerID) {
      return { allowed: false, reason: "no_accept" };
    }

    const requester = thread.root.authorPeerID;
    const offerAuthor = thread.acceptedOfferAuthorPeerID;

    let counterpart: PeerID | undefined;
    if (callerPeerID === requester) {
      counterpart = offerAuthor;
    } else if (callerPeerID === offerAuthor) {
      counterpart = requester;
    } else {
      return { allowed: false, reason: "not_participant" };
    }

    const available =
      await this.transport.canOpenEncryptedPrivateConversation(counterpart);
    if (!available) {
      return {
        allowed: false,
        peerID: counterpart,
        reason: "transport_unavailable",
      };
    }

    return { allowed: true, peerID: counterpart };
  }
}
