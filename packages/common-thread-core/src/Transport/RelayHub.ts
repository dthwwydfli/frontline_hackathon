import {
  BRIDGE_PROTOCOL_VERSION,
  encodeFrame,
  makeFrame,
  parseFrame,
  type BridgeFrame,
  type PeerPresence,
} from "./BridgeProtocol.js";

/** Minimal duck type so this hub is testable without a real `ws` socket. */
export interface RelaySocket {
  send(data: string): void;
  close(): void;
}

interface RelayedEvent {
  event: unknown;
  upstreamMessageID: string;
  receivedAt: string;
}

export interface RelayHubOptions {
  /** How many CT events to keep for late joiners. */
  backlogLimit?: number;
  /** Shown to clients so a desktop can render a join QR code. */
  joinUrl?: string;
}

interface Peer {
  socket: RelaySocket;
  peerID: string;
  displayName: string;
}

/**
 * Local-network relay for CT1 events.
 *
 * This is a transport, not a database — the append-only store on each device
 * stays the source of truth (PLD-05 §Reconnect). The hub only fans out, keeps
 * a bounded backlog so devices joining late are not blind, and suppresses
 * duplicates so an outbox flush is idempotent.
 *
 * It never inspects or rewrites event bodies.
 */
export class RelayHub {
  private readonly peers = new Map<RelaySocket, Peer>();
  private readonly backlog: RelayedEvent[] = [];
  private readonly seenUpstreamIDs = new Set<string>();
  private readonly backlogLimit: number;
  private joinUrl: string | undefined;

  constructor(options: RelayHubOptions = {}) {
    this.backlogLimit = options.backlogLimit ?? 500;
    this.joinUrl = options.joinUrl;
  }

  setJoinUrl(joinUrl: string | undefined): void {
    this.joinUrl = joinUrl;
  }

  get peerCount(): number {
    return this.peers.size;
  }

  get backlogSize(): number {
    return this.backlog.length;
  }

  connect(socket: RelaySocket): void {
    this.peers.set(socket, { socket, peerID: "", displayName: "" });
  }

  disconnect(socket: RelaySocket): void {
    if (this.peers.delete(socket)) {
      this.broadcastPresence();
    }
  }

  handleMessage(socket: RelaySocket, raw: unknown): void {
    const frame = parseFrame(raw);
    if (!frame) {
      return;
    }
    switch (frame.type) {
      case "hello":
        this.onHello(socket, frame);
        return;
      case "presence":
        this.onPresence(socket, frame);
        return;
      case "publish_public":
        this.onPublish(socket, frame);
        return;
      case "can_open_private":
        this.onCanOpenPrivate(socket, frame);
        return;
      default:
        this.send(
          socket,
          makeFrame(
            "error",
            { code: "unknown_frame", message: `Unknown frame ${frame.type}` },
            frame.id,
          ),
        );
    }
  }

  // ------------------------------------------------------------- handlers

  private onHello(socket: RelaySocket, frame: BridgeFrame): void {
    const peer = this.peers.get(socket);
    if (!peer) {
      return;
    }
    peer.peerID = String(frame.payload?.peerID ?? "");
    peer.displayName = String(frame.payload?.displayName ?? "");

    this.send(
      socket,
      makeFrame(
        "hello_ack",
        {
          peerID: peer.peerID,
          meshReady: true,
          protocol: BRIDGE_PROTOCOL_VERSION,
          joinUrl: this.joinUrl,
          peers: this.presenceList(),
        },
        frame.id,
      ),
    );

    // Store-and-forward: people scan the QR at different times, so a device
    // that joins late must still see the threads that already exist.
    if (this.backlog.length > 0) {
      this.send(socket, makeFrame("backlog", { events: this.backlog }));
    }
    this.broadcastPresence();
  }

  private onPresence(socket: RelaySocket, frame: BridgeFrame): void {
    const peer = this.peers.get(socket);
    if (!peer) {
      return;
    }
    if (frame.payload?.peerID) {
      peer.peerID = String(frame.payload.peerID);
    }
    peer.displayName = String(frame.payload?.displayName ?? peer.displayName);
    this.broadcastPresence();
  }

  private onPublish(socket: RelaySocket, frame: BridgeFrame): void {
    const payload = frame.payload;
    if (!payload?.event) {
      this.send(
        socket,
        makeFrame(
          "error",
          { code: "bad_publish", message: "Missing event" },
          frame.id,
        ),
      );
      return;
    }

    // Clients mint the upstream ID so a queued event keeps one identity across
    // a reconnect; without it a flush would fan out twice.
    const upstreamMessageID =
      String(payload.upstreamMessageID ?? "") ||
      `relay-${this.backlog.length + 1}-${Date.now()}`;

    if (this.seenUpstreamIDs.has(upstreamMessageID)) {
      // Already relayed — acknowledge without a second fan-out.
      this.send(
        socket,
        makeFrame(
          "delivery_state",
          { upstreamMessageID, state: "sent" },
          frame.id,
        ),
      );
      return;
    }
    this.seenUpstreamIDs.add(upstreamMessageID);

    const relayed: RelayedEvent = {
      event: payload.event,
      upstreamMessageID,
      receivedAt: new Date().toISOString(),
    };
    this.remember(relayed);

    const publicEvent = makeFrame("public_event", { ...relayed });
    for (const peer of this.peers.values()) {
      if (peer.socket !== socket) {
        this.send(peer.socket, publicEvent);
      }
    }

    // `sent` means it left this device and reached the relay. PLD-02 forbids
    // claiming any peer received it, so the state stops here.
    this.send(
      socket,
      makeFrame("delivery_state", { upstreamMessageID, state: "sent" }, frame.id),
    );
  }

  private onCanOpenPrivate(socket: RelaySocket, frame: BridgeFrame): void {
    const peerID = String(frame.payload?.peerID ?? "");
    // A LAN relay has no Noise sessions. The only fact it can assert is that
    // the other peer is currently connected.
    const available = [...this.peers.values()].some(
      (peer) => peer.peerID === peerID && peer.socket !== socket,
    );
    this.send(
      socket,
      makeFrame(
        "can_open_private_result",
        { peerID, available },
        frame.id,
      ),
    );
  }

  // -------------------------------------------------------------- internals

  private remember(relayed: RelayedEvent): void {
    this.backlog.push(relayed);
    while (this.backlog.length > this.backlogLimit) {
      const dropped = this.backlog.shift();
      if (dropped) {
        this.seenUpstreamIDs.delete(dropped.upstreamMessageID);
      }
    }
  }

  private presenceList(): PeerPresence[] {
    return [...this.peers.values()]
      .filter((peer) => peer.peerID.length > 0)
      .map((peer) => ({ peerID: peer.peerID, displayName: peer.displayName }));
  }

  private broadcastPresence(): void {
    const frame = makeFrame("presence_state", { peers: this.presenceList() });
    for (const peer of this.peers.values()) {
      this.send(peer.socket, frame);
    }
  }

  private send(socket: RelaySocket, frame: BridgeFrame): void {
    try {
      socket.send(encodeFrame(frame));
    } catch {
      // A peer that vanished mid-write is handled by its close handler.
    }
  }
}
