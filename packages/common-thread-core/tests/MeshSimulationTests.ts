import { describe, expect, it } from "vitest";
import { SqliteEventStore } from "../src/Persistence/SqliteEventStore.js";
import {
  InMemoryMeshHub,
  InMemoryMeshTransport,
} from "../src/Transport/InMemoryMeshTransport.js";
import { CommonThreadService } from "../src/Services/CommonThreadService.js";

async function drainAll(
  service: CommonThreadService,
  transport: InMemoryMeshTransport,
): Promise<number> {
  const pending = transport.drainPending();
  for (const item of pending) {
    await service.ingestReceived(item);
  }
  return pending.length;
}

describe("three-node mesh simulation", () => {
  it("relays request/offer/accept to matched state without duplicates", async () => {
    const hub = new InMemoryMeshHub();
    const transportA = hub.createTransport("peer-a");
    const transportB = hub.createTransport("peer-b");
    const transportC = hub.createTransport("peer-c");

    const storeA = new SqliteEventStore(":memory:");
    const storeB = new SqliteEventStore(":memory:");
    const storeC = new SqliteEventStore(":memory:");

    const serviceA = new CommonThreadService(storeA, transportA, "peer-a");
    const serviceB = new CommonThreadService(storeB, transportB, "peer-b");
    const serviceC = new CommonThreadService(storeC, transportC, "peer-c");

    const created = await serviceA.createThread({
      type: "request",
      title: "Need torch",
      text: "Staircase dark",
      roughPlace: "block A",
      category: "supplies",
    });
    expect(created.accepted).toBe(true);
    const threadID = created.event.threadID;

    expect(await drainAll(serviceB, transportB)).toBeGreaterThan(0);
    expect(await drainAll(serviceC, transportC)).toBeGreaterThan(0);

    // Duplicate relay of same upstream id must not double-apply
    const dup = await serviceC.ingestReceived({
      event: created.event,
      upstreamMessageID: created.upstreamMessageID,
      receivedAt: new Date(),
    });
    expect(dup.duplicate).toBe(true);

    const offer = await serviceC.postOffer(threadID, {
      title: "Have a torch",
      text: "Can share for an hour",
      roughPlace: "block C",
      category: "supplies",
    });
    expect(offer.accepted).toBe(true);

    expect(await drainAll(serviceA, transportA)).toBeGreaterThan(0);
    expect(await drainAll(serviceB, transportB)).toBeGreaterThan(0);

    const accept = await serviceA.acceptOffer(threadID, offer.event.eventID);
    expect(accept.accepted).toBe(true);

    expect(await drainAll(serviceB, transportB)).toBeGreaterThan(0);
    expect(await drainAll(serviceC, transportC)).toBeGreaterThan(0);

    const matA = await serviceA.materialiseThread(threadID);
    const matB = await serviceB.materialiseThread(threadID);
    const matC = await serviceC.materialiseThread(threadID);

    expect(matA?.status).toBe("Matched");
    expect(matB?.status).toBe("Matched");
    expect(matC?.status).toBe("Matched");
    expect(matA?.acceptedOfferEventID).toBe(offer.event.eventID);

    const rowsA = await storeA.listValidByThreadID(threadID);
    const roots = rowsA.filter((r) => r.kind === "thread.created");
    const requestRoots = roots.filter((r) =>
      r.canonicalEventJson.includes('"type":"request"'),
    );
    expect(requestRoots).toHaveLength(1);

    hub.setPrivateReady("peer-a", "peer-c", true);
    const gate = await serviceA.privateGate.evaluate("peer-a", matA!);
    expect(gate.allowed).toBe(true);
    expect(gate.peerID).toBe("peer-c");

    await storeA.close();
    await storeB.close();
    await storeC.close();
  });
});
