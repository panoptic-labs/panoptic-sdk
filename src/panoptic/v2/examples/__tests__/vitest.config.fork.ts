/**
 * Vitest configuration for fork tests
 * @module examples/__tests__/vitest.config.fork
 *
 * NOTE: Fork tests are excluded from the default SDK vitest config and are run
 * only via this dedicated config.
 *
 * To run fork tests:
 * 1. Start Anvil with your fork config
 * 2. Run: pnpm test:fork
 */

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * Fork test configuration to run fork tests in isolation:
 *   pnpm vitest run --config src/panoptic/v2/examples/__tests__/vitest.config.fork.ts
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ['../../../../../setup-tests.ts'],
    testTimeout: 30_000, // 30 seconds for RPC calls
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Sequential execution
      },
    },
    include: ['**/*.fork.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
