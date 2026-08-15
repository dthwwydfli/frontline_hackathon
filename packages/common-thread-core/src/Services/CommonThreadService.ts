import {
  DEFAULT_AREA,
  PROTOCOL_VERSION,
  newId,
  type CommonThreadEvent,
  type PeerID,
  type ThreadCreatedType,
} from "../Domain/CommonThreadEvent.js";
import { EventAuthoriser } from "../Domain/EventAuthoriser.js";
import { ContentSafetyPolicy } from "../Domain/ContentSafetyPolicy.js";
import { reduceThread } from "../Domain/ThreadReducer.js";
import type { MaterialisedThread } from "../Domain/ThreadState.js";
import type { SqliteEventStore } from "../Persistence/SqliteEventStore.js";
import {
  recordToEvent,
  type CommonThreadEventStore,
} from "../Persistence/CommonThreadEventStore.js";
import type {
  CommonThreadMeshTransport,
  ReceivedCommonThreadEvent,
} from "../Transport/CommonThreadMeshTransport.js";
import { PrivateContactGate } from "./PrivateContactGate.js";

export interface PublishResult {
  event: CommonThreadEvent;
  upstreamMessageID: string;
  deliveryState: "queued" | "sent" | "failed" | "unknown";
  safetyWarnings: ReturnType<ContentSafetyPolicy["inspectText"]>;
  accepted: boolean;
  rejectionReason?: string;
}

/**
 * Orchestrates authorise → persist → publish and inbound ingest.
 */
