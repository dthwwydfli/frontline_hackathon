import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from '../src/crypto/base64';
import { crc32, fromHex, toHex, utf8Encode } from '../src/crypto/bytes';
import { hmacSha256, sha256, timingSafeEqual } from '../src/crypto/sha256';

describe('sha256', () => {
  // FIPS 180-4 / RFC 6234 published vectors. If these drift, two devices stop
  // agreeing on signatures and every envelope is rejected as forged.
  it('matches the published empty-string vector', () => {
    expect(toHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published "abc" vector', () => {
    expect(toHex(sha256(utf8Encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the published 56-byte vector (two-block padding)', () => {
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(toHex(sha256(utf8Encode(input)))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles a message exactly one block long', () => {
    // 64 bytes forces a second padding block, the classic off-by-one in the
    // padded-length calculation.
    const input = new Uint8Array(64).fill(0x61);
    expect(toHex(sha256(input))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    );
  });

  it('handles a message of 55 and 56 bytes across the padding boundary', () => {
    expect(toHex(sha256(new Uint8Array(55).fill(0x61))).length).toBe(64);
    expect(toHex(sha256(new Uint8Array(56).fill(0x61))).length).toBe(64);
    expect(toHex(sha256(new Uint8Array(55).fill(0x61)))).not.toBe(
      toHex(sha256(new Uint8Array(56).fill(0x61))),
    );
  });
});

describe('hmacSha256', () => {
  // RFC 4231 test case 1.
  it('matches RFC 4231 case 1', () => {
    const key = new Uint8Array(20).fill(0x0b);
    const mac = hmacSha256(key, utf8Encode('Hi There'));
    expect(toHex(mac)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  // RFC 4231 test case 2.
  it('matches RFC 4231 case 2', () => {
    const mac = hmacSha256(utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?'));
    expect(toHex(mac)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  // RFC 4231 test case 6: key longer than the block size gets hashed first.
  it('hashes an over-long key down to the block size', () => {
    const key = new Uint8Array(131).fill(0xaa);
    const message = utf8Encode('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(toHex(hmacSha256(key, message))).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    );
  });

  it('produces a different mac for a different key', () => {
    const message = utf8Encode('same message');
    const a = hmacSha256(utf8Encode('key-a'), message);
    const b = hmacSha256(utf8Encode('key-b'), message);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('timingSafeEqual', () => {
  it('accepts identical buffers', () => {
    expect(timingSafeEqual(fromHex('deadbeef'), fromHex('deadbeef'))).toBe(true);
  });

  it('rejects a single flipped bit', () => {
    expect(timingSafeEqual(fromHex('deadbeef'), fromHex('deadbeee'))).toBe(false);
  });

  it('rejects buffers of different lengths', () => {
    expect(timingSafeEqual(fromHex('deadbeef'), fromHex('deadbe'))).toBe(false);
  });
});

describe('hex', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  it('rejects an odd-length string', () => {
    expect(() => fromHex('abc')).toThrow(/even length/);
  });

  it('rejects non-hex characters', () => {
    expect(() => fromHex('zz')).toThrow(/invalid hex/);
  });
});

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('pads correctly at each remainder length', () => {
    expect(toBase64(new Uint8Array([0x66]))).toBe('Zg==');
    expect(toBase64(new Uint8Array([0x66, 0x6f]))).toBe('Zm8=');
    expect(toBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
  });

  it('handles an empty buffer', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('')).toEqual(new Uint8Array(0));
  });

  it('rejects invalid characters', () => {
    expect(() => fromBase64('!!!!')).toThrow(/invalid base64/);
  });
});

describe('crc32', () => {
  it('matches the published "123456789" check value', () => {
    expect(crc32(utf8Encode('123456789'))).toBe(0xcbf43926);
  });

  it('changes when a single byte changes', () => {
    expect(crc32(utf8Encode('hello'))).not.toBe(crc32(utf8Encode('hellp')));
  });
});
