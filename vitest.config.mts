import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Unit, API-route and component tests (`npm test`, `npm run test:coverage`).
 * Database integration tests have their own config: vitest.integration.config.mts.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same alias as tsconfig.json "paths": { "@/*": ["./src/*"] }
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/prisma.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.ts'],
          setupFiles: ['tests/setup/prisma.ts', 'tests/setup/api.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/setup/prisma.ts', 'tests/setup/components.ts'],
        },
      },
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    // The app logs heavily; only show console output for failing tests
    silent: 'passed-only',
    reporters: [
      'default',
      ['junit', { outputFile: 'reports/unit/junit.xml' }],
      // Self-contained page that opens directly from disk (or from the CI artifact)
      ['html', { outputDir: 'reports/unit/html', singleFile: true }],
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'src/app/api/**/*.ts',
        'src/components/**/*.tsx',
        'src/contexts/**/*.tsx',
        'src/hooks/**/*.ts',
        'middleware.ts',
      ],
      exclude: [
        // Comment-only file with example URLs, no code
        'src/lib/comparisonTestData.ts',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
        'src/lib/**': { lines: 95, statements: 95, functions: 95, branches: 90 },
        'src/app/api/**': { lines: 95, statements: 95, functions: 95, branches: 90 },
      },
    },
  },
});
