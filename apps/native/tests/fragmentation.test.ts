import { describe, expect, it } from 'vitest';

import { utf8Encode } from '../src/crypto/bytes';
import {
  ASSEMBLY_TIMEOUT_MS,
  FRAME_HEADER_BYTES,
  FragmentAssembler,
  MIN_FRAME_BYTES,
  fragment,
} from '../src/mesh/Fragmentation';

const NOW = 1_700_000_000_000;

/** Default pre-negotiation ATT payload, the worst case we must survive. */
const TINY_MTU = 20;

function messageOf(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 251;
  return bytes;
}

describe('fragment', () => {
  it('splits a message into frames that fit the mtu', () => {
    const frames = fragment(messageOf(500), 'msg-1', TINY_MTU);
    for (const frame of frames) {
      expect(frame.length).toBeLessThanOrEqual(TINY_MTU);
    }
  });

  it('produces a single frame when the message already fits', () => {
    const frames = fragment(utf8Encode('hi'), 'msg-1', 64);
    expect(frames).toHaveLength(1);
  });

  it('rejects an mtu too small to carry a header plus body', () => {
    expect(() => fragment(messageOf(10), 'msg-1', MIN_FRAME_BYTES - 1)).toThrow(
      /at least/,
    );
  });

  it('rejects an empty message', () => {
    expect(() => fragment(new Uint8Array(0), 'msg-1', 64)).toThrow(/empty/);
  });

  it('rejects a message over the envelope size limit', () => {
    expect(() => fragment(messageOf(5000), 'msg-1', 64)).toThrow(/over the 4096/);
  });

  it('gives every fragment of a message the same header metadata', () => {
    const frames = fragment(messageOf(200), 'msg-1', TINY_MTU);
    const view = (f: Uint8Array) => new DataView(f.buffer, f.byteOffset, f.byteLength);

    const count = view(frames[0]).getUint16(7, false);
    const size = view(frames[0]).getUint16(9, false);
    const crc = view(frames[0]).getUint32(11, false);

    for (const frame of frames) {
      expect(view(frame).getUint16(7, false)).toBe(count);
      expect(view(frame).getUint16(9, false)).toBe(size);
      expect(view(frame).getUint32(11, false)).toBe(crc);
    }
  });

  it('numbers fragments sequentially from zero', () => {
    const frames = fragment(messageOf(200), 'msg-1', TINY_MTU);
    frames.forEach((frame, index) => {
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      expect(view.getUint16(5, false)).toBe(index);
    });
  });
});

