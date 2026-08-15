/**
 * In-memory stand-in for the slice of expo-sqlite EventStore uses.
 *
 * Not a SQL engine. It recognises the specific statements the store issues and
 * models the parts that matter for correctness: primary-key uniqueness,
 * INSERT OR IGNORE semantics, and transaction rollback. That is enough to test
 * exactly-once queueing and dedup without a native module.
 */

import type { SqliteDatabase } from '../../src/db/EventStore';

type Row = Record<string, unknown>;

type Tables = {
  events: Map<string, Row>;
  seen_messages: Map<string, Row>;
  outbox: Map<string, Row>;
  identity: Map<string, Row>;
  meta: Map<string, Row>;
};

function emptyTables(): Tables {
  return {
    events: new Map(),
    seen_messages: new Map(),
    outbox: new Map(),
    identity: new Map(),
    meta: new Map(),
  };
}

function cloneTables(tables: Tables): Tables {
  return {
    events: new Map(tables.events),
    seen_messages: new Map(tables.seen_messages),
    outbox: new Map(tables.outbox),
    identity: new Map(tables.identity),
    meta: new Map(tables.meta),
  };
}

export class FakeDatabase implements SqliteDatabase {
  private tables = emptyTables();

  /** Set to make the next write throw, to prove a transaction rolls back. */
  failNextWrite = false;

  async execAsync(_sql: string): Promise<void> {
    // Schema DDL. The fake's tables already exist.
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated write failure');
    }

    const statement = sql.trim().replace(/\s+/g, ' ');

    if (statement.startsWith('INSERT OR IGNORE INTO seen_messages')) {
      const [messageId, roomId, seenAt] = params as [string, string, number];
      if (this.tables.seen_messages.has(messageId)) return { changes: 0 };
      this.tables.seen_messages.set(messageId, {
        message_id: messageId,
        room_id: roomId,
        seen_at_ms: seenAt,
      });
      return { changes: 1 };
    }

    if (statement.startsWith('INSERT OR IGNORE INTO events')) {
      const isLocalForm = statement.includes('NULL, ?, 1');
      const [
        messageId,
        roomId,
        senderId,
        type,
        payloadJson,
        createdAt,
        expiresAt,
        hopCount,
        maxHops,
        signature,
      ] = params as [string, string, string, string, string, number, number, number, number, string];

      if (this.tables.events.has(messageId)) return { changes: 0 };

      const receivedFrom = isLocalForm ? null : (params[10] as string | null);
      const receivedAt = isLocalForm ? (params[10] as number) : (params[11] as number);
      const isLocal = isLocalForm ? 1 : (params[12] as number);

      this.tables.events.set(messageId, {
        message_id: messageId,
        room_id: roomId,
        sender_id: senderId,
        type,
        payload_json: payloadJson,
        created_at_ms: createdAt,
        expires_at_ms: expiresAt,
        hop_count: hopCount,
        max_hops: maxHops,
        signature,
        received_from: receivedFrom,
        received_at_ms: receivedAt,
        is_local: isLocal,
      });
      return { changes: 1 };
    }

    if (statement.startsWith('INSERT OR IGNORE INTO outbox')) {
      const [messageId, roomId, envelopeJson, createdAt, expiresAt] = params as [
        string,
        string,
        string,
        number,
        number,
      ];
      if (this.tables.outbox.has(messageId)) return { changes: 0 };
      this.tables.outbox.set(messageId, {
        message_id: messageId,
        room_id: roomId,
        envelope_json: envelopeJson,
        created_at_ms: createdAt,
        expires_at_ms: expiresAt,
        attempts: 0,
        last_attempt_ms: null,
        state: 'pending',
      });
      return { changes: 1 };
    }

    if (statement.startsWith('UPDATE outbox SET attempts')) {
      const [nowMs, messageId] = params as [number, string];
      const row = this.tables.outbox.get(messageId);
      if (row === undefined) return { changes: 0 };
      row.attempts = (row.attempts as number) + 1;
      row.last_attempt_ms = nowMs;
      return { changes: 1 };
    }

