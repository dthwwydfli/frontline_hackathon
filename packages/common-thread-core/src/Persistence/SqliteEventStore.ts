import Database from "better-sqlite3";
import { encodeCommonThreadEvent } from "../Domain/CommonThreadEvent.js";
import type {
  CommonThreadEventStore,
  IngestInput,
  IngestResult,
  StoredEventRecord,
} from "./CommonThreadEventStore.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ct_events (
  event_id TEXT NOT NULL,
  upstream_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author_peer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  canonical_event_json TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'rejected')),
  rejection_reason TEXT,
  PRIMARY KEY (event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_upstream ON ct_events(upstream_message_id);
CREATE INDEX IF NOT EXISTS idx_ct_thread ON ct_events(thread_id);
CREATE INDEX IF NOT EXISTS idx_ct_author ON ct_events(author_peer_id);
CREATE INDEX IF NOT EXISTS idx_ct_rejected_received ON ct_events(validation_status, received_at);
`;

function rowToRecord(row: Record<string, unknown>): StoredEventRecord {
  return {
    eventID: String(row.event_id),
    upstreamMessageID: String(row.upstream_message_id),
    threadID: String(row.thread_id),
    authorPeerID: String(row.author_peer_id),
    kind: String(row.kind),
    createdAt: String(row.created_at),
    receivedAt: String(row.received_at),
    canonicalEventJson: String(row.canonical_event_json),
    validationStatus: row.validation_status as "valid" | "rejected",
    rejectionReason:
      row.rejection_reason == null
        ? undefined
        : String(row.rejection_reason),
  };
}

/**
 * Append-only SQLite store. Valid events are never mutated or deleted.
 * Rejected events may be pruned by retention policy.
 */
export class SqliteEventStore implements CommonThreadEventStore {
  private readonly db: Database.Database;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const byEvent = this.db
      .prepare(`SELECT * FROM ct_events WHERE event_id = ?`)
      .get(input.event.eventID) as Record<string, unknown> | undefined;
    if (byEvent) {
      return { inserted: false, duplicate: true, record: rowToRecord(byEvent) };
    }

    const byUpstream = this.db
      .prepare(`SELECT * FROM ct_events WHERE upstream_message_id = ?`)
      .get(input.upstreamMessageID) as Record<string, unknown> | undefined;
    if (byUpstream) {
      return {
        inserted: false,
        duplicate: true,
        record: rowToRecord(byUpstream),
      };
    }

    const canonical = encodeCommonThreadEvent(input.event);
    const receivedAt = input.receivedAt.toISOString();

    try {
      this.db
        .prepare(
          `INSERT INTO ct_events (
            event_id, upstream_message_id, thread_id, author_peer_id, kind,
            created_at, received_at, canonical_event_json, validation_status, rejection_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.event.eventID,
          input.upstreamMessageID,
          input.event.threadID,
          input.event.authorPeerID,
          input.event.kind,
          input.event.createdAt,
          receivedAt,
          canonical,
          input.validationStatus,
          input.rejectionReason ?? null,
        );
    } catch (err) {
      // Race-safe unique constraint → treat as duplicate.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) {
        const again =
          (this.db
            .prepare(`SELECT * FROM ct_events WHERE event_id = ?`)
            .get(input.event.eventID) as Record<string, unknown> | undefined) ??
          (this.db
            .prepare(`SELECT * FROM ct_events WHERE upstream_message_id = ?`)
            .get(input.upstreamMessageID) as
            | Record<string, unknown>
            | undefined);
        return {
          inserted: false,
          duplicate: true,
          record: again ? rowToRecord(again) : undefined,
        };
      }
      throw err;
    }

    const record: StoredEventRecord = {
      eventID: input.event.eventID,
      upstreamMessageID: input.upstreamMessageID,
      threadID: input.event.threadID,
      authorPeerID: input.event.authorPeerID,
      kind: input.event.kind,
      createdAt: input.event.createdAt,
      receivedAt,
      canonicalEventJson: canonical,
      validationStatus: input.validationStatus,
      rejectionReason: input.rejectionReason,
    };
    return { inserted: true, duplicate: false, record };
  }

  async getByEventID(eventID: string): Promise<StoredEventRecord | null> {
    const row = this.db
      .prepare(`SELECT * FROM ct_events WHERE event_id = ?`)
      .get(eventID) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  async getByUpstreamMessageID(
    upstreamMessageID: string,
  ): Promise<StoredEventRecord | null> {
    const row = this.db
      .prepare(`SELECT * FROM ct_events WHERE upstream_message_id = ?`)
      .get(upstreamMessageID) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  async listValidByThreadID(threadID: string): Promise<StoredEventRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM ct_events WHERE thread_id = ? AND validation_status = 'valid'`,
      )
      .all(threadID) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  async listAllValid(): Promise<StoredEventRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM ct_events WHERE validation_status = 'valid'`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  async pruneRejected(olderThan: Date): Promise<number> {
    const result = this.db
      .prepare(
        `DELETE FROM ct_events WHERE validation_status = 'rejected' AND received_at < ?`,
      )
      .run(olderThan.toISOString());
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// Re-exported for existing importers; the implementation now lives beside the
// store interface so it stays importable from a browser.
export { recordToEvent } from "./CommonThreadEventStore.js";
