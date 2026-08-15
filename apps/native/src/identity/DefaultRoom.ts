/**
 * The channel every install lands in.
 *
 * This is deliberately NOT a security boundary and must never be described as
 * one. The secret ships inside the app binary, so it proves only that someone
 * is running this build — which is exactly the intent: anyone nearby with the
 * app can see each other, with nothing to type and nothing to scan.
 *
 * The signature it produces still does real work: it keeps unrelated BLE
 * traffic out of the reducer. It does not keep an attacker out.
 *
 * Nothing in the UI ever mentions a room. This is wire-level plumbing.
 */

export const DEFAULT_ROOM_ID = 'commonthread';

/** 32 bytes of hex. Fixed, so every device derives the same channel. */
export const DEFAULT_ROOM_SECRET_HEX =
  '7f3e9a102c4b4d5e9f8011a2b3c4d5e6a1b2c3d4e5f60718293a4b5c6d7e8f90';
