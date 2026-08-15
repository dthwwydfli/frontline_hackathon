import { describe, expect, it } from "vitest";
import type { CommonThreadEvent } from "../src/Domain/CommonThreadEvent.js";
import { reduceThread } from "../src/Domain/ThreadReducer.js";

const threadID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function request(): CommonThreadEvent {
  return {
    v: 1,
    eventID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    threadID,
    area: "riverside-estate",
    kind: "thread.created",
    authorPeerID: "peer-a",
    createdAt: "2026-08-15T12:00:00.000Z",
    body: {
      type: "request",
      title: "Need water",
      text: "Shared tap is off",
      roughPlace: "block C",
      category: "water",
    },
  };
}

function offer(): CommonThreadEvent {
  return {
    v: 1,
    eventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    threadID,
    area: "riverside-estate",
    kind: "thread.created",
    authorPeerID: "peer-c",
    createdAt: "2026-08-15T12:01:00.000Z",
    body: {
      type: "offer",
      title: "I have bottles",
      text: "Can bring a pack",
      roughPlace: "block B",
      category: "water",
    },
  };
}

describe("ThreadReducer", () => {
  it("materialises request, reply, accept, resolve", () => {
    const reply: CommonThreadEvent = {
      v: 1,
      eventID: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      threadID,
      area: "riverside-estate",
      kind: "thread.reply.created",
      authorPeerID: "peer-b",
      createdAt: "2026-08-15T12:00:30.000Z",
      body: { text: "Still out here too" },
    };
    const accept: CommonThreadEvent = {
      v: 1,
      eventID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      threadID,
      area: "riverside-estate",
      kind: "thread.offer.accepted",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:02:00.000Z",
      body: {
        acceptedOfferEventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      },
    };
    const resolve: CommonThreadEvent = {
      v: 1,
      eventID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      threadID,
      area: "riverside-estate",
      kind: "thread.resolved",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:03:00.000Z",
      body: { note: "Sorted" },
    };

    const open = reduceThread(threadID, [request(), reply]);
    expect(open?.status).toBe("Open");
    expect(open?.replies).toHaveLength(1);

    const matched = reduceThread(threadID, [
      request(),
      reply,
      offer(),
      accept,
    ]);
    expect(matched?.status).toBe("Matched");
    expect(matched?.acceptedOfferAuthorPeerID).toBe("peer-c");

    const resolved = reduceThread(threadID, [
      request(),
      offer(),
      accept,
      resolve,
    ]);
    expect(resolved?.status).toBe("Resolved");
    expect(resolved?.resolutionNote).toBe("Sorted");
  });

  it("ignores unauthorised accept and does not reopen resolved", () => {
    const rogueAccept: CommonThreadEvent = {
      v: 1,
      eventID: "99999999-9999-9999-9999-999999999999",
      threadID,
      area: "riverside-estate",
      kind: "thread.offer.accepted",
      authorPeerID: "peer-c",
      createdAt: "2026-08-15T12:02:00.000Z",
      body: {
        acceptedOfferEventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      },
    };
    const matched = reduceThread(threadID, [request(), offer(), rogueAccept]);
    expect(matched?.status).toBe("Open");

    const resolve: CommonThreadEvent = {
      v: 1,
      eventID: "88888888-8888-8888-8888-888888888888",
      threadID,
      area: "riverside-estate",
      kind: "thread.resolved",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:03:00.000Z",
      body: {},
    };
    const reopen: CommonThreadEvent = {
      v: 1,
      eventID: "77777777-7777-7777-7777-777777777777",
      threadID,
      area: "riverside-estate",
      kind: "thread.offer.accepted",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:04:00.000Z",
      body: {
        acceptedOfferEventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      },
    };
    const end = reduceThread(threadID, [
      request(),
      offer(),
      resolve,
      reopen,
    ]);
    expect(end?.status).toBe("Resolved");
  });
});
