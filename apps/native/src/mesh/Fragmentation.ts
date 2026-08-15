/**
 * BLE fragmentation and reassembly.
 *
 * A GATT characteristic write carries ~20 bytes at the default MTU and ~180 at
 * a negotiated one. Envelopes are larger, so every message is split into frames
 * and rebuilt on the far side.
 *
 * Frame layout (binary, big-endian), 16-byte header + body:
 *
 *   offset  size  field
 *   0       1     protocol version (FRAME_VERSION)
 *   1       4     messageKey  — first 4 bytes of the message id hash
 *   5       2     fragmentIndex
 *   7       2     fragmentCount
 *   9       2     declared total message size in bytes
 *   11      4     CRC-32 of the complete message
 *   15      1     reserved (must be 0)
 *   16      ..    fragment body
 *
 * The assembler is deliberately hostile to malformed input: a peer on an open
 * radio can send anything, and a reassembly buffer is the obvious place to try
 * to exhaust our memory.
 */

import { crc32 } from '../crypto/bytes';
import { sha256 } from '../crypto/sha256';
import { utf8Encode } from '../crypto/bytes';
import { MAX_ENVELOPE_BYTES } from './MeshEnvelope';

export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 16;

/**
 * Smallest MTU we will fragment for. Below this the header dominates and the
 * message would need more fragments than the count field can express.
 */
export const MIN_FRAME_BYTES = FRAME_HEADER_BYTES + 4;

/**
 * Derived, not chosen: a MAX_ENVELOPE_BYTES message at MIN_FRAME_BYTES carries
 * 4 body bytes per frame, so 1024 frames is the worst legal case. Any smaller
 * cap would make some legal envelope unsendable on a link that never
 * negotiated its MTU up.
 *
 * Memory is bounded by MAX_ENVELOPE_BYTES per assembly regardless of count.
 * A 1024-frame message is slow enough on a 20-byte link that callers should
 * keep envelopes small; nothing here depends on them doing so.
 */
export const MAX_FRAGMENTS = 1024;

/** Drop a partially assembled message that has stalled for this long. */
export const ASSEMBLY_TIMEOUT_MS = 15_000;

/** Cap on concurrently assembling messages, across all peers. */
export const MAX_ASSEMBLIES = 64;

export type Frame = Uint8Array;

function messageKeyFor(messageId: string): number {
  const digest = sha256(utf8Encode(messageId));
  return (
    ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
  );
}

/**
 * Split a complete message into frames sized for `maxFrameBytes` (the usable
 * ATT payload for this link, header included).
 */
export function fragment(
  message: Uint8Array,
  messageId: string,
  maxFrameBytes: number,
): Frame[] {
  if (maxFrameBytes < MIN_FRAME_BYTES) {
    throw new Error(`maxFrameBytes must be at least ${MIN_FRAME_BYTES}`);
  }
  if (message.length === 0) {
    throw new Error('cannot fragment an empty message');
  }
  if (message.length > MAX_ENVELOPE_BYTES) {
    throw new Error(
      `message is ${message.length} bytes, over the ${MAX_ENVELOPE_BYTES} byte limit`,
    );
  }

  const bodyBytes = maxFrameBytes - FRAME_HEADER_BYTES;
  const count = Math.ceil(message.length / bodyBytes);
  if (count > MAX_FRAGMENTS) {
    throw new Error(`message needs ${count} fragments, over the ${MAX_FRAGMENTS} limit`);
  }

  const key = messageKeyFor(messageId);
  const checksum = crc32(message);
  const frames: Frame[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * bodyBytes;
    const body = message.subarray(start, Math.min(start + bodyBytes, message.length));

    const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
    const view = new DataView(frame.buffer);

    frame[0] = FRAME_VERSION;
    view.setUint32(1, key, false);
    view.setUint16(5, i, false);
    view.setUint16(7, count, false);
    view.setUint16(9, message.length, false);
    view.setUint32(11, checksum, false);
    frame[15] = 0;
    frame.set(body, FRAME_HEADER_BYTES);

    frames.push(frame);
  }

  return frames;
}

type ParsedFrame = {
  key: number;
  index: number;
  count: number;
  totalSize: number;
  checksum: number;
  body: Uint8Array;
};

export type FrameRejection =
  | 'too_short'
  | 'bad_version'
  | 'reserved_set'
  | 'bad_count'
  | 'index_out_of_range'
  | 'declared_size_too_large'
  | 'declared_size_inconsistent'
  | 'conflicting_fragment_set'
  | 'duplicate_fragment'
  | 'checksum_mismatch'
  | 'assembly_limit_reached';

