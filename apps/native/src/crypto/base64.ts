/**
 * Base64 for the JS <-> native frame bridge.
 *
 * Hand-rolled rather than using `Buffer` (not present in Hermes) or `atob`
 * (byte-lossy on binary input in some RN versions). Frames are a few hundred
 * bytes, so table-driven conversion is not worth optimising further.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(triple >> 18) & 63] +
      ALPHABET[(triple >> 12) & 63] +
      ALPHABET[(triple >> 6) & 63] +
      ALPHABET[triple & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      ALPHABET[(chunk >> 6) & 63] +
      '=';
  }

  return out;
}

export function fromBase64(text: string): Uint8Array {
  let end = text.length;
  while (end > 0 && text[end - 1] === '=') end--;

  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < end; i++) {
    const value = LOOKUP[text.charCodeAt(i)];
    if (value < 0) {
      throw new Error(`invalid base64 character at offset ${i}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return out.subarray(0, outIndex);
}
