import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig from '../../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      setupFiles: ['./setup-tests.ts'],
      testTimeout: 10_000,
      // Fork tests require a running Anvil instance and should be run explicitly via test:fork.
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/*.fork.test.ts',
        // Exclude React hook tests that require jsdom (not part of MVP)
        '**/hypoVault/**/hooks/**/*.test.tsx',
      ],
    },
  }),
)
