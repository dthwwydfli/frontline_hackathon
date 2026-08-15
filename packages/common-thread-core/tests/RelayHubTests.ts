import { describe, expect, it } from "vitest";
import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  newId,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";
import {
  encodeFrame,
  makeFrame,
  parseFrame,
  type BridgeFrame,
} from "../src/Transport/BridgeProtocol.js";
import { RelayHub, type RelaySocket } from "../src/Transport/RelayHub.js";

/** Test double that records every frame the hub sends to it. */
class FakeSocket implements RelaySocket {
  readonly received: BridgeFrame[] = [];
  send(data: string): void {
    const frame = parseFrame(data);
    if (frame) {
      this.received.push(frame);
    }
  }
  close(): void {}
  framesOfType(type: string): BridgeFrame[] {
    return this.received.filter((frame) => frame.type === type);
  }
}

function request(threadID: string, title: string): CommonThreadEvent {
  return {
    v: PROTOCOL_VERSION,
    eventID: newId(),
    threadID,
    area: DEFAULT_AREA,
    kind: "thread.created",
    authorPeerID: "peer-a",
    createdAt: new Date().toISOString(),
    body: {
      type: "request",
      title,
      text: "Some plain public text.",
      roughPlace: "Block B lobby",
      category: "supplies",
    },
  };
}

function hello(hub: RelayHub, socket: RelaySocket, peerID: string): void {
  hub.connect(socket);
  hub.handleMessage(
    socket,
    encodeFrame(makeFrame("hello", { peerID, displayName: peerID }, newId())),
  );
}

function publish(
  hub: RelayHub,
  socket: RelaySocket,
  event: CommonThreadEvent,
  upstreamMessageID: string,
): void {
  hub.handleMessage(
    socket,
    encodeFrame(
      makeFrame("publish_public", { event, upstreamMessageID }, newId()),
    ),
  );
}

describe("RelayHub", () => {
  it("fans out a published event to every other peer, not the sender", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const c = new FakeSocket();
    hello(hub, a, "peer-a");
    hello(hub, b, "peer-b");
    hello(hub, c, "peer-c");

    publish(hub, a, request("thread-1", "Phone charging needed"), "lan-a-1");

    expect(b.framesOfType("public_event")).toHaveLength(1);
    expect(c.framesOfType("public_event")).toHaveLength(1);
    expect(a.framesOfType("public_event")).toHaveLength(0);

    const delivery = a.framesOfType("delivery_state").at(-1);
    expect(delivery?.payload?.state).toBe("sent");
    expect(delivery?.payload?.upstreamMessageID).toBe("lan-a-1");
  });

  it("suppresses a duplicate upstream ID so an outbox flush cannot double-send", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    hello(hub, a, "peer-a");
    hello(hub, b, "peer-b");

    const event = request("thread-1", "Spare torch");
    publish(hub, a, event, "lan-a-1");
    publish(hub, a, event, "lan-a-1");

    expect(b.framesOfType("public_event")).toHaveLength(1);
    // Both attempts are still acknowledged, so the client stops retrying.
    expect(a.framesOfType("delivery_state")).toHaveLength(2);
  });

  it("replays backlog to a device that joins after the fact", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    hello(hub, a, "peer-a");
    publish(hub, a, request("thread-1", "Spare torch"), "lan-a-1");
    publish(hub, a, request("thread-2", "Water bottles"), "lan-a-2");

    const late = new FakeSocket();
    hello(hub, late, "peer-late");

    const backlog = late.framesOfType("backlog").at(0);
    expect(backlog).toBeDefined();
    expect(backlog?.payload?.events).toHaveLength(2);
    expect(late.framesOfType("hello_ack")).toHaveLength(1);
  });

  it("bounds the backlog and forgets the IDs it dropped", () => {
    const hub = new RelayHub({ backlogLimit: 2 });
    const a = new FakeSocket();
    hello(hub, a, "peer-a");
    publish(hub, a, request("thread-1", "One"), "lan-a-1");
    publish(hub, a, request("thread-2", "Two"), "lan-a-2");
    publish(hub, a, request("thread-3", "Three"), "lan-a-3");

    expect(hub.backlogSize).toBe(2);

    const late = new FakeSocket();
    hello(hub, late, "peer-late");
    expect(late.framesOfType("backlog").at(0)?.payload?.events).toHaveLength(2);
  });

  it("reports private availability only for another connected peer", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    hello(hub, a, "peer-a");
    hello(hub, b, "peer-b");

    hub.handleMessage(
      a,
      encodeFrame(makeFrame("can_open_private", { peerID: "peer-b" }, "q1")),
    );
    hub.handleMessage(
      a,
      encodeFrame(makeFrame("can_open_private", { peerID: "peer-z" }, "q2")),
    );
    // A peer cannot open a private channel with itself.
    hub.handleMessage(
      a,
      encodeFrame(makeFrame("can_open_private", { peerID: "peer-a" }, "q3")),
    );

    const results = a.framesOfType("can_open_private_result");
    expect(results.find((f) => f.id === "q1")?.payload?.available).toBe(true);
    expect(results.find((f) => f.id === "q2")?.payload?.available).toBe(false);
    expect(results.find((f) => f.id === "q3")?.payload?.available).toBe(false);
  });

  it("broadcasts presence on join and on leave", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    const b = new FakeSocket();
    hello(hub, a, "peer-a");
    hello(hub, b, "peer-b");

    const afterJoin = a.framesOfType("presence_state").at(-1);
    expect(afterJoin?.payload?.peers).toHaveLength(2);

    hub.disconnect(b);
    expect(hub.peerCount).toBe(1);
    expect(a.framesOfType("presence_state").at(-1)?.payload?.peers).toHaveLength(
      1,
    );
  });

  it("ignores malformed input instead of throwing", () => {
    const hub = new RelayHub();
    const a = new FakeSocket();
    hello(hub, a, "peer-a");

    expect(() => hub.handleMessage(a, "not json")).not.toThrow();
    hub.handleMessage(a, encodeFrame(makeFrame("publish_public", {}, "bad")));
    expect(a.framesOfType("error").at(-1)?.payload?.code).toBe("bad_publish");
  });
});
