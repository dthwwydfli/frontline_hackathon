/**
 * Local pseudonymous identity and room-secret storage.
 *
 * The room secret is the one value that must never leave the device and never
 * enter an envelope. It lives in the platform keystore (Keychain /
 * EncryptedSharedPreferences), not in SQLite, so a database file lifted off a
 * device does not carry room membership with it.
 *
 * Link and code formats live in JoinPayload.ts, which stays free of native
 * imports so the wire format is testable without a device.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { fromHex, toHex } from '../crypto/bytes';
import { sha256 } from '../crypto/sha256';
import type { RoomSecret } from '../mesh/EnvelopeCodec';
import { isValidRoomId, isValidRoomSecretHex } from './JoinPayload';

const DEVICE_ID_KEY = 'ct.deviceId';
const ROOM_KEY_PREFIX = 'ct.roomSecret.';

/**
 * Stable pseudonymous id for this install. Not derived from a person, a phone
 * number or a hardware identifier, and it changes on reinstall.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing !== null && isValidRoomId(existing)) return existing;

  // Hashed down to 16 hex characters: envelopes are BLE-sized, and a full
  // UUID costs bytes on every single message.
  const deviceId = toHex(sha256(Crypto.getRandomBytes(16))).slice(0, 16);
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

/**
 * Store a room secret obtained from a join QR, deep link or organiser setup.
 * This happens while internet is still available, before the demonstration.
 */
export async function saveRoomSecret(roomId: string, secretHex: string): Promise<void> {
  if (!isValidRoomId(roomId)) {
    throw new Error('room id contains characters that cannot travel in an envelope');
  }
  if (!isValidRoomSecretHex(secretHex)) {
    throw new Error('room secret must be 16 to 64 bytes of hex');
  }
  await SecureStore.setItemAsync(ROOM_KEY_PREFIX + roomId, secretHex.toLowerCase());
}

export async function loadRoomSecret(roomId: string): Promise<RoomSecret | null> {
  const stored = await SecureStore.getItemAsync(ROOM_KEY_PREFIX + roomId);
  if (stored === null) return null;
  return { roomId, key: fromHex(stored) };
}

export async function forgetRoomSecret(roomId: string): Promise<void> {
  await SecureStore.deleteItemAsync(ROOM_KEY_PREFIX + roomId);
}

/** Organiser-side helper: mint a room secret before the event. */
export function generateRoomSecretHex(): string {
  return toHex(Crypto.getRandomBytes(32));
}

export {
  decodeJoinPayload,
  encodeJoinPayload,
  isValidRoomId,
  roomCodeFor,
  type JoinPayload,
} from './JoinPayload';