describe('reassembly', () => {
  it('rebuilds a message from in-order fragments', () => {
    const message = messageOf(500);
    const frames = fragment(message, 'msg-1', TINY_MTU);
    const assembler = new FragmentAssembler();

    let result;
    for (const frame of frames) {
      result = assembler.accept(frame, NOW);
    }

    expect(result).toEqual({ status: 'complete', message });
  });

  it('rebuilds a message from out-of-order fragments', () => {
    const message = messageOf(500);
    const frames = fragment(message, 'msg-1', TINY_MTU);
    const assembler = new FragmentAssembler();

    let result;
    for (const frame of [...frames].reverse()) {
      result = assembler.accept(frame, NOW);
    }

    expect(result).toEqual({ status: 'complete', message });
  });

  it('reports incomplete until the final fragment arrives', () => {
    const frames = fragment(messageOf(500), 'msg-1', TINY_MTU);
    const assembler = new FragmentAssembler();

    for (const frame of frames.slice(0, -1)) {
      expect(assembler.accept(frame, NOW)).toEqual({ status: 'incomplete' });
    }
    expect(assembler.accept(frames[frames.length - 1], NOW).status).toBe('complete');
  });

  it('ignores a retransmitted fragment without resetting the set', () => {
    const message = messageOf(500);
    const frames = fragment(message, 'msg-1', TINY_MTU);
    const assembler = new FragmentAssembler();

    assembler.accept(frames[0], NOW);
    // A lossy radio retransmits constantly; this must not corrupt the set.
    expect(assembler.accept(frames[0], NOW)).toEqual({ status: 'incomplete' });

    let result;
    for (const frame of frames.slice(1)) {
      result = assembler.accept(frame, NOW);
    }
    expect(result).toEqual({ status: 'complete', message });
  });

  it('keeps two peers-worth of messages apart when assemblers are separate', () => {
    const a = messageOf(300);
    const b = messageOf(400);
    const framesA = fragment(a, 'msg-a', TINY_MTU);
    const framesB = fragment(b, 'msg-b', TINY_MTU);

    const assemblerA = new FragmentAssembler();
    const assemblerB = new FragmentAssembler();

    // Interleaved arrival, the normal case with two active links.
    const maxLength = Math.max(framesA.length, framesB.length);
    let resultA;
    let resultB;
    for (let i = 0; i < maxLength; i++) {
      if (i < framesA.length) resultA = assemblerA.accept(framesA[i], NOW);
      if (i < framesB.length) resultB = assemblerB.accept(framesB[i], NOW);
    }

    expect(resultA).toEqual({ status: 'complete', message: a });
    expect(resultB).toEqual({ status: 'complete', message: b });
  });

  it('interleaves two distinct messages in one assembler', () => {
    const a = messageOf(300);
    const b = messageOf(400);
    const framesA = fragment(a, 'msg-a', TINY_MTU);
    const framesB = fragment(b, 'msg-b', TINY_MTU);
    const assembler = new FragmentAssembler();

    const maxLength = Math.max(framesA.length, framesB.length);
    const completed: Uint8Array[] = [];
    for (let i = 0; i < maxLength; i++) {
      for (const frames of [framesA, framesB]) {
        if (i >= frames.length) continue;
        const result = assembler.accept(frames[i], NOW);
        if (result.status === 'complete') completed.push(result.message);
      }
    }

    expect(completed).toHaveLength(2);
    expect(completed).toContainEqual(a);
    expect(completed).toContainEqual(b);
  });
});

describe('reassembly rejects malformed input', () => {
  const assembler = () => new FragmentAssembler();

  it('rejects a frame shorter than the header', () => {
    expect(assembler().accept(new Uint8Array(FRAME_HEADER_BYTES), NOW)).toEqual({
      status: 'rejected',
      reason: 'too_short',
    });
  });

  it('rejects an unknown frame version', () => {
    const frame = fragment(messageOf(50), 'msg-1', 64)[0];
    frame[0] = 9;
    expect(assembler().accept(frame, NOW)).toEqual({
      status: 'rejected',
      reason: 'bad_version',
    });
  });

  it('rejects a frame with the reserved byte set', () => {
    const frame = fragment(messageOf(50), 'msg-1', 64)[0];
    frame[15] = 1;
    expect(assembler().accept(frame, NOW)).toEqual({
      status: 'rejected',
      reason: 'reserved_set',
    });
  });

  it('rejects a fragment index at or beyond the declared count', () => {
    const frame = fragment(messageOf(50), 'msg-1', 64)[0];
    new DataView(frame.buffer).setUint16(5, 5, false);
    new DataView(frame.buffer).setUint16(7, 5, false);
    expect(assembler().accept(frame, NOW)).toEqual({
      status: 'rejected',
      reason: 'index_out_of_range',
    });
  });

  it('rejects a declared size beyond the envelope limit', () => {
    const frame = fragment(messageOf(50), 'msg-1', 64)[0];
    new DataView(frame.buffer).setUint16(9, 60000, false);
    expect(assembler().accept(frame, NOW)).toEqual({
      status: 'rejected',
      reason: 'declared_size_too_large',
    });
  });

  it('rejects a fragment count that cannot reach the declared size', () => {
    // Claim a 4000-byte message but send it as 2 tiny fragments.
    const frame = fragment(messageOf(50), 'msg-1', 64)[0];
    const view = new DataView(frame.buffer);
    view.setUint16(5, 0, false);
    view.setUint16(7, 2, false);
    view.setUint16(9, 4000, false);
    expect(assembler().accept(frame, NOW)).toEqual({
      status: 'rejected',
      reason: 'declared_size_inconsistent',
    });
  });

  it('drops the whole set when a later frame disagrees with the first', () => {
    const frames = fragment(messageOf(300), 'msg-1', TINY_MTU);
    const a = assembler();
    a.accept(frames[0], NOW);

    const conflicting = new Uint8Array(frames[1]);
    new DataView(conflicting.buffer).setUint32(11, 0xdeadbeef, false);

    expect(a.accept(conflicting, NOW)).toEqual({
      status: 'rejected',
      reason: 'conflicting_fragment_set',
    });
    expect(a.pendingCount).toBe(0);
  });

  it('rejects a set whose bytes do not match the declared checksum', () => {
    const frames = fragment(messageOf(300), 'msg-1', TINY_MTU);
    const a = assembler();

    // Corrupt one body byte, leaving every header field intact.
    frames[1][FRAME_HEADER_BYTES] ^= 0xff;

    let result;
    for (const frame of frames) result = a.accept(frame, NOW);

    expect(result).toEqual({ status: 'rejected', reason: 'checksum_mismatch' });
  });
});

