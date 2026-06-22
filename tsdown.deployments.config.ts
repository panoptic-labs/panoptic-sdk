import { fileURLToPath } from 'node:url'

import { defineConfig } from 'tsdown'

// Sidecar build for the internal, unpublished `@panoptic-eng/deployments`
// workspace package. The main build (`tsdown.config.ts`) bundles its runtime
// JS into every entry via `noExternal`, but rolldown-plugin-dts (pinned via
// tsdown 0.9) cannot inline its types — `dts.resolve` crashes on this package,
// so the emitted `dist/index.d.ts` keeps a bare `@panoptic-eng/deployments`
// type import that npm consumers cannot resolve.
//
// Emitting the package as its own single entry sidesteps that: its imports
// resolve relatively, so the types inline cleanly into `dist/deployments.d.ts`.
// `scripts/inline-deployments-dts.mjs` then rewrites the bare specifier in the
// emitted declaration files to `./deployments`, making the published types
// fully self-contained. Runs with `clean: false` so it does not wipe the main
// build output.
export default defineConfig({
  entry: {
    deployments: fileURLToPath(new URL('../deployments/src/index.ts', import.meta.url)),
  },
  outDir: 'dist',
  format: ['esm'],
  external: ['viem'],
  platform: 'neutral',
  dts: true,
  clean: false,
})
