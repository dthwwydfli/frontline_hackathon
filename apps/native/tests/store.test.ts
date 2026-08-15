import { beforeEach, describe, expect, it } from 'vitest';

import { utf8Encode } from '../src/crypto/bytes';
import { EventStore } from '../src/db/EventStore';
import { createEnvelope, type RoomSecret } from '../src/mesh/EnvelopeCodec';
import type { MeshEnvelope } from '../src/mesh/MeshEnvelope';
import { FakeDatabase } from './support/FakeDatabase';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const secret: RoomSecret = {
  roomId: 'room-alpha',
  key: utf8Encode('a-high-entropy-room-secret-value'),
};

function envelope(messageId: string, overrides: Partial<MeshEnvelope> = {}): MeshEnvelope {
  const base = createEnvelope(
    {
      messageId,
      senderId: 'device-a',
      type: 'thread.created',
      payload: { title: 'Need blankets' },
      createdAtMs: NOW,
      ttlMs: HOUR,
    },
    secret,
  );
  return { ...base, ...overrides };
}

describe('EventStore dedup', () => {
  let db: FakeDatabase;
  let store: EventStore;

  beforeEach(async () => {
    db = new FakeDatabase();
    store = new EventStore(db);
    await store.migrate();
  });

  it('records an unseen envelope', async () => {
    const inserted = await store.recordEvent(envelope('msg-1'), {
      receivedFrom: 'peer-b',
      receivedAtMs: NOW,
      isLocal: false,
    });
    expect(inserted).toBe(true);
    expect(await store.hasSeen('msg-1')).toBe(true);
  });

  it('reports an id it has never seen', async () => {
    expect(await store.hasSeen('never')).toBe(false);
  });

  it('stores the same message once when it arrives over two paths', async () => {
    const e = envelope('msg-1');

    const first = await store.recordEvent(e, {
      receivedFrom: 'peer-b',
      receivedAtMs: NOW,
      isLocal: false,
    });
    // Same message id, arriving via a different relay with a higher hop count.
    const second = await store.recordEvent(
      { ...e, hopCount: 1 },
      { receivedFrom: 'peer-c', receivedAtMs: NOW + 500, isLocal: false },
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(db.countEvents()).toBe(1);

    const events = await store.listEvents('room-alpha');
    expect(events).toHaveLength(1);
    // The first copy wins, so the recorded hop count is the shortest path seen.
    expect(events[0].hopCount).toBe(0);
    expect(events[0].receivedFrom).toBe('peer-b');
  });

  it('orders events by creation time then id', async () => {
    await store.recordEvent(envelope('msg-b', { createdAtMs: NOW + 10 }), {
      receivedFrom: null,
      receivedAtMs: NOW,
      isLocal: true,
    });
    await store.recordEvent(envelope('msg-a', { createdAtMs: NOW }), {
      receivedFrom: null,
      receivedAtMs: NOW,
      isLocal: true,
    });
    await store.recordEvent(envelope('msg-c', { createdAtMs: NOW }), {
      receivedFrom: null,
      receivedAtMs: NOW,
      isLocal: true,
    });

    const ids = (await store.listEvents('room-alpha')).map((e) => e.messageId);
    expect(ids).toEqual(['msg-a', 'msg-c', 'msg-b']);
  });

  it('round-trips the payload', async () => {
    const e = envelope('msg-1', { payload: { title: 'Need water', count: 3 } });
    await store.recordEvent(e, { receivedFrom: null, receivedAtMs: NOW, isLocal: true });

    const stored = await store.getEvent('msg-1');
    expect(stored?.payload).toEqual({ title: 'Need water', count: 3 });
  });
});

describe('EventStore outbox', () => {
  let db: FakeDatabase;
  let store: EventStore;

  beforeEach(async () => {
    db = new FakeDatabase();
    store = new EventStore(db);
    await store.migrate();
  });

  it('writes the event and the queue row together', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);

    expect(db.countEvents()).toBe(1);
    expect(db.countOutbox()).toBe(1);
    expect(await store.hasSeen('msg-1')).toBe(true);
    expect(await store.isQueued('msg-1')).toBe(true);
  });

  it('rolls back both halves when the write fails', async () => {
    db.failNextWrite = true;

    await expect(store.recordLocalAndQueue(envelope('msg-1'), NOW)).rejects.toThrow();

    // A post the user can see but that will never send would be worse than
    // losing it outright, so neither half may survive alone.
    expect(db.countEvents()).toBe(0);
    expect(db.countOutbox()).toBe(0);
    expect(db.countSeen()).toBe(0);
  });

  it('survives the app being killed and relaunched', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);

    const reopened = new EventStore(db.reopen());
    const pending = await reopened.pendingOutbox('room-alpha', NOW);

    expect(pending).toHaveLength(1);
    expect(pending[0].messageId).toBe('msg-1');
    expect(pending[0].envelope.signature).toBe(envelope('msg-1').signature);
  });

  it('keeps the event after the queue row clears', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);
    await store.clearFromOutbox('msg-1');

    expect(await store.isQueued('msg-1')).toBe(false);
    // The user's own post stays visible, and its id keeps suppressing relayed
    // copies that loop back.
    expect(await store.getEvent('msg-1')).not.toBeNull();
    expect(await store.hasSeen('msg-1')).toBe(true);
  });

  it('does not queue the same message twice', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);
    await store.recordLocalAndQueue(envelope('msg-1'), NOW + 1000);
    expect(db.countOutbox()).toBe(1);
  });

  it('counts attempts without dequeuing', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);
    await store.markAttempted('msg-1', NOW + 100);
    await store.markAttempted('msg-1', NOW + 200);

    const pending = await store.pendingOutbox('room-alpha', NOW + 300);
    expect(pending[0].attempts).toBe(2);
    expect(pending[0].lastAttemptMs).toBe(NOW + 200);
  });

  it('hides expired queue rows', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);
    expect(await store.pendingOutbox('room-alpha', NOW + HOUR + 1)).toHaveLength(0);
  });

  it('scopes the queue to one room', async () => {
    await store.recordLocalAndQueue(envelope('msg-1'), NOW);
    expect(await store.pendingOutbox('room-beta', NOW)).toHaveLength(0);
  });
});

