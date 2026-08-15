import { IDBFactory } from "fake-indexeddb";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexedDbEventStore } from "../src/Persistence/IndexedDbEventStore.js";
import { CommonThreadService } from "../src/Services/CommonThreadService.js";
import { LanRelayMeshTransport } from "../src/Transport/LanRelayMeshTransport.js";
import { RelayHub, type RelaySocket } from "../src/Transport/RelayHub.js";
import type { ThreadCreatedBody } from "../src/Domain/CommonThreadEvent.js";

/**
 * End-to-end over a real WebSocket server: the same path the browser takes,
 * minus the DOM. Proves the mesh actually moves events between two independent
 * devices, each with its own store.
 */

const factory = (url: string) =>
  new NodeWebSocket(url) as unknown as WebSocket;

interface Device {
  peerID: string;
  store: IndexedDbEventStore;
  transport: LanRelayMeshTransport;
  service: CommonThreadService;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for mesh state");
}

describe("LAN mesh integration", () => {
  let hub: RelayHub;
  let wss: WebSocketServer;
  let url: string;
  const devices: Device[] = [];

  function makeDevice(peerID: string): Device {
    const store = new IndexedDbEventStore(`ct-${peerID}`, new IDBFactory());
    const transport = new LanRelayMeshTransport(peerID, {
      url,
      displayName: peerID,
      webSocketFactory: factory,
      minBackoffMs: 20,
      maxBackoffMs: 60,
      requestTimeoutMs: 2_000,
    });
    const service = new CommonThreadService(store, transport, peerID);
    service.startInboundProcessing();
    transport.connect();
    const device = { peerID, store, transport, service };
    devices.push(device);
    return device;
  }

  const online = (device: Device) => () =>
    device.transport.status.connection === "online";

  beforeEach(async () => {
    hub = new RelayHub();
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (ws) => {
      const socket: RelaySocket = {
        send: (data) => ws.send(data),
        close: () => ws.close(),
      };
      hub.connect(socket);
      ws.on("message", (data) => hub.handleMessage(socket, data));
      ws.on("close", () => hub.disconnect(socket));
    });
    await new Promise<void>((resolve) => wss.on("listening", resolve));
    url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ct-mesh`;
  });

  afterEach(async () => {
    for (const device of devices.splice(0)) {
      await device.service.stopInboundProcessing();
      await device.transport.close();
      await device.store.close();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("carries the request → offer → accept loop to a Matched state on both devices", async () => {
    const a = makeDevice("peer-a");
    const b = makeDevice("peer-b");
    await waitFor(online(a));
    await waitFor(online(b));

    const created = await a.service.createThread({
      type: "request",
      title: "Phone charging needed",
      text: "My phone is at 4%. Could someone lend a power bank?",
      roughPlace: "Library side",
      category: "power",
    });
    expect(created.accepted).toBe(true);
    expect(created.deliveryState).toBe("sent");
    const threadID = created.event.threadID;

    // B receives it over the wire, not by sharing memory with A.
    await waitFor(async () =>
      Boolean(await b.service.materialiseThread(threadID)),
    );

    const offer = await b.service.postOffer(threadID, {
      title: "I can bring a power bank",
      text: "I am near the south stairwell.",
      roughPlace: "South stairwell",
      category: "power",
    });
    expect(offer.accepted).toBe(true);

    await waitFor(async () => {
      const thread = await a.service.materialiseThread(threadID);
      return (
        thread !== null &&
        thread.replies.length + 1 >= 1 &&
        (await a.store.getByEventID(offer.event.eventID)) !== null
      );
    });

    const accept = await a.service.acceptOffer(threadID, offer.event.eventID);
    expect(accept.rejectionReason).toBeUndefined();
    expect(accept.accepted).toBe(true);

    await waitFor(async () => {
      const onA = await a.service.materialiseThread(threadID);
      const onB = await b.service.materialiseThread(threadID);
      return onA?.status === "Matched" && onB?.status === "Matched";
    });

    const onB = await b.service.materialiseThread(threadID);
    expect(onB?.acceptedOfferAuthorPeerID).toBe("peer-b");
    expect(onB?.root.title).toBe("Phone charging needed");

    // Exactly one request root exists on each device — no duplicate ingest.
    const rootsOnB = (await b.store.listValidByThreadID(threadID)).filter(
      (row) =>
        row.kind === "thread.created" &&
        (JSON.parse(row.canonicalEventJson).body as ThreadCreatedBody).type ===
          "request",
    );
    expect(rootsOnB).toHaveLength(1);
  });

  it("replays history to a device that joins after the thread exists", async () => {
    const a = makeDevice("peer-a");
    await waitFor(online(a));
    const created = await a.service.createThread({
      type: "offer",
      title: "Extra sealed water bottles",
      text: "Spare six-pack for anyone who cannot get to the shop.",
      roughPlace: "Block B lobby",
      category: "supplies",
    });

    const late = makeDevice("peer-late");
    await waitFor(online(late));

    await waitFor(async () =>
      Boolean(await late.service.materialiseThread(created.event.threadID)),
    );
    const thread = await late.service.materialiseThread(
      created.event.threadID,
    );
    expect(thread?.root.title).toBe("Extra sealed water bottles");
  });

  it("queues while offline, then flushes exactly once on reconnect", async () => {
    const a = makeDevice("peer-a");
    const b = makeDevice("peer-b");
    await waitFor(online(a));
    await waitFor(online(b));

    // Reconnect can win the race against a synchronous read of `queued`, so
    // observe the peak depth through the status stream instead.
    let peakQueued = 0;
    a.transport.subscribe((status) => {
      peakQueued = Math.max(peakQueued, status.queued);
    });

    // Drop A's socket without disposing the transport — a wifi blip.
    a.transport["ws"]?.close();
    await waitFor(() => a.transport.status.connection !== "online");

    const queued = await a.service.createThread({
      type: "request",
      title: "Torch needed",
      text: "Stairwell light is out on the north side.",
      roughPlace: "North stairwell",
      category: "access",
    });
    expect(queued.deliveryState).toBe("queued");
    expect(peakQueued).toBeGreaterThan(0);

    // Reconnect happens on its own backoff timer.
    await waitFor(online(a), 5_000);
    await waitFor(async () =>
      Boolean(await b.service.materialiseThread(queued.event.threadID)),
    );
    await waitFor(() => a.transport.status.queued === 0);

    // The flushed event keeps one upstream identity, so B stored it once.
    const rows = await b.store.listValidByThreadID(queued.event.threadID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.upstreamMessageID).toBe(queued.upstreamMessageID);
  });

  it("keeps a queued event across a page reload and flushes it on rejoin", async () => {
    // Stand-in for localStorage: what survives when the tab is closed.
    let persisted: unknown[] = [];
    const storage = {
      load: () => persisted as never[],
      save: (entries: never[]) => {
        persisted = JSON.parse(JSON.stringify(entries)) as unknown[];
      },
    };

    const b = makeDevice("peer-b");
    await waitFor(online(b));

    // Device A starts with the relay unreachable, so its post can only queue.
    const storeA = new IndexedDbEventStore("ct-reload", new IDBFactory());
    const deadTransport = new LanRelayMeshTransport("peer-a", {
      url: "ws://127.0.0.1:1/ct-mesh",
      webSocketFactory: factory,
      minBackoffMs: 50_000,
      maxBackoffMs: 50_000,
      requestTimeoutMs: 500,
      outboxStorage: storage,
    });
    const serviceA = new CommonThreadService(storeA, deadTransport, "peer-a");

    const queued = await serviceA.createThread({
      type: "request",
      title: "Torch needed",
      text: "Stairwell light is out on the north side.",
      roughPlace: "North stairwell",
      category: "access",
    });
    expect(queued.deliveryState).toBe("queued");
    expect(persisted).toHaveLength(1);

    await deadTransport.close();
    await storeA.close();

    // Reload: brand new transport, same persisted outbox, working relay.
    const revived = new LanRelayMeshTransport("peer-a", {
      url,
      webSocketFactory: factory,
      minBackoffMs: 20,
      maxBackoffMs: 60,
      outboxStorage: storage,
    });
    devices.push({
      peerID: "peer-a",
      store: new IndexedDbEventStore("ct-reload-2", new IDBFactory()),
      transport: revived,
      service: new CommonThreadService(
        new IndexedDbEventStore("ct-reload-3", new IDBFactory()),
        revived,
        "peer-a",
      ),
    });
    revived.connect();

    // The event stranded before the reload now reaches the other device.
    await waitFor(async () =>
      Boolean(await b.service.materialiseThread(queued.event.threadID)),
    );
    const onB = await b.service.materialiseThread(queued.event.threadID);
    expect(onB?.root.title).toBe("Torch needed");
    await waitFor(() => persisted.length === 0);
  });

  it("reports presence of the other device and gates private chat on it", async () => {
    const a = makeDevice("peer-a");
    const b = makeDevice("peer-b");
    await waitFor(online(a));
    await waitFor(online(b));
    await waitFor(() => a.transport.status.peers.length === 1);

    expect(a.transport.status.peers[0]?.peerID).toBe("peer-b");
    expect(
      await a.transport.canOpenEncryptedPrivateConversation("peer-b"),
    ).toBe(true);
    expect(
      await a.transport.canOpenEncryptedPrivateConversation("peer-nobody"),
    ).toBe(false);
  });
});