export class CommonThreadService {
  readonly authoriser = new EventAuthoriser();
  readonly safety = new ContentSafetyPolicy();
  readonly privateGate: PrivateContactGate;
  private ingestLoop?: Promise<void>;
  private stopped = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: CommonThreadEventStore,
    private readonly transport: CommonThreadMeshTransport,
    private readonly localPeerID: PeerID,
    private readonly allowedArea: string = DEFAULT_AREA,
  ) {
    this.privateGate = new PrivateContactGate(transport);
  }

  /**
   * Notified whenever stored state changed — an inbound event was ingested or
   * a local publish landed. UIs re-materialise from here rather than polling.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  startInboundProcessing(): void {
    if (this.ingestLoop) {
      return;
    }
    this.stopped = false;
    this.ingestLoop = this.runInbound();
  }

  /**
   * Resolves once the inbound loop has actually exited. The loop parks on the
   * transport's iterator, so a transport that can be closed (see
   * `AsyncEventQueue.close`) is what lets this return without waiting for one
   * more inbound event.
   */
  async stopInboundProcessing(): Promise<void> {
    this.stopped = true;
    const loop = this.ingestLoop;
    this.ingestLoop = undefined;
    await Promise.race([
      loop ?? Promise.resolve(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 0);
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  private async runInbound(): Promise<void> {
    for await (const received of this.transport.receivedPublicEvents) {
      if (this.stopped) {
        break;
      }
      const result = await this.ingestReceived(received);
      if (result.accepted) {
        this.notify();
      }
    }
  }

  async ingestReceived(
    received: ReceivedCommonThreadEvent,
  ): Promise<{ duplicate: boolean; accepted: boolean }> {
    const existing = await this.store.listValidByThreadID(
      received.event.threadID,
    );
    const existingEvents = existing.map(recordToEvent);
    const auth = this.authoriser.authorise(received.event, {
      existingThreadEvents: existingEvents,
      allowedArea: this.allowedArea,
    });

    const result = await this.store.ingest({
      event: received.event,
      upstreamMessageID: received.upstreamMessageID,
      receivedAt: received.receivedAt,
      validationStatus: auth.ok ? "valid" : "rejected",
      rejectionReason: auth.ok ? undefined : auth.reason,
    });

    return {
      duplicate: result.duplicate,
      accepted: auth.ok && result.inserted,
    };
  }

  private async existingEventsFor(
    threadID: string,
  ): Promise<CommonThreadEvent[]> {
    const rows = await this.store.listValidByThreadID(threadID);
    return rows.map(recordToEvent);
  }

  private async nextLocalCreatedAt(threadID?: string): Promise<string> {
    if (!threadID) {
      return new Date().toISOString();
    }
    const existing = await this.existingEventsFor(threadID);
    const latest = existing.reduce((max, event) => {
      const t = Date.parse(event.createdAt);
      return Number.isFinite(t) ? Math.max(max, t) : max;
    }, 0);
    return new Date(Math.max(Date.now(), latest + 1)).toISOString();
  }

  async materialiseThread(
    threadID: string,
  ): Promise<MaterialisedThread | null> {
    const events = await this.existingEventsFor(threadID);
    return reduceThread(threadID, events, this.safety);
  }

  async listMaterialisedThreads(): Promise<MaterialisedThread[]> {
    const all = await this.store.listAllValid();
    const byThread = new Map<string, CommonThreadEvent[]>();
    for (const row of all) {
      const event = recordToEvent(row);
      const list = byThread.get(event.threadID) ?? [];
      list.push(event);
      byThread.set(event.threadID, list);
    }
    const out: MaterialisedThread[] = [];
    for (const [threadID, events] of byThread) {
      const m = reduceThread(threadID, events, this.safety);
      if (m) {
        out.push(m);
      }
    }
    return out;
  }

  private collectWarnings(event: CommonThreadEvent) {
    switch (event.kind) {
      case "thread.created": {
        const b = event.body as {
          title: string;
          text: string;
          roughPlace: string;
        };
        return this.safety.inspectEventTexts([
          b.title,
          b.text,
          b.roughPlace,
        ]);
      }
      case "thread.reply.created":
      case "thread.resolved": {
        const text =
          "text" in event.body
            ? String((event.body as { text?: string }).text ?? "")
            : "note" in event.body
              ? String((event.body as { note?: string }).note ?? "")
              : "";
        return text ? this.safety.inspectText(text) : [];
      }
      case "guidance.shared": {
        const b = event.body as { title: string; text: string };
        return this.safety.inspectEventTexts([b.title, b.text]);
      }
      default:
        return [];
    }
  }

  private async publishLocal(
    event: CommonThreadEvent,
  ): Promise<PublishResult> {
    const existing = await this.existingEventsFor(event.threadID);
    const auth = this.authoriser.authorise(event, {
      existingThreadEvents: existing,
      allowedArea: this.allowedArea,
    });
    const safetyWarnings = this.collectWarnings(event);

    if (!auth.ok) {
      await this.store.ingest({
        event,
        upstreamMessageID: `local-rejected-${event.eventID}`,
        receivedAt: new Date(),
        validationStatus: "rejected",
        rejectionReason: auth.reason,
      });
      return {
        event,
        upstreamMessageID: "",
        deliveryState: "failed",
        safetyWarnings,
        accepted: false,
        rejectionReason: auth.reason,
      };
    }

    const delivery = await this.transport.publishPublicEvent(event);
    await this.store.ingest({
      event,
      upstreamMessageID: delivery.upstreamMessageID || `local-${event.eventID}`,
      receivedAt: new Date(),
      validationStatus: "valid",
    });
    this.notify();

    return {
      event,
      upstreamMessageID: delivery.upstreamMessageID,
      deliveryState: delivery.state,
      safetyWarnings,
      accepted: true,
    };
  }

  async createThread(input: {
    type: ThreadCreatedType;
    title: string;
    text: string;
    roughPlace: string;
    category: string;
    expiresAt?: string;
    threadID?: string;
  }): Promise<PublishResult> {
    const event: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID: input.threadID ?? newId(),
      area: this.allowedArea,
      kind: "thread.created",
      authorPeerID: this.localPeerID,
      createdAt: await this.nextLocalCreatedAt(input.threadID),
      body: {
        type: input.type,
        title: input.title,
        text: input.text,
        roughPlace: input.roughPlace,
        category: input.category,
        expiresAt: input.expiresAt,
      },
    };
    return this.publishLocal(event);
  }

  async reply(threadID: string, text: string): Promise<PublishResult> {
    const event: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID,
      area: this.allowedArea,
      kind: "thread.reply.created",
      authorPeerID: this.localPeerID,
      createdAt: await this.nextLocalCreatedAt(threadID),
      body: { text },
    };
    return this.publishLocal(event);
  }

  async postOffer(
    threadID: string,
    input: {
      title: string;
      text: string;
      roughPlace: string;
      category: string;
    },
  ): Promise<PublishResult> {
    return this.createThread({
      ...input,
      type: "offer",
      threadID,
    });
  }

  async acceptOffer(
    threadID: string,
    acceptedOfferEventID: string,
  ): Promise<PublishResult> {
    const event: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID,
      area: this.allowedArea,
      kind: "thread.offer.accepted",
      authorPeerID: this.localPeerID,
      createdAt: await this.nextLocalCreatedAt(threadID),
      body: { acceptedOfferEventID },
    };
    return this.publishLocal(event);
  }

  /** PLD-04 `shareGuidance` intent — an area bulletin, not part of a thread. */
  async shareGuidance(input: {
    title: string;
    text: string;
  }): Promise<PublishResult> {
    const event: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID: newId(),
      area: this.allowedArea,
      kind: "guidance.shared",
      authorPeerID: this.localPeerID,
      createdAt: await this.nextLocalCreatedAt(),
      body: { title: input.title, text: input.text },
    };
    return this.publishLocal(event);
  }

  async resolve(threadID: string, note?: string): Promise<PublishResult> {
    const event: CommonThreadEvent = {
      v: PROTOCOL_VERSION,
      eventID: newId(),
      threadID,
      area: this.allowedArea,
      kind: "thread.resolved",
      authorPeerID: this.localPeerID,
      createdAt: await this.nextLocalCreatedAt(threadID),
      body: note ? { note } : {},
    };
    return this.publishLocal(event);
  }
}

export type { SqliteEventStore };
