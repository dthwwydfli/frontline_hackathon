import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  newId,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";
import { recordToEvent } from "../src/Persistence/CommonThreadEventStore.js";
import { IndexedDbEventStore } from "../src/Persistence/IndexedDbEventStore.js";

function event(overrides: Partial<CommonThreadEvent> = {}): CommonThreadEvent {
  return {
    v: PROTOCOL_VERSION,
    eventID: newId(),
    threadID: "thread-1",
    area: DEFAULT_AREA,
    kind: "thread.created",
    authorPeerID: "peer-a",
    createdAt: new Date().toISOString(),
    body: {
      type: "request",
      title: "Phone charging needed",
      text: "My phone is nearly flat.",
      roughPlace: "Library side",
      category: "power",
    },
    ...overrides,
  } as CommonThreadEvent;
}

describe("IndexedDbEventStore", () => {
  let store: IndexedDbEventStore;

  beforeEach(() => {
    // A fresh factory per test so databases never leak between cases.
    store = new IndexedDbEventStore("common-thread-test", new IDBFactory());
  });

  it("ingests a valid event and reads it back as the original envelope", async () => {
    const e = event();
    const result = await store.ingest({
      event: e,
      upstreamMessageID: "lan-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });

    expect(result.inserted).toBe(true);
    expect(result.duplicate).toBe(false);

    const record = await store.getByEventID(e.eventID);
    expect(record).not.toBeNull();
    expect(recordToEvent(record!)).toEqual(e);
  });

  it("deduplicates on eventID", async () => {
    const e = event();
    await store.ingest({
      event: e,
      upstreamMessageID: "lan-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    const again = await store.ingest({
      event: e,
      upstreamMessageID: "lan-2-different",
      receivedAt: new Date(),
      validationStatus: "valid",
    });

    expect(again.inserted).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(await store.listAllValid()).toHaveLength(1);
  });

  it("deduplicates on upstreamMessageID — the same relay hop twice", async () => {
    await store.ingest({
      event: event(),
      upstreamMessageID: "lan-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    const again = await store.ingest({
      event: event(),
      upstreamMessageID: "lan-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });

    expect(again.duplicate).toBe(true);
    expect(await store.listAllValid()).toHaveLength(1);
  });

  it("keeps rejected events out of valid listings but retrievable", async () => {
    const e = event();
    await store.ingest({
      event: e,
      upstreamMessageID: "lan-bad",
      receivedAt: new Date(),
      validationStatus: "rejected",
      rejectionReason: "Out-of-area event",
    });

    expect(await store.listAllValid()).toHaveLength(0);
    expect(await store.listValidByThreadID("thread-1")).toHaveLength(0);
    const record = await store.getByUpstreamMessageID("lan-bad");
    expect(record?.validationStatus).toBe("rejected");
    expect(record?.rejectionReason).toBe("Out-of-area event");
  });

  it("lists valid events by thread", async () => {
    await store.ingest({
      event: event({ threadID: "thread-1" }),
      upstreamMessageID: "lan-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    await store.ingest({
      event: event({ threadID: "thread-2" }),
      upstreamMessageID: "lan-2",
      receivedAt: new Date(),
      validationStatus: "valid",
    });

    expect(await store.listValidByThreadID("thread-1")).toHaveLength(1);
    expect(await store.listAllValid()).toHaveLength(2);
  });

  it("prunes only rejected rows older than the cutoff", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    await store.ingest({
      event: event(),
      upstreamMessageID: "lan-old-bad",
      receivedAt: old,
      validationStatus: "rejected",
      rejectionReason: "schema",
    });
    await store.ingest({
      event: event(),
      upstreamMessageID: "lan-new-bad",
      receivedAt: new Date(),
      validationStatus: "rejected",
      rejectionReason: "schema",
    });
    await store.ingest({
      event: event(),
      upstreamMessageID: "lan-old-good",
      receivedAt: old,
      validationStatus: "valid",
    });

    const removed = await store.pruneRejected(new Date(Date.now() - 60_000));
    expect(removed).toBe(1);
    expect(await store.getByUpstreamMessageID("lan-old-bad")).toBeNull();
    expect(await store.getByUpstreamMessageID("lan-new-bad")).not.toBeNull();
    // Valid history is append-only — pruning never touches it.
    expect(await store.getByUpstreamMessageID("lan-old-good")).not.toBeNull();
  });
});
