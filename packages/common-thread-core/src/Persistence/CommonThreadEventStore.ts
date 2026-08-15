import type { CommonThreadEvent } from "../Domain/CommonThreadEvent.js";

export type ValidationStatus = "valid" | "rejected";

export interface StoredEventRecord {
  eventID: string;
  upstreamMessageID: string;
  threadID: string;
  authorPeerID: string;
  kind: string;
  createdAt: string;
  receivedAt: string;
  canonicalEventJson: string;
  validationStatus: ValidationStatus;
  rejectionReason?: string;
}

export interface IngestInput {
  event: CommonThreadEvent;
  upstreamMessageID: string;
  receivedAt: Date;
  validationStatus: ValidationStatus;
  rejectionReason?: string;
}

export interface IngestResult {
  /** True when a new row was written. */
  inserted: boolean;
  /** True when duplicate eventID or upstreamMessageID was seen. */
  duplicate: boolean;
  record?: StoredEventRecord;
}

export interface CommonThreadEventStore {
  ingest(input: IngestInput): Promise<IngestResult>;
  getByEventID(eventID: string): Promise<StoredEventRecord | null>;
  getByUpstreamMessageID(
    upstreamMessageID: string,
  ): Promise<StoredEventRecord | null>;
  listValidByThreadID(threadID: string): Promise<StoredEventRecord[]>;
  listAllValid(): Promise<StoredEventRecord[]>;
  pruneRejected(olderThan: Date): Promise<number>;
  close(): Promise<void>;
}
