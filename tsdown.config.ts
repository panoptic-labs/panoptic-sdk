import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './src/index.ts',
    './src/test/index.ts',
    './src/panoptic/v2/index.ts',
    // Public React entry (`@panoptic-eng/sdk/v2/react`): superset of `/v2` that
    // also carries the hooks. Kept separate so the base `/v2` barrel stays
    // React-free for bots/servers (e.g. @panoptic-eng/mcp).
    './src/panoptic/v2/react-public.ts',
    './src/panoptic/v2/greeks/index.ts',
    './src/uniswap/index.ts',
    './src/cow/index.ts',
    './src/zodiac/index.ts',
    './src/vault-transaction-fees.ts',
  ],
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
  // Bundle the internal, unpublished `@panoptic-eng/deployments` workspace
  // package into dist. tsdown/rolldown externalizes declared dependencies by
  // default, which would otherwise leave a literal
  // `import … from "@panoptic-eng/deployments"` in the output and ship an
  // unresolvable `workspace:*` dep to npm consumers.
  noExternal: ['@panoptic-eng/deployments'],
  platform: 'neutral',
  // Declarations are emitted separately by `scripts/build-dts.mjs`, which
  // invokes `tsdown -c tsdown.dts.config.ts` once PER ENTRY. The
  // UNLOADABLE_DEPENDENCY race lives inside a single tsdown call sharing one
  // in-memory module map across parallel entries — serializing at the
  // invocation boundary eliminates it deterministically. This JS pass runs
  // once with all entries in parallel (fast, no dts, no race).
  dts: false,
  clean: !process.argv.includes('--watch'), // Only clean on full builds, not watch mode
})
