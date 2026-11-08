import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Throwaway PostgreSQL for the webhook dispatcher integration tests
    // (same provider as packages/db: TEST_DATABASE_URL, local binaries or
    // Docker; those tests are skipped when none is available).
    globalSetup: ['../../packages/db/tests/global-setup.ts'],
    // No real DNS in unit tests (see tests/setup/offline-dns.ts).
    setupFiles: ['./tests/setup/offline-dns.ts'],
    hookTimeout: 60_000,
  },
});
