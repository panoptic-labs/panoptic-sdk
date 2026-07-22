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
    // v2/index.ts already exports the complete types barrel. Adding that barrel
    // as a second entry creates a competing declaration graph and triggers
    // rolldown-plugin-dts UNLOADABLE_DEPENDENCY races on multi-core CI.
    './src/uniswap/index.ts',
    './src/cow/index.ts',
    // Dedicated entry so the type-only re-export (`export type … from './types'`
    // in cow/index.ts) gets a deterministically-emitted declaration file. Without
    // it, rolldown's parallel dts generation can race and fail to load
    // src/cow/types.d.ts on multi-core CI.
    './src/cow/types.ts',
    './src/zodiac/index.ts',
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
  dts: true,
  clean: !process.argv.includes('--watch'), // Only clean on full builds, not watch mode
})
