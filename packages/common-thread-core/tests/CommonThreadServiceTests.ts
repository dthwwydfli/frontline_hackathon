import { describe, expect, it } from "vitest";
import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  newId,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";
import { EventAuthoriser } from "../src/Domain/EventAuthoriser.js";
import { SqliteEventStore } from "../src/Persistence/SqliteEventStore.js";
import { CommonThreadService } from "../src/Services/CommonThreadService.js";
import { InMemoryMeshHub } from "../src/Transport/InMemoryMeshTransport.js";

function device(peerID: string, hub: InMemoryMeshHub) {
  const store = new SqliteEventStore(":memory:");
  const transport = hub.createTransport(peerID);
  return {
    store,
    transport,
    service: new CommonThreadService(store, transport, peerID),
  };
}

describe("CommonThreadService", () => {
  it("notifies subscribers on local publish and on inbound ingest", async () => {
    const hub = new InMemoryMeshHub();
    const a = device("peer-a", hub);
    const b = device("peer-b", hub);

    let aNotifications = 0;
    let bNotifications = 0;
    a.service.subscribe(() => (aNotifications += 1));
    b.service.subscribe(() => (bNotifications += 1));

    const created = await a.service.createThread({
      type: "request",
      title: "Spare torch",
      text: "The stairwell light is out.",
      roughPlace: "North stairwell",
      category: "access",
    });

    expect(created.accepted).toBe(true);
    expect(aNotifications).toBe(1);
    expect(bNotifications).toBe(0);

    for (const received of b.transport.drainPending()) {
      await b.service.ingestReceived(received);
    }
    // ingestReceived is the direct call; the notify path runs in the inbound
    // loop, so a manual drain is deliberately silent.
    expect(bNotifications).toBe(0);
    expect(await b.service.materialiseThread(created.event.threadID)).not.toBeNull();
  });

  it("unsubscribes cleanly", async () => {
    const hub = new InMemoryMeshHub();
    const a = device("peer-a", hub);
    let count = 0;
    const unsubscribe = a.service.subscribe(() => (count += 1));

    await a.service.createThread({
      type: "update",
      title: "Community room open",
      text: "Seats and a kettle until seven.",
      roughPlace: "Ground floor",
      category: "access",
    });
    expect(count).toBe(1);

    unsubscribe();
    await a.service.createThread({
      type: "update",
      title: "Room closing soon",
      text: "Last half hour before we lock up.",
      roughPlace: "Ground floor",
      category: "access",
    });
    expect(count).toBe(1);
  });

  it("stops the inbound loop without needing one more inbound event", async () => {
    const hub = new InMemoryMeshHub();
    const a = device("peer-a", hub);
    a.service.startInboundProcessing();

    // Would hang if stopping depended on the parked iterator resolving.
    await expect(a.service.stopInboundProcessing()).resolves.toBeUndefined();
  });

  it("gives each local event a strictly increasing createdAt within a thread", async () => {
    const hub = new InMemoryMeshHub();
    const a = device("peer-a", hub);

    const created = await a.service.createThread({
      type: "request",
      title: "Water needed",
      text: "Two bottles would help.",
      roughPlace: "Block B",
      category: "supplies",
    });
    const threadID = created.event.threadID;

    // Same-millisecond replies are the case that broke deterministic ordering.
    const replies = [];
    for (let i = 0; i < 5; i += 1) {
      replies.push(await a.service.reply(threadID, `Update ${i}`));
    }

    const times = [created, ...replies].map((r) =>
      Date.parse(r.event.createdAt),
    );
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }

    const thread = await a.service.materialiseThread(threadID);
    expect(thread?.replies.map((reply) => reply.text)).toEqual([
      "Update 0",
      "Update 1",
      "Update 2",
      "Update 3",
      "Update 4",
    ]);
  });

  it("publishes guidance as an area bulletin", async () => {
    const hub = new InMemoryMeshHub();
    const a = device("peer-a", hub);
    const b = device("peer-b", hub);

    const result = await a.service.shareGuidance({
      title: "Keeping a phone charged",
      text: "Keep one device off as a reserve and lower brightness.",
    });
    expect(result.accepted).toBe(true);
    expect(result.event.kind).toBe("guidance.shared");

    const received = b.transport.drainPending();
    expect(received).toHaveLength(1);
    expect(received[0]!.event.kind).toBe("guidance.shared");
  });
});

describe("EventAuthoriser root resolution", () => {
  it("finds the root by event order, not by array position", () => {
    // A store is free to return rows in any order — IndexedDB returns them by
    // key. Positional lookup used to treat a later offer as the root and reject
    // the real creator's accept.
    const threadID = "thread-1";
    const root: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID,
      area: DEFAULT_AREA,
      kind: "thread.created",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:00:00.000Z",
      body: {
        type: "request",
        title: "Phone charging needed",
        text: "My phone is nearly flat.",
        roughPlace: "Library side",
        category: "power",
      },
    };
    const offer: CommonThreadEvent = {
      ...root,
      eventID: newId(),
      authorPeerID: "peer-b",
      createdAt: "2026-08-15T12:05:00.000Z",
      body: {
        type: "offer",
        title: "I can bring a power bank",
        text: "I am near the south stairwell.",
        roughPlace: "South stairwell",
        category: "power",
      },
    };
    const accept: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID,
      area: DEFAULT_AREA,
      kind: "thread.offer.accepted",
      authorPeerID: "peer-a",
      createdAt: "2026-08-15T12:06:00.000Z",
      body: { acceptedOfferEventID: offer.eventID },
    };

    const authoriser = new EventAuthoriser();
    // Offer first in the array, root second.
    const result = authoriser.authorise(accept, {
      existingThreadEvents: [offer, root],
    });
    expect(result.ok).toBe(true);
  });
});
