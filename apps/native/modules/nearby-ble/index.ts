export { default as NearbyBle } from './src/NearbyBleModule';
export * from './src/NearbyBle.types';

/**
 * 128-bit service UUID Common Thread advertises and scans for. Both platforms
 * must use these exact values or iOS and Android will not find each other.
 */
export const COMMON_THREAD_SERVICE_UUID = '7F3E9A10-2C4B-4D5E-9F80-11A2B3C4D5E6';

/** Peers write frames here. Central -> peripheral direction. */
export const COMMON_THREAD_INBOX_CHARACTERISTIC_UUID =
  '7F3E9A11-2C4B-4D5E-9F80-11A2B3C4D5E6';

/** Peers subscribe here for notifications. Peripheral -> central direction. */
export const COMMON_THREAD_OUTBOX_CHARACTERISTIC_UUID =
  '7F3E9A12-2C4B-4D5E-9F80-11A2B3C4D5E6';
