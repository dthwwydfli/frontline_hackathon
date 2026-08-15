/**
 * Signing, verification and wire encoding for MeshEnvelope.
 *
 * The room secret proves the sender joined the room. It does NOT prove who the
 * sender is: every member holds the same secret, so any member can mint an
 * envelope bearing any senderId. Surface this to users as "room-authenticated,
 * not sender-authenticated" and never as verified identity.
 */

import { hmacSha256, timingSafeEqual } from '../crypto/sha256';
import { fromHex, toHex, utf8Decode, utf8Encode } from '../crypto/bytes';
import {
  DEFAULT_MAX_HOPS,
  ENVELOPE_VERSION,
  MAX_ENVELOPE_BYTES,
  canonicalSigningString,
  validateEnvelope,
  type MeshEnvelope,
  type MeshEventType,
  type UnsignedMeshEnvelope,
  type ValidationFailure,
} from './MeshEnvelope';

/** Marks a payload as a Common Thread envelope on a shared radio. */
export const WIRE_PREFIX = 'CT1:';

export type RoomSecret = {
  roomId: string;
  /** Raw secret bytes. Never place these in an envelope or a log line. */
  key: Uint8Array;
};

export function signatureFor(unsigned: UnsignedMeshEnvelope, secret: RoomSecret): string {
  const message = utf8Encode(canonicalSigningString(unsigned));
  return toHex(hmacSha256(secret.key, message));
}

export function signEnvelope(
  unsigned: UnsignedMeshEnvelope,
  secret: RoomSecret,
): MeshEnvelope {
  return { ...unsigned, signature: signatureFor(unsigned, secret) };
}

export type CreateEnvelopeInput = {
  messageId: string;
  senderId: string;
  type: MeshEventType;
  payload: Record<string, unknown>;
  createdAtMs: number;
  ttlMs: number;
  maxHops?: number;
};

export function createEnvelope(
  input: CreateEnvelopeInput,
  secret: RoomSecret,
): MeshEnvelope {
  const unsigned: UnsignedMeshEnvelope = {
    version: ENVELOPE_VERSION,
    messageId: input.messageId,
    roomId: secret.roomId,
    senderId: input.senderId,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.createdAtMs + input.ttlMs,
    hopCount: 0,
    maxHops: input.maxHops ?? DEFAULT_MAX_HOPS,
    type: input.type,
    payload: input.payload,
  };
  return signEnvelope(unsigned, secret);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerifyFailure = ValidationFailure | 'wrong_room' | 'bad_signature' | 'not_ct1' | 'malformed_json' | 'too_large';

export type VerifyResult =
  | { ok: true; envelope: MeshEnvelope }
  | { ok: false; reason: VerifyFailure };

/**
 * Full acceptance check: structure, time bounds, room match, then MAC.
 * Order matters — cheap structural rejects run before the hash so a flood of
 * junk frames costs less.
 *
 * `hopCount` is deliberately outside the signed fields: relays increment it,
 * and a relay does not re-sign. That means hopCount is unauthenticated and a
 * malicious relay can reset it to extend reach. Bounded by maxHops, which IS
 * signed, so the blast radius is capped at the originator's declared limit.
 */
export function verifyEnvelope(
  value: unknown,
  secret: RoomSecret,
  nowMs: number,
): VerifyResult {
  const validation = validateEnvelope(value, nowMs);
  if (!validation.ok) return validation;

  const envelope = validation.envelope;

  if (envelope.roomId !== secret.roomId) {
    return { ok: false, reason: 'wrong_room' };
  }

  const expected = fromHex(signatureFor(envelope, secret));
  const actual = fromHex(envelope.signature);
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true, envelope };
}

// ---------------------------------------------------------------------------
// Wire encoding
// ---------------------------------------------------------------------------

export function encodeEnvelope(envelope: MeshEnvelope): Uint8Array {
  const bytes = utf8Encode(WIRE_PREFIX + JSON.stringify(envelope));
  if (bytes.length > MAX_ENVELOPE_BYTES) {
    throw new Error(
      `envelope is ${bytes.length} bytes, over the ${MAX_ENVELOPE_BYTES} byte limit`,
    );
  }
  return bytes;
}

/**
 * Decode a reassembled message. Returns a typed failure instead of throwing:
 * a peer sending garbage is expected traffic on an open radio, not an
 * exceptional condition.
 */
export function decodeEnvelope(
  bytes: Uint8Array,
  secret: RoomSecret,
  nowMs: number,
): VerifyResult {
  if (bytes.length > MAX_ENVELOPE_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }

  if (!text.startsWith(WIRE_PREFIX)) {
    return { ok: false, reason: 'not_ct1' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(WIRE_PREFIX.length));
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }

  return verifyEnvelope(parsed, secret, nowMs);
}

/**
 * Produce the copy of an envelope to rebroadcast. Signature is carried
 * unchanged because hopCount is not covered by it.
 *
 * Returns null when the envelope has reached its hop limit.
 */
export function forwardedCopy(envelope: MeshEnvelope): MeshEnvelope | null {
  if (envelope.hopCount >= envelope.maxHops) return null;
  return { ...envelope, hopCount: envelope.hopCount + 1 };
}
