import { describe, expect, it } from 'vitest';

import { utf8Encode } from '../src/crypto/bytes';
import { listThreads, reduceEnvelopes } from '../src/domain/ThreadReducer';
import { createEnvelope, type RoomSecret } from '../src/mesh/EnvelopeCodec';
import type { MeshEnvelope, MeshEventType } from '../src/mesh/MeshEnvelope';

const NOW = 1_700_000_000_000;

const secret: RoomSecret = {
  roomId: 'room-alpha',
  key: utf8Encode('a-high-entropy-room-secret-value'),
};

function event(
  messageId: string,
  senderId: string,
  type: MeshEventType,
  payload: Record<string, unknown>,
  offsetMs = 0,
): MeshEnvelope {
  return createEnvelope(
    {
      messageId,
      senderId,
      type,
      payload,
      createdAtMs: NOW + offsetMs,
      ttlMs: 60 * 60 * 1000,
    },
    secret,
  );
}

/** Every permutation of a small set, for order-independence checks. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const permutation of permutations(rest)) {
      result.push([items[i], ...permutation]);
    }
  }
  return result;
}

const request = event('t1', 'alice', 'thread.created', {
  title: 'Need blankets',
  category: 'supplies',
  place: 'north stairwell',
});

const reply = event('r1', 'bob', 'thread.reply', { threadId: 't1', text: 'On my way' }, 10);

const offer = event(
  'o1',
  'carol',
  'thread.reply',
  { threadId: 't1', text: 'I have three spare', isOffer: true },
  20,
);

const accept = event('a1', 'alice', 'offer.accepted', { threadId: 't1', offerId: 'o1' }, 30);

const resolve = event('x1', 'alice', 'thread.resolved', { threadId: 't1', outcome: 'sorted' }, 40);

describe('thread reduction', () => {
  it('builds a thread from a request', () => {
    const state = reduceEnvelopes([request]);
    const thread = state.threads.get('t1');

    expect(thread?.title).toBe('Need blankets');
    expect(thread?.category).toBe('supplies');
    expect(thread?.place).toBe('north stairwell');
    expect(thread?.createdBy).toBe('alice');
    expect(thread?.status).toBe('open');
  });

  it('collects replies and offers separately', () => {
    const state = reduceEnvelopes([request, reply, offer]);
    const thread = state.threads.get('t1');

    expect(thread?.replies.map((r) => r.text)).toEqual(['On my way']);
    expect(thread?.offers.map((o) => o.description)).toEqual(['I have three spare']);
  });

  it('moves to matched when the creator accepts an offer', () => {
    const state = reduceEnvelopes([request, offer, accept]);
    const thread = state.threads.get('t1');

    expect(thread?.status).toBe('matched');
    expect(thread?.offers[0].accepted).toBe(true);
  });

  it('moves to resolved with its outcome', () => {
    const state = reduceEnvelopes([request, offer, accept, resolve]);
    const thread = state.threads.get('t1');

    expect(thread?.status).toBe('resolved');
    expect(thread?.resolvedOutcome).toBe('sorted');
  });
});

describe('authorisation', () => {
  it('ignores an accept from someone other than the creator', () => {
    const forged = event('a2', 'mallory', 'offer.accepted', {
      threadId: 't1',
      offerId: 'o1',
    }, 30);

    const state = reduceEnvelopes([request, offer, forged]);
    const thread = state.threads.get('t1');

    expect(thread?.status).toBe('open');
    expect(thread?.offers[0].accepted).toBe(false);
  });

  it('ignores a resolve from someone other than the creator', () => {
    const forged = event('x2', 'mallory', 'thread.resolved', { threadId: 't1' }, 40);
    const state = reduceEnvelopes([request, forged]);
    expect(state.threads.get('t1')?.status).toBe('open');
  });

  it('lets anyone reply or offer', () => {
    const state = reduceEnvelopes([request, reply, offer]);
    const thread = state.threads.get('t1');
    expect(thread?.replies).toHaveLength(1);
    expect(thread?.offers).toHaveLength(1);
  });
});

describe('order independence', () => {
  // A mesh delivers in whatever order the radio manages. Every device must
  // land on the same state regardless.
  it('produces identical state for every arrival order of a full thread', () => {
    const envelopes = [request, offer, accept, resolve];
    const results = permutations(envelopes).map((order) => {
      const thread = reduceEnvelopes(order).threads.get('t1');
      return {
        status: thread?.status,
        title: thread?.title,
        createdBy: thread?.createdBy,
        outcome: thread?.resolvedOutcome,
        accepted: thread?.offers.filter((o) => o.accepted).map((o) => o.messageId),
      };
    });

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0].status).toBe('resolved');
    expect(results[0].accepted).toEqual(['o1']);
  });

  it('handles a reply arriving before its request', () => {
    const state = reduceEnvelopes([reply, request]);
    const thread = state.threads.get('t1');

    expect(thread?.title).toBe('Need blankets');
    expect(thread?.replies).toHaveLength(1);
  });

  it('handles an accept arriving before its offer', () => {
    const state = reduceEnvelopes([request, accept, offer]);
    const thread = state.threads.get('t1');

    expect(thread?.status).toBe('matched');
    expect(thread?.offers.find((o) => o.messageId === 'o1')?.accepted).toBe(true);
    expect(thread?.offers.find((o) => o.messageId === 'o1')?.description).toBe(
      'I have three spare',
    );
  });

  it('does not lose an accept that arrived before the request', () => {
    const state = reduceEnvelopes([offer, accept, request]);
    expect(state.threads.get('t1')?.status).toBe('matched');
  });

  it('sorts replies by time then id regardless of arrival order', () => {
    const r2 = event('r2', 'dana', 'thread.reply', { threadId: 't1', text: 'second' }, 15);
    const state = reduceEnvelopes([request, r2, reply]);
    expect(state.threads.get('t1')?.replies.map((r) => r.messageId)).toEqual(['r1', 'r2']);
  });
});

describe('duplicate application', () => {
  it('applies the same envelope twice without duplicating a reply', () => {
    const state = reduceEnvelopes([request, reply, reply, reply]);
    expect(state.threads.get('t1')?.replies).toHaveLength(1);
  });

  it('applies a relayed copy with a higher hop count without duplicating', () => {
    const relayed = { ...reply, hopCount: 1 };
    const state = reduceEnvelopes([request, reply, relayed]);
    expect(state.threads.get('t1')?.replies).toHaveLength(1);
  });
});

describe('malformed payloads', () => {
  it('ignores a reply with no thread id', () => {
    const orphan = event('r9', 'bob', 'thread.reply', { text: 'hello' });
    expect(reduceEnvelopes([orphan]).threads.size).toBe(0);
  });

  it('ignores a reply with no text', () => {
    const empty = event('r9', 'bob', 'thread.reply', { threadId: 't1' });
    expect(reduceEnvelopes([request, empty]).threads.get('t1')?.replies).toHaveLength(0);
  });

  it('ignores an accept with no offer id', () => {
    const bad = event('a9', 'alice', 'offer.accepted', { threadId: 't1' }, 30);
    expect(reduceEnvelopes([request, offer, bad]).threads.get('t1')?.status).toBe('open');
  });

  it('ignores presence envelopes', () => {
    const presence = event('p1', 'bob', 'presence', {});
    expect(reduceEnvelopes([presence]).threads.size).toBe(0);
  });
});

describe('listThreads', () => {
  it('returns newest threads first', () => {
    const second = event('t2', 'bob', 'thread.created', { title: 'Need water' }, 1000);
    const threads = listThreads(reduceEnvelopes([request, second]));
    expect(threads.map((t) => t.threadId)).toEqual(['t2', 't1']);
  });
});
