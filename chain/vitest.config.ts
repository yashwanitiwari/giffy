import { defineConfig } from 'vitest/config';

/**
 * Two tiers, per README §9.3: `unit` is pure and offline and runs on every commit;
 * `integration` talks to live Horizon testnet and the reference anchor, so it is a
 * separate script that is expected to be slower and occasionally flaky when testnet
 * itself is unwell.
 */
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.integration.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.integration.test.ts'],
          setupFiles: ['test/setup.ts'],
          // Friendbot funding plus several sequential ledger closes; testnet
          // ledgers close every ~5s and the refund test deliberately waits out an
          // expiry window.
          testTimeout: 180_000,
          hookTimeout: 180_000,
          // These tests submit transactions from specific accounts, and parallel
          // files would race each other's sequence numbers.
          fileParallelism: false,
          // Testnet and the reference anchor are third-party infrastructure that
          // occasionally has a bad minute. One retry distinguishes a transient
          // outage from a real regression without masking a genuine failure, which
          // would fail both attempts.
          retry: 1,
        },
      },
    ],
  },
});
