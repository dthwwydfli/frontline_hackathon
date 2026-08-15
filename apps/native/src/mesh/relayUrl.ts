/**
 * Where the Wi-Fi relay lives.
 *
 * Derived from whatever host served this bundle. In Expo Go that is the
 * laptop running Metro, which is also where the relay runs — so two phones
 * that scanned the same QR code find the same relay with nothing to type.
 */

import Constants from 'expo-constants';

export const RELAY_PORT = 17833;

export function resolveRelayUrl(): string | null {
  // e.g. "192.168.1.24:8081"
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older/alternate shapes, kept because this is the one value the whole
    // Wi-Fi path depends on.
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    null;

  if (hostUri === null) return null;

  const host = hostUri.split(':')[0];
  if (host === undefined || host.length === 0) return null;

  return `ws://${host}:${RELAY_PORT}`;
}
