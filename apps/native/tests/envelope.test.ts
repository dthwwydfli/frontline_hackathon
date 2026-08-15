import { describe, expect, it } from 'vitest';

import { utf8Encode } from '../src/crypto/bytes';
import {
  createEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  forwardedCopy,
  signatureFor,
  verifyEnvelope,
  type RoomSecret,
} from '../src/mesh/EnvelopeCodec';
import {
  MAX_PAYLOAD_BYTES,
  canonicalJson,
  canonicalSigningString,
  validateEnvelope,
  type MeshEnvelope,
} from '../src/mesh/MeshEnvelope';

const NOW = 1_700_000_000_000;

const secret: RoomSecret = {
  roomId: 'room-alpha',
  key: utf8Encode('a-high-entropy-room-secret-value'),
};

const otherSecret: RoomSecret = {
  roomId: 'room-alpha',
  key: utf8Encode('a-completely-different-secret!!!'),
};

function makeEnvelope(overrides: Partial<MeshEnvelope> = {}): MeshEnvelope {
  const base = createEnvelope(
    {
      messageId: 'msg-1',
      senderId: 'device-a',
      type: 'thread.created',
      payload: { title: 'Need blankets', category: 'supplies', place: 'north stairwell' },
      createdAtMs: NOW,
      ttlMs: 60 * 60 * 1000,
    },
    secret,
  );
  return { ...base, ...overrides };
}

describe('canonicalJson', () => {
  it('sorts keys so two devices produce identical bytes', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys at every depth', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('rejects undefined rather than silently dropping a signed field', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it('produces the same signing string regardless of field insertion order', () => {
    const a = makeEnvelope();
    const reordered = JSON.parse(
      JSON.stringify({
        payload: a.payload,
        type: a.type,
        maxHops: a.maxHops,
        expiresAtMs: a.expiresAtMs,
        createdAtMs: a.createdAtMs,
        senderId: a.senderId,
        roomId: a.roomId,
        messageId: a.messageId,
        version: a.version,
      }),
    );
    expect(canonicalSigningString(reordered)).toBe(canonicalSigningString(a));
  });
});

