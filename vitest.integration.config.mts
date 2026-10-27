import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests against a real PostgreSQL database (`npm run test:integration`).
 * Requires POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING to point at a throwaway, migrated database.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Tests share one database, so run files one at a time
    fileParallelism: false,
    testTimeout: 20_000,
    silent: 'passed-only',
    reporters: [
      'default',
      ['junit', { outputFile: 'reports/integration/junit.xml' }],
      // Self-contained page that opens directly from disk (or from the CI artifact)
      ['html', { outputDir: 'reports/integration/html', singleFile: true }],
    ],
  },
});
