import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteEventStore } from "../src/Persistence/SqliteEventStore.js";
import type { CommonThreadEvent } from "../src/Domain/CommonThreadEvent.js";

const event: CommonThreadEvent = {
  v: 1,
  eventID: "11111111-1111-1111-1111-111111111111",
  threadID: "22222222-2222-2222-2222-222222222222",
  area: "riverside-estate",
  kind: "thread.created",
  authorPeerID: "peer-a",
  createdAt: "2026-08-15T12:00:00.000Z",
  body: {
    type: "request",
    title: "Help",
    text: "Need a hand",
    roughPlace: "gate",
    category: "general",
  },
};

describe("SqliteEventStore", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ct-store-"));
    path = join(dir, "events.sqlite");
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("suppresses duplicates by eventID and upstream message ID", async () => {
    const store = new SqliteEventStore(path);
    const first = await store.ingest({
      event,
      upstreamMessageID: "up-1",
      receivedAt: new Date("2026-08-15T12:00:01.000Z"),
      validationStatus: "valid",
    });
    expect(first.inserted).toBe(true);

    const dupEvent = await store.ingest({
      event,
      upstreamMessageID: "up-2",
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    expect(dupEvent.duplicate).toBe(true);
    expect(dupEvent.inserted).toBe(false);

    const other: CommonThreadEvent = {
      ...event,
      eventID: "33333333-3333-3333-3333-333333333333",
    };
    const dupUpstream = await store.ingest({
      event: other,
      upstreamMessageID: "up-1",
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    expect(dupUpstream.duplicate).toBe(true);

    await store.close();
  });

  it("persists across restart", async () => {
    const store1 = new SqliteEventStore(path);
    await store1.ingest({
      event,
      upstreamMessageID: "up-1",
      receivedAt: new Date("2026-08-15T12:00:01.000Z"),
      validationStatus: "valid",
    });
    await store1.close();

    const store2 = new SqliteEventStore(path);
    const row = await store2.getByEventID(event.eventID);
    expect(row?.upstreamMessageID).toBe("up-1");
    expect(row?.validationStatus).toBe("valid");
    const list = await store2.listValidByThreadID(event.threadID);
    expect(list).toHaveLength(1);
    await store2.close();
  });

  it("prunes rejected events only", async () => {
    const store = new SqliteEventStore(path);
    await store.ingest({
      event,
      upstreamMessageID: "up-valid",
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      validationStatus: "valid",
    });
    const rejected: CommonThreadEvent = {
      ...event,
      eventID: "44444444-4444-4444-4444-444444444444",
    };
    await store.ingest({
      event: rejected,
      upstreamMessageID: "up-rej",
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      validationStatus: "rejected",
      rejectionReason: "area",
    });
    const n = await store.pruneRejected(new Date("2026-06-01T00:00:00.000Z"));
    expect(n).toBe(1);
    expect(await store.getByEventID(event.eventID)).not.toBeNull();
    expect(await store.getByEventID(rejected.eventID)).toBeNull();
    await store.close();
  });
});
