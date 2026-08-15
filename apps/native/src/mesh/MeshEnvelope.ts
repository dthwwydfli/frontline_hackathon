/**
 * The wire envelope every nearby message travels in.
 *
 * Rules that hold everywhere in the app:
 *  - the envelope carries `roomId`, never the room secret
 *  - `signature` is an HMAC proving the sender joined the room. It is NOT
 *    identity verification and must never be presented to a user as such
 *  - nothing reaches the thread reducer or the UI until it validates
 */

export const ENVELOPE_VERSION = 1 as const;

export const MESH_EVENT_TYPES = [
  'thread.created',
  'thread.reply',
  'offer.accepted',
  'thread.resolved',
  'presence',
] as const;

export type MeshEventType = (typeof MESH_EVENT_TYPES)[number];

export type MeshEnvelope = {
  version: 1;
  messageId: string;
  roomId: string;
  senderId: string;
  createdAtMs: number;
  expiresAtMs: number;
  hopCount: number;
  maxHops: number;
  type: MeshEventType;
  payload: Record<string, unknown>;
  signature: string;
};

/** Envelope without the field the signature is computed over. */
export type UnsignedMeshEnvelope = Omit<MeshEnvelope, 'signature'>;

export type PeerPresence = {
  peerId: string;
  displayName: string | null;
  /** Last time this peer was seen, in device-local epoch milliseconds. */
  lastSeenAtMs: number;
  rssi: number | null;
};

export type MeshStatus = {
  /** Transport has been started and the radio is usable. */
  running: boolean;
  /** Adapter state as reported by the OS. */
  bluetoothState: 'unknown' | 'unsupported' | 'unauthorized' | 'off' | 'on';
  /** True only when this device is actually advertising, not merely scanning. */
  advertising: boolean;
  scanning: boolean;
  roomId: string | null;
  localPeerId: string | null;
  connectedPeerCount: number;
};

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on a serialised envelope. Reassembly refuses anything larger,
 * so a peer cannot make us buffer unbounded memory by declaring a huge size.
 */
export const MAX_ENVELOPE_BYTES = 4096;

/** Ceiling on the JSON payload object specifically. */
export const MAX_PAYLOAD_BYTES = 2048;

export const MAX_ID_LENGTH = 64;

/** Default hop limit. Raise only after a physical traffic/battery test. */
export const DEFAULT_MAX_HOPS = 2;

/** Upper bound on maxHops any envelope may claim. */
export const HOP_LIMIT = 8;

/** How far in the future an envelope may claim to have been created. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Longest life an envelope may declare, measured from createdAtMs. */
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationFailure =
  | 'not_an_object'
  | 'bad_version'
  | 'bad_message_id'
  | 'bad_room_id'
  | 'bad_sender_id'
  | 'bad_created_at'
  | 'bad_expires_at'
  | 'ttl_too_long'
  | 'expired'
  | 'created_in_future'
  | 'bad_hop_count'
  | 'bad_max_hops'
  | 'hop_count_exceeds_max'
  | 'bad_type'
  | 'bad_payload'
  | 'payload_too_large'
  | 'bad_signature_field';

export type ValidationResult =
  | { ok: true; envelope: MeshEnvelope }
  | { ok: false; reason: ValidationFailure };

function isSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    // Printable ASCII without separators the canonical form relies on.
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Structural and temporal validation. This does NOT check the signature —
 * `verifyEnvelope` in EnvelopeCodec does that, because only it knows the room
 * secret. Both must pass before an envelope is persisted.
 *
 * @param nowMs injected so tests and replay logic are deterministic
 */
export function validateEnvelope(value: unknown, nowMs: number): ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'not_an_object' };
  }

  const e = value as Record<string, unknown>;

  if (e.version !== ENVELOPE_VERSION) return { ok: false, reason: 'bad_version' };
  if (!isSafeId(e.messageId)) return { ok: false, reason: 'bad_message_id' };
  if (!isSafeId(e.roomId)) return { ok: false, reason: 'bad_room_id' };
  if (!isSafeId(e.senderId)) return { ok: false, reason: 'bad_sender_id' };

  if (!isFiniteInteger(e.createdAtMs)) return { ok: false, reason: 'bad_created_at' };
  if (!isFiniteInteger(e.expiresAtMs)) return { ok: false, reason: 'bad_expires_at' };

  if (e.expiresAtMs <= e.createdAtMs) return { ok: false, reason: 'bad_expires_at' };
  if (e.expiresAtMs - e.createdAtMs > MAX_TTL_MS) return { ok: false, reason: 'ttl_too_long' };

  // A peer with a fast clock should not be able to inject an envelope that
  // outlives MAX_TTL_MS by claiming it was created far in the future.
  if (e.createdAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
    return { ok: false, reason: 'created_in_future' };
  }
  if (e.expiresAtMs <= nowMs) return { ok: false, reason: 'expired' };

  if (!isFiniteInteger(e.hopCount)) return { ok: false, reason: 'bad_hop_count' };
  if (!isFiniteInteger(e.maxHops) || e.maxHops < 1 || e.maxHops > HOP_LIMIT) {
    return { ok: false, reason: 'bad_max_hops' };
  }
  if (e.hopCount > e.maxHops) return { ok: false, reason: 'hop_count_exceeds_max' };

  if (typeof e.type !== 'string' || !MESH_EVENT_TYPES.includes(e.type as MeshEventType)) {
    return { ok: false, reason: 'bad_type' };
  }

  if (typeof e.payload !== 'object' || e.payload === null || Array.isArray(e.payload)) {
    return { ok: false, reason: 'bad_payload' };
  }

  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(e.payload);
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (payloadJson === undefined) return { ok: false, reason: 'bad_payload' };
  if (payloadJson.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'payload_too_large' };
  }

  if (typeof e.signature !== 'string' || !/^[0-9a-f]{64}$/.test(e.signature)) {
    return { ok: false, reason: 'bad_signature_field' };
  }

  return { ok: true, envelope: e as MeshEnvelope };
}

// ---------------------------------------------------------------------------
// Canonical serialisation
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted at every depth, no incidental
 * whitespace. Two devices must produce byte-identical output for the same
 * logical envelope or their HMACs will not agree.
 *
 * Rejects values JSON cannot round-trip losslessly (undefined, functions,
 * non-finite numbers) rather than silently dropping them, because a dropped
 * field would change the bytes the signature covers.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalJson: non-finite number');
    }
    return JSON.stringify(value);
  }

  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) {
        throw new Error(`canonicalJson: undefined value at key "${key}"`);
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new Error(`canonicalJson: unsupported type ${t}`);
}

/**
 * The exact byte string the signature covers. Field list is explicit rather
 * than "everything except signature" so that adding a field to the type is a
 * deliberate, versioned protocol change instead of a silent MAC break.
 */
export function canonicalSigningString(envelope: UnsignedMeshEnvelope): string {
  return canonicalJson({
    version: envelope.version,
    messageId: envelope.messageId,
    roomId: envelope.roomId,
    senderId: envelope.senderId,
    createdAtMs: envelope.createdAtMs,
    expiresAtMs: envelope.expiresAtMs,
    maxHops: envelope.maxHops,
    type: envelope.type,
    payload: envelope.payload,
  });
}
