import type { CommonThreadEvent, PeerID } from "../Domain/CommonThreadEvent.js";

export interface ReceivedCommonThreadEvent {
  event: CommonThreadEvent;
  upstreamMessageID: string;
  receivedAt: Date;
}

/**
 * Narrow adapter over upstream public mesh + private-DM readiness.
 * Implementations must not create BLE scan/advertise loops.
 */
export interface CommonThreadMeshTransport {
  publishPublicEvent(event: CommonThreadEvent): Promise<{
    upstreamMessageID: string;
    state: "queued" | "sent" | "failed" | "unknown";
  }>;
  readonly receivedPublicEvents: AsyncIterable<ReceivedCommonThreadEvent>;
  canOpenEncryptedPrivateConversation(peerID: PeerID): Promise<boolean>;
}
