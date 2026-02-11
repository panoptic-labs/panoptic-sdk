import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/test/index.ts'],
  format: ['esm'],
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'wagmi',
    'viem',
    '@tanstack/react-query',
    // Test utilities dependencies (exported via ./test entry point)
    'node:child_process',
  ],
  platform: 'neutral',
  dts: true, // Generate TypeScript declaration files
  clean: !process.argv.includes('--watch'), // Only clean on full builds, not watch mode
})
