import { defineConfig } from 'vitest/config';

/**
 * Unit tests cover the pure protocol layer only: envelopes, HMAC,
 * fragmentation, dedup, expiry, thread reduction and content warnings.
 *
 * They deliberately do NOT touch the native modules. Nothing here is evidence
 * that BLE works — only the physical runbook in docs/ can establish that.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