    if (statement.startsWith('DELETE FROM outbox WHERE message_id')) {
      const [messageId] = params as [string];
      return { changes: this.tables.outbox.delete(messageId) ? 1 : 0 };
    }

    if (statement.startsWith('DELETE FROM events WHERE expires_at_ms')) {
      const [cutoff] = params as [number];
      let changes = 0;
      for (const [key, row] of this.tables.events) {
        if ((row.expires_at_ms as number) <= cutoff) {
          this.tables.events.delete(key);
          changes++;
        }
      }
      return { changes };
    }

    if (statement.startsWith('DELETE FROM outbox WHERE expires_at_ms')) {
      const [cutoff] = params as [number];
      let changes = 0;
      for (const [key, row] of this.tables.outbox) {
        if ((row.expires_at_ms as number) <= cutoff) {
          this.tables.outbox.delete(key);
          changes++;
        }
      }
      return { changes };
    }

    if (statement.startsWith('INSERT INTO identity')) {
      const [deviceId, displayName, roomId, createdAt] = params as [
        string,
        string,
        string | null,
        number,
      ];
      this.tables.identity.set('1', {
        id: 1,
        device_id: deviceId,
        display_name: displayName,
        room_id: roomId,
        created_at_ms: createdAt,
      });
      return { changes: 1 };
    }

    if (statement.startsWith('INSERT INTO meta')) {
      const [value] = params as [string];
      this.tables.meta.set('schema_version', { key: 'schema_version', value });
      return { changes: 1 };
    }

    throw new Error(`FakeDatabase does not model this statement: ${statement}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const statement = sql.trim().replace(/\s+/g, ' ');

    if (statement.startsWith('SELECT message_id FROM seen_messages')) {
      const [messageId] = params as [string];
      const row = this.tables.seen_messages.get(messageId);
      return row === undefined ? [] : [row as T];
    }

    if (statement.startsWith('SELECT * FROM events WHERE room_id')) {
      const [roomId] = params as [string];
      return [...this.tables.events.values()]
        .filter((row) => row.room_id === roomId)
        .sort((a, b) => {
          const delta = (a.created_at_ms as number) - (b.created_at_ms as number);
          if (delta !== 0) return delta;
          return (a.message_id as string) < (b.message_id as string) ? -1 : 1;
        }) as T[];
    }

    if (statement.startsWith('SELECT * FROM events WHERE message_id')) {
      const [messageId] = params as [string];
      const row = this.tables.events.get(messageId);
      return row === undefined ? [] : [row as T];
    }

    if (statement.startsWith('SELECT * FROM outbox')) {
      const [roomId, nowMs] = params as [string, number];
      return [...this.tables.outbox.values()]
        .filter(
          (row) =>
            row.room_id === roomId &&
            row.state === 'pending' &&
            (row.expires_at_ms as number) > nowMs,
        )
        .sort((a, b) => (a.created_at_ms as number) - (b.created_at_ms as number)) as T[];
    }

    if (statement.startsWith('SELECT message_id FROM outbox')) {
      const [messageId] = params as [string];
      const row = this.tables.outbox.get(messageId);
      if (row === undefined || row.state !== 'pending') return [];
      return [row as T];
    }

    if (statement.startsWith('SELECT device_id, display_name, room_id FROM identity')) {
      const row = this.tables.identity.get('1');
      return row === undefined ? [] : [row as T];
    }

    throw new Error(`FakeDatabase does not model this query: ${statement}`);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    const snapshot = cloneTables(this.tables);
    try {
      await task();
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }

  /** Simulates the process being killed and the app relaunching. */
  reopen(): FakeDatabase {
    const next = new FakeDatabase();
    next.tables = cloneTables(this.tables);
    return next;
  }

  countOutbox(): number {
    return this.tables.outbox.size;
  }

  countEvents(): number {
    return this.tables.events.size;
  }

  countSeen(): number {
    return this.tables.seen_messages.size;
  }
}
