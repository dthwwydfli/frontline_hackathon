/**
 * UUIDs that work off a plain HTTP origin.
 *
 * `crypto.randomUUID` is restricted to secure contexts — HTTPS or localhost.
 * This app is served over plain HTTP from a laptop on a local network, which
 * is NOT a secure context, so calling it there throws
 * "crypto.randomUUID is not a function" and takes the whole page down.
 *
 * `crypto.getRandomValues` has no such restriction and is the same CSPRNG, so
 * we format a v4 UUID from it ourselves and only use the built-in when it is
 * actually present.
 */

const HEX: string[] = Array.from({ length: 256 }, (_, byte) =>
  byte.toString(16).padStart(2, "0"),
);

export function randomUUID(): string {
  const source = globalThis.crypto;

  if (typeof source?.randomUUID === "function") {
    return source.randomUUID();
  }

  if (typeof source?.getRandomValues !== "function") {
    throw new Error(
      "No secure random source available: crypto.getRandomValues is missing.",
    );
  }

  const bytes = source.getRandomValues(new Uint8Array(16));

  // Version 4, variant 1, per RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX[byte]!);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
