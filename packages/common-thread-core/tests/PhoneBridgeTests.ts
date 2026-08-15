import { describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { PhoneBridgeMeshTransport } from "../src/Transport/PhoneBridgeMeshTransport.js";
import {
  encodeWirePayload,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";

const sample: CommonThreadEvent = {
  v: 1,
  eventID: "11111111-1111-1111-1111-111111111111",
  threadID: "22222222-2222-2222-2222-222222222222",
  area: "riverside-estate",
  kind: "thread.created",
  authorPeerID: "peer-a",
  createdAt: "2026-08-15T12:00:00.000Z",
  body: {
    type: "request",
    title: "Ping",
    text: "Bridge test",
    roughPlace: "lab",
    category: "test",
  },
};

describe("PhoneBridgeMeshTransport", () => {
  it("publishes and receives via loopback bridge fixture", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP address");
    }
    const url = `ws://127.0.0.1:${addr.port}`;

    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(String(data)) as {
          id?: string;
          type: string;
          payload?: Record<string, unknown>;
        };
        if (frame.type === "hello") {
          socket.send(
            JSON.stringify({
              v: 1,
              type: "hello_ack",
              payload: { peerID: "peer-phone", meshReady: true },
            }),
          );
          return;
        }
        if (frame.type === "publish_public") {
          socket.send(
            JSON.stringify({
              v: 1,
              id: frame.id,
              type: "delivery_state",
              payload: {
                upstreamMessageID: "up-bridge-1",
                state: "sent",
              },
            }),
          );
          // Echo as inbound public_event (simulating mesh bounce)
          socket.send(
            JSON.stringify({
              v: 1,
              type: "public_event",
              payload: {
                event: frame.payload?.event,
                upstreamMessageID: "up-bridge-echo",
                receivedAt: new Date().toISOString(),
              },
            }),
          );
          return;
        }
        if (frame.type === "can_open_private") {
          socket.send(
            JSON.stringify({
              v: 1,
              id: frame.id,
              type: "can_open_private_result",
              payload: {
                peerID: frame.payload?.peerID,
                available: true,
              },
            }),
          );
        }
      });
    });

    const transport = new PhoneBridgeMeshTransport({
      url,
      webSocketFactory: (u) => new WebSocket(u),
    });

    const delivery = await transport.publishPublicEvent(sample);
    expect(delivery.upstreamMessageID).toBe("up-bridge-1");
    expect(delivery.state).toBe("sent");

    const iter = transport.receivedPublicEvents[Symbol.asyncIterator]();
    const received = await iter.next();
    expect(received.done).toBe(false);
    expect(received.value?.upstreamMessageID).toBe("up-bridge-echo");
    expect(received.value?.event.eventID).toBe(sample.eventID);

    const can = await transport.canOpenEncryptedPrivateConversation("peer-z");
    expect(can).toBe(true);

    // Wire prefix sanity
    expect(encodeWirePayload(sample).startsWith("CT1:")).toBe(true);

    await transport.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
