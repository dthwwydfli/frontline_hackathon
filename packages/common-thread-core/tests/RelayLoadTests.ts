import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  newId,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";
import { encodeFrame, makeFrame, parseFrame } from "../src/Transport/BridgeProtocol.js";
import { RelayHub, type RelaySocket } from "../src/Transport/RelayHub.js";

/**
 * Capacity evidence for the demo.
 *
 * A room-size claim should not be made on a hunch, so this drives a real
 * WebSocket server with a real client per participant. It measures the relay,
 * not the browser: per-device stores are covered by LanMeshIntegrationTests.
 */

const ROOM_SIZE = 50;

interface Client {
  ws: NodeWebSocket;
  peerID: string;
  publicEvents: number;
  backlogEvents: number;
}

function request(title: string, authorPeerID: string): CommonThreadEvent {
  return {
    v: PROTOCOL_VERSION,
    eventID: newId(),
    threadID: newId(),
    area: DEFAULT_AREA,
    kind: "thread.created",
    authorPeerID,
    createdAt: new Date().toISOString(),
    body: {
      type: "request",
      title,
      text: "Public text well inside the 300 code-point bound.",
      roughPlace: "Block B lobby",
      category: "supplies",
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for relay state");
}

describe(`Relay capacity (${ROOM_SIZE} concurrent clients)`, () => {
  let hub: RelayHub;
  let wss: WebSocketServer;
  let url: string;
  let clients: Client[] = [];

  beforeEach(async () => {
    hub = new RelayHub();
    wss = new WebSocketServer({ port: 0, perMessageDeflate: false });
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
    for (const client of clients) {
      client.ws.close();
    }
    clients = [];
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  async function join(peerID: string): Promise<Client> {
    const ws = new NodeWebSocket(url);
    const client: Client = { ws, peerID, publicEvents: 0, backlogEvents: 0 };
    ws.on("message", (data) => {
      const frame = parseFrame(data);
      if (!frame) {
        return;
      }
      if (frame.type === "public_event") {
        client.publicEvents += 1;
      } else if (frame.type === "backlog") {
        const events = frame.payload?.events;
        client.backlogEvents += Array.isArray(events) ? events.length : 0;
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.send(
      encodeFrame(
        makeFrame("hello", { peerID, displayName: peerID }, newId()),
      ),
    );
    clients.push(client);
    return client;
  }

  it("accepts a full room and fans one post out to everyone else", async () => {
    for (let i = 0; i < ROOM_SIZE; i += 1) {
      await join(`load-${i}`);
    }
    await waitFor(() => hub.peerCount === ROOM_SIZE);
    expect(hub.peerCount).toBe(ROOM_SIZE);

    const started = Date.now();
    clients[0]!.ws.send(
      encodeFrame(
        makeFrame(
          "publish_public",
          { event: request("Load test", "load-0"), upstreamMessageID: "lan-load-1" },
          newId(),
        ),
      ),
    );

    const others = clients.slice(1);
    await waitFor(() => others.every((client) => client.publicEvents === 1));
    const elapsed = Date.now() - started;

    // Every other participant got it exactly once; the sender never echoes.
    expect(others.filter((c) => c.publicEvents === 1)).toHaveLength(
      ROOM_SIZE - 1,
    );
    expect(clients[0]!.publicEvents).toBe(0);
    // Generous bound: this asserts the relay is not pathologically slow,
    // it is not a benchmark of the machine it runs on.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("replays accumulated history to a device joining a busy room", async () => {
    for (let i = 0; i < ROOM_SIZE; i += 1) {
      await join(`load-${i}`);
    }
    await waitFor(() => hub.peerCount === ROOM_SIZE);

    const posts = 30;
    for (let i = 0; i < posts; i += 1) {
      clients[i % ROOM_SIZE]!.ws.send(
        encodeFrame(
          makeFrame(
            "publish_public",
            {
              event: request(`Post ${i}`, `load-${i % ROOM_SIZE}`),
              upstreamMessageID: `lan-load-${i}`,
            },
            newId(),
          ),
        ),
      );
    }
    await waitFor(() => hub.backlogSize === posts);

    const late = await join("load-late");
    await waitFor(() => late.backlogEvents === posts);
    expect(late.backlogEvents).toBe(posts);
  });

  it("survives a third of the room dropping at once", async () => {
    for (let i = 0; i < ROOM_SIZE; i += 1) {
      await join(`load-${i}`);
    }
    await waitFor(() => hub.peerCount === ROOM_SIZE);

    const leaving = clients.slice(0, Math.floor(ROOM_SIZE / 3));
    for (const client of leaving) {
      client.ws.close();
    }
    await waitFor(() => hub.peerCount === ROOM_SIZE - leaving.length);

    const survivors = clients.slice(leaving.length);
    const before = survivors.map((c) => c.publicEvents);
    survivors[0]!.ws.send(
      encodeFrame(
        makeFrame(
          "publish_public",
          {
            event: request("After the drop", survivors[0]!.peerID),
            upstreamMessageID: "lan-load-after",
          },
          newId(),
        ),
      ),
    );

    const rest = survivors.slice(1);
    await waitFor(() =>
      rest.every((client, i) => client.publicEvents === before[i + 1]! + 1),
    );
    expect(hub.peerCount).toBe(ROOM_SIZE - leaving.length);
  });
});
