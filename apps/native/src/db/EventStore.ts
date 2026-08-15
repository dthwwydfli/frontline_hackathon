/**
 * Durable event log, seen-id index and outbox.
 *
 * Deliberately narrow: it stores and retrieves envelopes and queue rows. It
 * does not validate signatures (EnvelopeCodec does) and does not decide what a
 * thread looks like (ThreadReducer does).
 */

import type { MeshEnvelope, MeshEventType } from '../mesh/MeshEnvelope';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

/**
 * The slice of expo-sqlite this store needs. Declared structurally so the
 * tests can drive it with an in-memory double and no native module.
 */
export interface SqliteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type StoredEvent = MeshEnvelope & {
  receivedFrom: string | null;
  receivedAtMs: number;
  isLocal: boolean;
};

export type OutboxEntry = {
  messageId: string;
  roomId: string;
  envelope: MeshEnvelope;
  createdAtMs: number;
  expiresAtMs: number;
  attempts: number;
  lastAttemptMs: number | null;
};

type EventRow = {
  message_id: string;
  room_id: string;
  sender_id: string;
  type: string;
  payload_json: string;
  created_at_ms: number;
  expires_at_ms: number;
  hop_count: number;
  max_hops: number;
  signature: string;
  received_from: string | null;
  received_at_ms: number;
  is_local: number;
};

type OutboxRow = {
  message_id: string;
  room_id: string;
  envelope_json: string;
  created_at_ms: number;
  expires_at_ms: number;
  attempts: number;
  last_attempt_ms: number | null;
};

function rowToEvent(row: EventRow): StoredEvent {
  return {
    version: 1,
    messageId: row.message_id,
    roomId: row.room_id,
    senderId: row.sender_id,
    type: row.type as MeshEventType,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    hopCount: row.hop_count,
    maxHops: row.max_hops,
    signature: row.signature,
    receivedFrom: row.received_from,
    receivedAtMs: row.received_at_ms,
    isLocal: row.is_local === 1,
  };
}

export class EventStore {
  constructor(private readonly db: SqliteDatabase) {}