describe('reassembly resource limits', () => {
  it('drops a stalled partial message after the timeout', () => {
    const frames = fragment(messageOf(300), 'msg-1', TINY_MTU);
    const a = new FragmentAssembler();

    a.accept(frames[0], NOW);
    expect(a.pendingCount).toBe(1);

    a.evictExpired(NOW + ASSEMBLY_TIMEOUT_MS);
    expect(a.pendingCount).toBe(0);
  });

  it('evicts stalled sets when a new frame arrives', () => {
    const stalled = fragment(messageOf(300), 'stalled', TINY_MTU);
    const fresh = fragment(utf8Encode('hello'), 'fresh', 64);
    const a = new FragmentAssembler();

    a.accept(stalled[0], NOW);
    a.accept(fresh[0], NOW + ASSEMBLY_TIMEOUT_MS + 1);

    // The stalled set is gone; only the completed fresh one was consumed.
    expect(a.pendingCount).toBe(0);
  });

  it('refuses to hold more than the concurrent assembly limit', () => {
    const a = new FragmentAssembler(ASSEMBLY_TIMEOUT_MS, 2);

    a.accept(fragment(messageOf(300), 'one', TINY_MTU)[0], NOW);
    a.accept(fragment(messageOf(300), 'two', TINY_MTU)[0], NOW);

    // A peer cannot keep opening new partial messages to exhaust memory.
    expect(a.accept(fragment(messageOf(300), 'three', TINY_MTU)[0], NOW)).toEqual({
      status: 'rejected',
      reason: 'assembly_limit_reached',
    });
  });

  it('frees a slot once a message completes', () => {
    const a = new FragmentAssembler(ASSEMBLY_TIMEOUT_MS, 1);
    const frames = fragment(messageOf(100), 'one', TINY_MTU);

    for (const frame of frames) a.accept(frame, NOW);
    expect(a.pendingCount).toBe(0);

    expect(a.accept(fragment(messageOf(100), 'two', TINY_MTU)[0], NOW).status).toBe(
      'incomplete',
    );
  });
});

describe('fragmentation round-trip across mtu sizes', () => {
  const sizes = [1, 19, 20, 21, 100, 512, 1024, 4096];
  const mtus = [20, 23, 64, 185, 512];

  for (const size of sizes) {
    for (const mtu of mtus) {
      it(`round-trips a ${size}-byte message at a ${mtu}-byte mtu`, () => {
        const message = messageOf(size);
        const frames = fragment(message, `msg-${size}-${mtu}`, mtu);
        const a = new FragmentAssembler();

        let result;
        for (const frame of frames) result = a.accept(frame, NOW);

        expect(result).toEqual({ status: 'complete', message });
      });
    }
  }
});
