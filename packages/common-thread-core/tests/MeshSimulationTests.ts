import { describe, expect, it } from "vitest";
import { SqliteEventStore } from "../src/Persistence/SqliteEventStore.js";
import { InMemoryMeshHub } from "../src/Transport/InMemoryMeshTransport.js";
import { CommonThreadService } from "../src/Services/CommonThreadService.js";

async function drainOnce(
  service: CommonThreadService,
  transport: { receivedPublicEvents: AsyncIterable<unknown> },
): Promise<void> {
  const iter = transport.receivedPublicEvents[Symbol.asyncIterator]();
  const next = await Promise.race([
    iter.next(),
    new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), 50),
    ),
  ]);
  if (!next.done && next.value) {
    await service.ingestReceived(
      next.value as Parameters<CommonThreadService["ingestReceived"]>[0],
    );
  }
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

    // B and C receive relay
    await drainOnce(serviceB, transportB);
    await drainOnce(serviceC, transportC);

    // Duplicate relay of same upstream id must not double-apply
    await serviceC.ingestReceived({
      event: created.event,
      upstreamMessageID: created.upstreamMessageID,
      receivedAt: new Date(),
    });

    const offer = await serviceC.postOffer(threadID, {
      title: "Have a torch",
      text: "Can share for an hour",
      roughPlace: "block C",
      category: "supplies",
    });
    expect(offer.accepted).toBe(true);

    await drainOnce(serviceA, transportA);
    await drainOnce(serviceB, transportB);

    const accept = await serviceA.acceptOffer(threadID, offer.event.eventID);
    expect(accept.accepted).toBe(true);

    await drainOnce(serviceB, transportB);
    await drainOnce(serviceC, transportC);

    const matA = await serviceA.materialiseThread(threadID);
    const matB = await serviceB.materialiseThread(threadID);
    const matC = await serviceC.materialiseThread(threadID);

    expect(matA?.status).toBe("Matched");
    expect(matB?.status).toBe("Matched");
    expect(matC?.status).toBe("Matched");
    expect(matA?.acceptedOfferEventID).toBe(offer.event.eventID);

    // Exactly one root event id in each store
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