function parseFrame(frame: Uint8Array): ParsedFrame | FrameRejection {
  if (frame.length <= FRAME_HEADER_BYTES) return 'too_short';
  if (frame[0] !== FRAME_VERSION) return 'bad_version';
  if (frame[15] !== 0) return 'reserved_set';

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const key = view.getUint32(1, false);
  const index = view.getUint16(5, false);
  const count = view.getUint16(7, false);
  const totalSize = view.getUint16(9, false);
  const checksum = view.getUint32(11, false);

  if (count === 0 || count > MAX_FRAGMENTS) return 'bad_count';
  if (index >= count) return 'index_out_of_range';
  if (totalSize === 0 || totalSize > MAX_ENVELOPE_BYTES) return 'declared_size_too_large';

  const body = frame.subarray(FRAME_HEADER_BYTES);

  // Every fragment but the last must be full-width, and the declared total has
  // to be reachable with `count` fragments of this width. This is what stops a
  // peer claiming 512 fragments for a 20-byte message.
  if (index < count - 1) {
    if (body.length * count < totalSize) return 'declared_size_inconsistent';
  }
  if (body.length > totalSize) return 'declared_size_inconsistent';

  return { key, index, count, totalSize, checksum, body };
}

type Assembly = {
  count: number;
  totalSize: number;
  checksum: number;
  bodies: (Uint8Array | undefined)[];
  received: number;
  bytesHeld: number;
  startedAtMs: number;
};

export type AssembleResult =
  | { status: 'incomplete' }
  | { status: 'complete'; message: Uint8Array }
  | { status: 'rejected'; reason: FrameRejection };

/**
 * Reassembles frames arriving from one peer. One instance per connected peer,
 * so a peer cannot corrupt another peer's in-flight message by reusing a key.
 */
export class FragmentAssembler {
  private readonly assemblies = new Map<number, Assembly>();

  constructor(
    private readonly timeoutMs: number = ASSEMBLY_TIMEOUT_MS,
    private readonly maxAssemblies: number = MAX_ASSEMBLIES,
  ) {}

  accept(frame: Uint8Array, nowMs: number): AssembleResult {
    this.evictExpired(nowMs);

    const parsed = parseFrame(frame);
    if (typeof parsed === 'string') {
      return { status: 'rejected', reason: parsed };
    }

    let assembly = this.assemblies.get(parsed.key);

    if (assembly === undefined) {
      if (this.assemblies.size >= this.maxAssemblies) {
        return { status: 'rejected', reason: 'assembly_limit_reached' };
      }
      assembly = {
        count: parsed.count,
        totalSize: parsed.totalSize,
        checksum: parsed.checksum,
        bodies: new Array<Uint8Array | undefined>(parsed.count),
        received: 0,
        bytesHeld: 0,
        startedAtMs: nowMs,
      };
      this.assemblies.set(parsed.key, assembly);
    }

    // A frame whose header disagrees with the set already in flight means
    // either a key collision or a peer mixing two messages. Drop the whole
    // set rather than trying to guess which half is real.
    if (
      assembly.count !== parsed.count ||
      assembly.totalSize !== parsed.totalSize ||
      assembly.checksum !== parsed.checksum
    ) {
      this.assemblies.delete(parsed.key);
      return { status: 'rejected', reason: 'conflicting_fragment_set' };
    }

    if (assembly.bodies[parsed.index] !== undefined) {
      // Retransmits are normal on a lossy radio. Ignore, do not reset.
      return { status: 'incomplete' };
    }

    if (assembly.bytesHeld + parsed.body.length > assembly.totalSize) {
      this.assemblies.delete(parsed.key);
      return { status: 'rejected', reason: 'declared_size_inconsistent' };
    }

    assembly.bodies[parsed.index] = parsed.body;
    assembly.received += 1;
    assembly.bytesHeld += parsed.body.length;

    if (assembly.received < assembly.count) {
      return { status: 'incomplete' };
    }

    this.assemblies.delete(parsed.key);

    if (assembly.bytesHeld !== assembly.totalSize) {
      return { status: 'rejected', reason: 'declared_size_inconsistent' };
    }

    const message = new Uint8Array(assembly.totalSize);
    let offset = 0;
    for (const body of assembly.bodies) {
      // Every slot is filled: received === count and each write was guarded.
      message.set(body!, offset);
      offset += body!.length;
    }

    if (crc32(message) !== assembly.checksum) {
      return { status: 'rejected', reason: 'checksum_mismatch' };
    }

    return { status: 'complete', message };
  }

  /** Number of partially assembled messages currently held. */
  get pendingCount(): number {
    return this.assemblies.size;
  }

  evictExpired(nowMs: number): void {
    for (const [key, assembly] of this.assemblies) {
      if (nowMs - assembly.startedAtMs >= this.timeoutMs) {
        this.assemblies.delete(key);
      }
    }
  }

  reset(): void {
    this.assemblies.clear();
  }
}
