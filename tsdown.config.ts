import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/test/index.ts', './src/panoptic/v2/index.ts'],
  format: ['esm'],
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'wagmi',
    'viem',
    '@tanstack/react-query',
    // Node.js built-ins (fileStorage uses fs/promises + path via dynamic import)
    'node:fs/promises',
    'node:path',
    'node:child_process',
  ],
  platform: 'neutral',
  dts: true, // Generate TypeScript declaration files
  clean: !process.argv.includes('--watch'), // Only clean on full builds, not watch mode
})
