import {
  encodeWirePayload,
  decodeWirePayload,
  type CommonThreadEvent,
  type PeerID,
} from "../Domain/CommonThreadEvent.js";
import type {
  CommonThreadMeshTransport,
  ReceivedCommonThreadEvent,
} from "./CommonThreadMeshTransport.js";

interface NodeMailbox {
  peerID: PeerID;
  push: (item: ReceivedCommonThreadEvent) => void;
  privateReady: Set<PeerID>;
}

/**
 * Multi-node in-memory mesh for unit tests / three-node simulation.
 * Relays public events to all other nodes with unique upstream IDs per hop
 * simulation — callers typically publish once and fan out once.
 */
export class InMemoryMeshHub {
  private readonly nodes = new Map<PeerID, NodeMailbox>();
  private seq = 0;

  createTransport(peerID: PeerID): InMemoryMeshTransport {
    const queue: ReceivedCommonThreadEvent[] = [];
    const waiters: Array<(v: IteratorResult<ReceivedCommonThreadEvent>) => void> =
      [];

    const push = (item: ReceivedCommonThreadEvent) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value: item, done: false });
      } else {
        queue.push(item);
      }
    };

    this.nodes.set(peerID, {
      peerID,
      push,
      privateReady: new Set(),
    });

    const receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return new Promise<IteratorResult<ReceivedCommonThreadEvent>>(
            (resolve) => {
              waiters.push(resolve);
            },
          );
        },
      }),
    };

    return new InMemoryMeshTransport(this, peerID, receivedPublicEvents);
  }

  setPrivateReady(a: PeerID, b: PeerID, ready: boolean): void {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) {
      return;
    }
    if (ready) {
      na.privateReady.add(b);
      nb.privateReady.add(a);
    } else {
      na.privateReady.delete(b);
      nb.privateReady.delete(a);
    }
  }

  canOpenPrivate(from: PeerID, to: PeerID): boolean {
    return this.nodes.get(from)?.privateReady.has(to) ?? false;
  }

  publish(from: PeerID, event: CommonThreadEvent): string {
    const upstreamMessageID = `mem-${++this.seq}-${event.eventID}`;
    const wire = encodeWirePayload(event);
    // Validate round-trip
    decodeWirePayload(wire);
    const receivedAt = new Date();
    for (const [peerID, node] of this.nodes) {
      if (peerID === from) {
        continue;
      }
      node.push({
        event,
        upstreamMessageID,
        receivedAt,
      });
    }
    return upstreamMessageID;
  }
}

export class InMemoryMeshTransport implements CommonThreadMeshTransport {
  constructor(
    private readonly hub: InMemoryMeshHub,
    readonly localPeerID: PeerID,
    readonly receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent>,
  ) {}

  async publishPublicEvent(event: CommonThreadEvent): Promise<{
    upstreamMessageID: string;
    state: "queued" | "sent" | "failed" | "unknown";
  }> {
    const upstreamMessageID = this.hub.publish(this.localPeerID, event);
    return { upstreamMessageID, state: "sent" };
  }

  async canOpenEncryptedPrivateConversation(peerID: PeerID): Promise<boolean> {
    return this.hub.canOpenPrivate(this.localPeerID, peerID);
  }
}