describe('EventStore expiry', () => {
  let db: FakeDatabase;
  let store: EventStore;

  beforeEach(async () => {
    db = new FakeDatabase();
    store = new EventStore(db);
    await store.migrate();
  });

  it('drops expired events but keeps their ids suppressed', async () => {
    await store.recordEvent(envelope('msg-1'), {
      receivedFrom: 'peer-b',
      receivedAtMs: NOW,
      isLocal: false,
    });

    await store.pruneExpired(NOW + HOUR + 1);

    expect(db.countEvents()).toBe(0);
    // Forgetting the id would let a relay echo re-deliver an expired message
    // and present it as new.
    expect(await store.hasSeen('msg-1')).toBe(true);
  });

  it('keeps events that have not expired', async () => {
    await store.recordEvent(envelope('msg-1'), {
      receivedFrom: null,
      receivedAtMs: NOW,
      isLocal: true,
    });
    await store.pruneExpired(NOW + 1000);
    expect(db.countEvents()).toBe(1);
  });
});

describe('EventStore identity', () => {
  it('round-trips identity and survives a restart', async () => {
    const db = new FakeDatabase();
    const store = new EventStore(db);
    await store.migrate();

    expect(await store.getIdentity()).toBeNull();

    await store.saveIdentity('device-abc', 'Sam', 'room-alpha', NOW);
    const reopened = new EventStore(db.reopen());

    expect(await reopened.getIdentity()).toEqual({
      deviceId: 'device-abc',
      displayName: 'Sam',
      roomId: 'room-alpha',
    });
  });
});
