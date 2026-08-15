/**
 * Join link encoding and room codes.
 *
 * Deliberately free of expo imports so the format is testable in plain Node.
 * The secret travels in this payload out of band, before the radio-only
 * session begins, and never appears in an envelope afterwards.
 */

import { toHex, utf8Encode } from '../crypto/bytes';
import { sha256 } from '../crypto/sha256';

/** Room and device ids must satisfy the envelope's id character rules. */
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** 16 to 64 bytes of hex. Anything shorter is not a high-entropy secret. */
const SECRET_PATTERN = /^[0-9a-fA-F]{32,128}$/;

export function isValidRoomId(roomId: string): boolean {
  return ID_PATTERN.test(roomId);
}

export function isValidRoomSecretHex(secretHex: string): boolean {
  return SECRET_PATTERN.test(secretHex);
}

export type JoinPayload = {
  roomId: string;
  secretHex: string;
  roomName?: string;
};

/** Encoded into the pre-event QR or deep link. */
export function encodeJoinPayload(payload: JoinPayload): string {
  const params = new URLSearchParams({
    r: payload.roomId,
    k: payload.secretHex,
  });
  if (payload.roomName !== undefined) params.set('n', payload.roomName);
  return `commonthread://join?${params.toString()}`;
}

export function decodeJoinPayload(uri: string): JoinPayload | null {
  if (!uri.startsWith('commonthread://join')) return null;

  const marker = uri.indexOf('?');
  if (marker === -1) return null;

  const params = new URLSearchParams(uri.slice(marker + 1));
  const roomId = params.get('r');
  const secretHex = params.get('k');

  if (roomId === null || secretHex === null) return null;
  if (!isValidRoomId(roomId)) return null;
  if (!isValidRoomSecretHex(secretHex)) return null;

  const roomName = params.get('n');
  return {
    // Lower-cased so two devices reading the same link derive one key.
    roomId,
    secretHex: secretHex.toLowerCase(),
    ...(roomName !== null ? { roomName } : {}),
  };
}

/**
 * Short human-typable code for when a QR will not scan. Derived from the room
 * id, NOT the secret: a code short enough to read aloud is short enough to
 * guess, so it identifies a room and never authorises joining one.
 */
export function roomCodeFor(roomId: string): string {
  return toHex(sha256(utf8Encode(roomId))).slice(0, 6).toUpperCase();
}