  async migrate(): Promise<void> {
    await this.db.execAsync(SCHEMA_SQL);
    await this.db.runAsync(
      `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(SCHEMA_VERSION)],
    );
  }

  // -------------------------------------------------------------------
  // Dedup
  // -------------------------------------------------------------------

  async hasSeen(messageId: string): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ message_id: string }>(
      'SELECT message_id FROM seen_messages WHERE message_id = ?',
      [messageId],
    );
    return row !== null;
  }

  // -------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------

  /**
   * Record an envelope and mark its id seen, in one transaction.
   *
   * Returns false when the id was already present, which is the normal outcome
   * when the same message arrives over two radio paths. Callers use the return
   * value to decide whether to present it, never to decide whether to ack.
   */
  async recordEvent(
    envelope: MeshEnvelope,
    options: { receivedFrom: string | null; receivedAtMs: number; isLocal: boolean },
  ): Promise<boolean> {
    let inserted = false;

    await this.db.withTransactionAsync(async () => {
      const seen = await this.db.runAsync(
        'INSERT OR IGNORE INTO seen_messages (message_id, room_id, seen_at_ms) VALUES (?, ?, ?)',
        [envelope.messageId, envelope.roomId, options.receivedAtMs],
      );

      if (seen.changes === 0) {
        inserted = false;
        return;
      }

      await this.db.runAsync(
        `INSERT OR IGNORE INTO events (
           message_id, room_id, sender_id, type, payload_json,
           created_at_ms, expires_at_ms, hop_count, max_hops, signature,
           received_from, received_at_ms, is_local
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          envelope.messageId,
          envelope.roomId,
          envelope.senderId,
          envelope.type,
          JSON.stringify(envelope.payload),
          envelope.createdAtMs,
          envelope.expiresAtMs,
          envelope.hopCount,
          envelope.maxHops,
          envelope.signature,
          options.receivedFrom,
          options.receivedAtMs,
          options.isLocal ? 1 : 0,
        ],
      );

      inserted = true;
    });

    return inserted;
  }

  /**
   * Store a locally created envelope and queue it, atomically.
   *
   * Both halves must land together. An event in the log with no outbox row
   * would be a post the user can see but that will never send; an outbox row
   * with no event would resend something we cannot show.
   */
  async recordLocalAndQueue(envelope: MeshEnvelope, nowMs: number): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'INSERT OR IGNORE INTO seen_messages (message_id, room_id, seen_at_ms) VALUES (?, ?, ?)',
        [envelope.messageId, envelope.roomId, nowMs],
      );

      await this.db.runAsync(
        `INSERT OR IGNORE INTO events (
           message_id, room_id, sender_id, type, payload_json,
           created_at_ms, expires_at_ms, hop_count, max_hops, signature,
           received_from, received_at_ms, is_local
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`,
        [
          envelope.messageId,
          envelope.roomId,
          envelope.senderId,
          envelope.type,
          JSON.stringify(envelope.payload),
          envelope.createdAtMs,
          envelope.expiresAtMs,
          envelope.hopCount,
          envelope.maxHops,
          envelope.signature,
          nowMs,
        ],
      );

      await this.db.runAsync(
        `INSERT OR IGNORE INTO outbox (
           message_id, room_id, envelope_json, created_at_ms, expires_at_ms, state
         ) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [
          envelope.messageId,
          envelope.roomId,
          JSON.stringify(envelope),
          envelope.createdAtMs,
          envelope.expiresAtMs,
        ],
      );
    });
  }

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  async listEvents(roomId: string): Promise<StoredEvent[]> {
    const rows = await this.db.getAllAsync<EventRow>(
      `SELECT * FROM events WHERE room_id = ?
       ORDER BY created_at_ms ASC, message_id ASC`,
      [roomId],
    );
    return rows.map(rowToEvent);
  }

  async getEvent(messageId: string): Promise<StoredEvent | null> {
    const row = await this.db.getFirstAsync<EventRow>(
      'SELECT * FROM events WHERE message_id = ?',
      [messageId],
    );
    return row === null ? null : rowToEvent(row);
  }

  // -------------------------------------------------------------------
  // Outbox
  // -------------------------------------------------------------------

  /** Queue rows still waiting for a peer to confirm persistence. */
  async pendingOutbox(roomId: string, nowMs: number): Promise<OutboxEntry[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox
       WHERE room_id = ? AND state = 'pending' AND expires_at_ms > ?
       ORDER BY created_at_ms ASC`,
      [roomId, nowMs],
    );

    return rows.map((row) => ({
      messageId: row.message_id,
      roomId: row.room_id,
      envelope: JSON.parse(row.envelope_json) as MeshEnvelope,
      createdAtMs: row.created_at_ms,
      expiresAtMs: row.expires_at_ms,
      attempts: row.attempts,
      lastAttemptMs: row.last_attempt_ms,
    }));
  }

  async markAttempted(messageId: string, nowMs: number): Promise<void> {
    await this.db.runAsync(
      'UPDATE outbox SET attempts = attempts + 1, last_attempt_ms = ? WHERE message_id = ?',
      [nowMs, messageId],
    );
  }

  /**
   * Remove a queue row after a directly connected peer confirmed persistence.
   *
   * The event itself stays in the log: the user's own post must remain visible
   * and must keep suppressing relayed copies that loop back to us.
   */
  async clearFromOutbox(messageId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM outbox WHERE message_id = ?', [messageId]);
  }

  async isQueued(messageId: string): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ message_id: string }>(
      "SELECT message_id FROM outbox WHERE message_id = ? AND state = 'pending'",
      [messageId],
    );
    return row !== null;
  }

  // -------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------

  /**
   * Drop expired events and queue rows. Seen ids are kept: forgetting one
   * would let an expired message be re-accepted when a relay echoes it back.
   */
  async pruneExpired(nowMs: number): Promise<void> {
    await this.db.runAsync('DELETE FROM events WHERE expires_at_ms <= ?', [nowMs]);
    await this.db.runAsync('DELETE FROM outbox WHERE expires_at_ms <= ?', [nowMs]);
  }

  // -------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------

  async getIdentity(): Promise<{
    deviceId: string;
    displayName: string;
    roomId: string | null;
  } | null> {
    const row = await this.db.getFirstAsync<{
      device_id: string;
      display_name: string;
      room_id: string | null;
    }>('SELECT device_id, display_name, room_id FROM identity WHERE id = 1');

    if (row === null) return null;
    return {
      deviceId: row.device_id,
      displayName: row.display_name,
      roomId: row.room_id,
    };
  }

  async saveIdentity(
    deviceId: string,
    displayName: string,
    roomId: string | null,
    nowMs: number,
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO identity (id, device_id, display_name, room_id, created_at_ms)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         device_id = excluded.device_id,
         display_name = excluded.display_name,
         room_id = excluded.room_id`,
      [deviceId, displayName, roomId, nowMs],
    );
  }
}
