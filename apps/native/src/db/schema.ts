/**
 * SQLite schema for the local event log, seen-id index and outbound queue.
 *
 * The outbox lives here rather than in JavaScript memory: a post created with
 * no peer in range has to survive the app being killed and still send exactly
 * once when a peer appears.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Append-only log of every accepted envelope, ours and theirs.
CREATE TABLE IF NOT EXISTS events (
  message_id     TEXT PRIMARY KEY NOT NULL,
  room_id        TEXT NOT NULL,
  sender_id      TEXT NOT NULL,
  type           TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  created_at_ms  INTEGER NOT NULL,
  expires_at_ms  INTEGER NOT NULL,
  hop_count      INTEGER NOT NULL,
  max_hops       INTEGER NOT NULL,
  signature      TEXT NOT NULL,
  -- NULL for our own posts; the peer we first heard it from otherwise.
  received_from  TEXT,
  received_at_ms INTEGER NOT NULL,
  is_local       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_room_created
  ON events (room_id, created_at_ms, message_id);

CREATE INDEX IF NOT EXISTS idx_events_expiry
  ON events (expires_at_ms);

-- Dedup index. Kept separate from the events table so an id stays suppressed
-- even after the event itself is pruned for expiry. That stops an expired
-- message being re-accepted and re-presented when a relay echoes it back.
CREATE TABLE IF NOT EXISTS seen_messages (
  message_id  TEXT PRIMARY KEY NOT NULL,
  room_id     TEXT NOT NULL,
  seen_at_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seen_room ON seen_messages (room_id);

-- Durable outbound queue. A row leaves only when a directly connected peer
-- confirms it has PERSISTED the envelope.
CREATE TABLE IF NOT EXISTS outbox (
  message_id      TEXT PRIMARY KEY NOT NULL,
  room_id         TEXT NOT NULL,
  envelope_json   TEXT NOT NULL,
  created_at_ms   INTEGER NOT NULL,
  expires_at_ms   INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_ms INTEGER,
  -- 'pending' until a peer acks persistence, then the row is deleted.
  state           TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox (state, created_at_ms);

-- Who this install is, and which room it joined. One row, id = 1.
CREATE TABLE IF NOT EXISTS identity (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  device_id     TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  room_id       TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
