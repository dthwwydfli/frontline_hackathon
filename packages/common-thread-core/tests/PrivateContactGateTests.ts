import { describe, expect, it } from "vitest";
import { PrivateContactGate } from "../src/Services/PrivateContactGate.js";
import type { MaterialisedThread } from "../src/Domain/ThreadState.js";
import type { CommonThreadMeshTransport } from "../src/Transport/CommonThreadMeshTransport.js";
import type { PeerID } from "../src/Domain/CommonThreadEvent.js";

function thread(partial?: Partial<MaterialisedThread>): MaterialisedThread {
  return {
    threadID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    area: "riverside-estate",
    status: "Open",
    root: {
      eventID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      authorPeerID: "peer-a",
      type: "request",
      title: "Need help",
      text: "Please",
      roughPlace: "yard",
      category: "general",
      createdAt: "2026-08-15T12:00:00.000Z",
    },
    replies: [],
    safetyWarnings: [],
    ...partial,
  };
}

function transport(available: Set<string>): CommonThreadMeshTransport {
  return {
    publishPublicEvent: async () => ({
      upstreamMessageID: "x",
      state: "sent",
    }),
    receivedPublicEvents: {
      async *[Symbol.asyncIterator]() {
        /* empty */
      },
    },
    canOpenEncryptedPrivateConversation: async (peerID: PeerID) =>
      available.has(peerID),
  };
}

describe("PrivateContactGate", () => {
  it("denies before accept", async () => {
    const gate = new PrivateContactGate(transport(new Set(["peer-c"])));
    const result = await gate.evaluate("peer-a", thread());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_accept");
  });

  it("allows requester and offer author after accept when transport ready", async () => {
    const matched = thread({
      status: "Matched",
      acceptedOfferEventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      acceptedOfferAuthorPeerID: "peer-c",
    });
    const gate = new PrivateContactGate(transport(new Set(["peer-a", "peer-c"])));

    const asRequester = await gate.evaluate("peer-a", matched);
    expect(asRequester.allowed).toBe(true);
    expect(asRequester.peerID).toBe("peer-c");

    const asOffer = await gate.evaluate("peer-c", matched);
    expect(asOffer.allowed).toBe(true);
    expect(asOffer.peerID).toBe("peer-a");

    const stranger = await gate.evaluate("peer-x", matched);
    expect(stranger.allowed).toBe(false);
    expect(stranger.reason).toBe("not_participant");
  });

  it("denies when Noise/private path unavailable", async () => {
    const matched = thread({
      status: "Matched",
      acceptedOfferEventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      acceptedOfferAuthorPeerID: "peer-c",
    });
    const gate = new PrivateContactGate(transport(new Set()));
    const result = await gate.evaluate("peer-a", matched);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("transport_unavailable");
  });
});