describe('signature', () => {
  it('accepts an untampered envelope', () => {
    const result = verifyEnvelope(makeEnvelope(), secret, NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects an envelope signed with a different room secret', () => {
    const forged = createEnvelope(
      {
        messageId: 'msg-2',
        senderId: 'device-x',
        type: 'thread.created',
        payload: { title: 'hi' },
        createdAtMs: NOW,
        ttlMs: 60_000,
      },
      otherSecret,
    );
    const result = verifyEnvelope(forged, secret, NOW);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload', () => {
    const envelope = makeEnvelope();
    const tampered = { ...envelope, payload: { title: 'Need generators' } };
    expect(verifyEnvelope(tampered, secret, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered senderId', () => {
    const envelope = makeEnvelope();
    const tampered = { ...envelope, senderId: 'device-impostor' };
    expect(verifyEnvelope(tampered, secret, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an envelope addressed to a different room', () => {
    // Cheap room check runs before the hash, so a flood of foreign traffic
    // costs a string compare rather than an HMAC.
    const envelope = makeEnvelope({ roomId: 'room-beta' });
    expect(verifyEnvelope(envelope, secret, NOW)).toEqual({
      ok: false,
      reason: 'wrong_room',
    });
  });

  it('rejects an envelope validly signed for another room', () => {
    const betaSecret: RoomSecret = { roomId: 'room-beta', key: secret.key };
    const envelope = createEnvelope(
      {
        messageId: 'msg-3',
        senderId: 'device-a',
        type: 'presence',
        payload: {},
        createdAtMs: NOW,
        ttlMs: 60_000,
      },
      betaSecret,
    );
    expect(verifyEnvelope(envelope, secret, NOW)).toEqual({
      ok: false,
      reason: 'wrong_room',
    });
  });

  it('does not cover hopCount, so a relay need not re-sign', () => {
    const envelope = makeEnvelope();
    const relayed = { ...envelope, hopCount: 1 };
    expect(signatureFor(relayed, secret)).toBe(envelope.signature);
    expect(verifyEnvelope(relayed, secret, NOW).ok).toBe(true);
  });
});

describe('validateEnvelope', () => {
  it('rejects a non-object', () => {
    expect(validateEnvelope(null, NOW).ok).toBe(false);
    expect(validateEnvelope('CT1:', NOW).ok).toBe(false);
    expect(validateEnvelope([], NOW)).toEqual({ ok: false, reason: 'not_an_object' });
  });

  it('rejects an unknown protocol version', () => {
    expect(validateEnvelope(makeEnvelope({ version: 2 as 1 }), NOW)).toEqual({
      ok: false,
      reason: 'bad_version',
    });
  });

  it('rejects an unknown event type', () => {
    const bad = { ...makeEnvelope(), type: 'thread.deleted' };
    expect(validateEnvelope(bad, NOW)).toEqual({ ok: false, reason: 'bad_type' });
  });

  it('rejects ids containing separators the canonical form relies on', () => {
    expect(validateEnvelope(makeEnvelope({ messageId: 'msg 1' }), NOW)).toEqual({
      ok: false,
      reason: 'bad_message_id',
    });
    expect(validateEnvelope(makeEnvelope({ senderId: '' }), NOW)).toEqual({
      ok: false,
      reason: 'bad_sender_id',
    });
  });

  it('rejects an over-long id', () => {
    expect(validateEnvelope(makeEnvelope({ messageId: 'a'.repeat(65) }), NOW)).toEqual({
      ok: false,
      reason: 'bad_message_id',
    });
  });

  it('rejects an expired envelope', () => {
    const envelope = makeEnvelope();
    expect(validateEnvelope(envelope, envelope.expiresAtMs + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('accepts an envelope one millisecond before expiry', () => {
    const envelope = makeEnvelope();
    expect(validateEnvelope(envelope, envelope.expiresAtMs - 1).ok).toBe(true);
  });

  it('rejects an envelope claiming a ttl beyond the maximum', () => {
    const envelope = makeEnvelope({
      createdAtMs: NOW,
      expiresAtMs: NOW + 25 * 60 * 60 * 1000,
    });
    expect(validateEnvelope(envelope, NOW)).toEqual({ ok: false, reason: 'ttl_too_long' });
  });

  it('rejects an envelope created far in the future', () => {
    // A device with a fast clock must not be able to outlive MAX_TTL_MS.
    const envelope = makeEnvelope({
      createdAtMs: NOW + 60 * 60 * 1000,
      expiresAtMs: NOW + 61 * 60 * 1000,
    });
    expect(validateEnvelope(envelope, NOW)).toEqual({
      ok: false,
      reason: 'created_in_future',
    });
  });

  it('tolerates modest clock skew', () => {
    const envelope = makeEnvelope({
      createdAtMs: NOW + 60_000,
      expiresAtMs: NOW + 60_000 + 60 * 60 * 1000,
    });
    expect(validateEnvelope(envelope, NOW).ok).toBe(true);
  });

  it('rejects expiry at or before creation', () => {
    expect(
      validateEnvelope(makeEnvelope({ createdAtMs: NOW, expiresAtMs: NOW }), NOW),
    ).toEqual({ ok: false, reason: 'bad_expires_at' });
  });

  it('rejects a hop count above the declared limit', () => {
    expect(validateEnvelope(makeEnvelope({ hopCount: 3, maxHops: 2 }), NOW)).toEqual({
      ok: false,
      reason: 'hop_count_exceeds_max',
    });
  });

  it('rejects a maxHops beyond the protocol ceiling', () => {
    expect(validateEnvelope(makeEnvelope({ maxHops: 99 }), NOW)).toEqual({
      ok: false,
      reason: 'bad_max_hops',
    });
  });

  it('rejects a negative or fractional timestamp', () => {
    expect(validateEnvelope(makeEnvelope({ createdAtMs: -1 }), NOW).ok).toBe(false);
    expect(validateEnvelope(makeEnvelope({ hopCount: 1.5 }), NOW)).toEqual({
      ok: false,
      reason: 'bad_hop_count',
    });
  });

  it('rejects an oversized payload', () => {
    const envelope = makeEnvelope({
      payload: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) },
    });
    expect(validateEnvelope(envelope, NOW)).toEqual({
      ok: false,
      reason: 'payload_too_large',
    });
  });

  it('rejects an array payload', () => {
    expect(validateEnvelope(makeEnvelope({ payload: [] as never }), NOW)).toEqual({
      ok: false,
      reason: 'bad_payload',
    });
  });

  it('rejects a malformed signature field', () => {
    expect(validateEnvelope(makeEnvelope({ signature: 'nope' }), NOW)).toEqual({
      ok: false,
      reason: 'bad_signature_field',
    });
  });
});

describe('wire encoding', () => {
  it('round-trips through encode and decode', () => {
    const envelope = makeEnvelope();
    const decoded = decodeEnvelope(encodeEnvelope(envelope), secret, NOW);
    expect(decoded).toEqual({ ok: true, envelope });
  });

  it('rejects a payload that is not a CT1 frame', () => {
    expect(decodeEnvelope(utf8Encode('hello world'), secret, NOW)).toEqual({
      ok: false,
      reason: 'not_ct1',
    });
  });

  it('rejects malformed json behind the CT1 prefix', () => {
    expect(decodeEnvelope(utf8Encode('CT1:{not json'), secret, NOW)).toEqual({
      ok: false,
      reason: 'malformed_json',
    });
  });

  it('rejects invalid utf-8', () => {
    // 0xff never appears in well-formed UTF-8.
    expect(decodeEnvelope(new Uint8Array([0xff, 0xfe, 0xfd]), secret, NOW)).toEqual({
      ok: false,
      reason: 'malformed_json',
    });
  });

  it('refuses to encode an envelope over the size limit', () => {
    const envelope = makeEnvelope({ payload: { blob: 'x'.repeat(4000) } });
    expect(() => encodeEnvelope(envelope)).toThrow(/over the 4096 byte limit/);
  });
});

describe('forwardedCopy', () => {
  it('increments the hop count', () => {
    const envelope = makeEnvelope({ hopCount: 0, maxHops: 2 });
    expect(forwardedCopy(envelope)?.hopCount).toBe(1);
  });

  it('returns null at the hop limit so flooding is bounded', () => {
    expect(forwardedCopy(makeEnvelope({ hopCount: 2, maxHops: 2 }))).toBeNull();
  });

  it('leaves the original untouched', () => {
    const envelope = makeEnvelope({ hopCount: 0, maxHops: 2 });
    forwardedCopy(envelope);
    expect(envelope.hopCount).toBe(0);
  });
});
