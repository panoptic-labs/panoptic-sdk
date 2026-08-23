import { defineConfig } from 'tsdown'

/**
 * Per-entry declaration build. `scripts/build-dts.mjs` invokes tsdown once
 * per entry with `SDK_DTS_ENTRY_KEY` (dist-relative path without extension)
 * and `SDK_DTS_ENTRY_PATH` (source file) set. Each invocation runs
 * `rolldown-plugin-dts` on a single entry graph, eliminating the
 * UNLOADABLE_DEPENDENCY race that lives inside a single tsdown call sharing
 * one in-memory module map across parallel entries.
 *
 * JS bundling stays in the main `tsdown.config.ts` (single fast pass, no dts).
 * `clean: false` so serial dts passes don't wipe siblings' output.
 *
 * The named-entry object form is required: with an array/string entry, tsdown
 * flattens the output filename for a single entry (emits `dist/index.d.ts`
 * regardless of source path), which clobbers other entries and breaks
 * package.json `exports` paths like `./dist/panoptic/v2/index.d.ts`.
 */
const key = process.env.SDK_DTS_ENTRY_KEY
const path = process.env.SDK_DTS_ENTRY_PATH
if (!key || !path) {
  throw new Error('tsdown.dts.config.ts: SDK_DTS_ENTRY_KEY and SDK_DTS_ENTRY_PATH are required')
}

export default defineConfig({
  entry: { [key]: path },
  format: ['esm'],
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'wagmi',
    'viem',
    '@tanstack/react-query',
    'node:fs/promises',
    'node:path',
    'node:child_process',
  ],
  noExternal: ['@panoptic-eng/deployments'],
  platform: 'neutral',
  dts: true,
  clean: false,
})
