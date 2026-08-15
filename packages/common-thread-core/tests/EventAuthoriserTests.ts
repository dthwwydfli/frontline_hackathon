import { describe, expect, it } from "vitest";
import { EventAuthoriser } from "../src/Domain/EventAuthoriser.js";
import type { CommonThreadEvent } from "../src/Domain/CommonThreadEvent.js";

const authoriser = new EventAuthoriser();

const root: CommonThreadEvent = {
  v: 1,
  eventID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  threadID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  area: "riverside-estate",
  kind: "thread.created",
  authorPeerID: "peer-a",
  createdAt: "2026-08-15T12:00:00.000Z",
  body: {
    type: "request",
    title: "Need help",
    text: "Lift stuck",
    roughPlace: "tower 2",
    category: "access",
  },
};

const offer: CommonThreadEvent = {
  v: 1,
  eventID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  threadID: root.threadID,
  area: "riverside-estate",
  kind: "thread.created",
  authorPeerID: "peer-c",
  createdAt: "2026-08-15T12:01:00.000Z",
  body: {
    type: "offer",
    title: "I can help",
    text: "Nearby",
    roughPlace: "tower 1",
    category: "access",
  },
};

describe("EventAuthoriser", () => {
  it("rejects accept/resolve from non-creator", () => {
    const accept = {
      ...root,
      eventID: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      kind: "thread.offer.accepted" as const,
      authorPeerID: "peer-c",
      createdAt: "2026-08-15T12:02:00.000Z",
      body: { acceptedOfferEventID: offer.eventID },
    };
    const r = authoriser.authorise(accept, {
      existingThreadEvents: [root, offer],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("authority");

    const resolve = {
      ...root,
      eventID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      kind: "thread.resolved" as const,
      authorPeerID: "peer-c",
      createdAt: "2026-08-15T12:03:00.000Z",
      body: {},
    };
    const r2 = authoriser.authorise(resolve, {
      existingThreadEvents: [root],
    });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe("authority");
  });

  it("rejects out-of-area and malformed events", () => {
    const outOfArea = { ...root, area: "other-estate", eventID: "1" };
    const a = authoriser.authorise(outOfArea, { existingThreadEvents: [] });
    expect(a.ok).toBe(false);
    expect(a.code).toBe("area");

    const malformed = { v: 1, kind: "nope" };
    const b = authoriser.authorise(malformed, { existingThreadEvents: [] });
    expect(b.ok).toBe(false);
    expect(b.code).toBe("schema");
  });

  it("allows creator accept when offer exists", () => {
    const accept = {
      v: 1,
      eventID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      threadID: root.threadID,
      area: "riverside-estate",
      kind: "thread.offer.accepted",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:02:00.000Z",
      body: { acceptedOfferEventID: offer.eventID },
    };
    const r = authoriser.authorise(accept, {
      existingThreadEvents: [root, offer],
    });
    expect(r.ok).toBe(true);
  });
});
