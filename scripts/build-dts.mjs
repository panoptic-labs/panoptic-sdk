/**
 * Serial per-entry declaration build.
 *
 * Root cause: `rolldown-plugin-dts` (pinned via tsdown 0.9) shares one
 * in-memory module map across all entries in a single tsdown call and generates
 * declarations in parallel. On multi-core CI it races — a barrel's `index.d.ts`
 * re-export is processed before its sibling leaf lands in the map, so rolldown
 * falls back to reading the sibling from disk under `src`, which never exists,
 * and aborts with UNLOADABLE_DEPENDENCY. Retrying the whole build absorbed the
 * flake but didn't fix it (and exhausted its attempts in the wild).
 *
 * Fix: run one tsdown invocation per entry. Each processes a single entry
 * graph, so there is nothing to race against. Determinism is bought with
 * ~N * tsdown-startup wall time; each invocation is ~1s locally.
 *
 * JS bundling is emitted separately by `tsdown -c tsdown.config.ts` (single
 * fast call, `dts: false`). This script is dts-only via
 * `tsdown.dts.config.ts`, which honors `SDK_DTS_ENTRY_KEY` (dist-relative
 * name) and `SDK_DTS_ENTRY_PATH` (source file), with `clean: false` so serial
 * passes don't wipe each other's output.
 */
import { spawnSync } from 'node:child_process'

// { dist-relative key (no extension): source path }
// Keys MUST match package.json `exports` type paths so per-entry emission
// lands at the same locations the exports map advertises.
const ENTRIES = {
  index: './src/index.ts',
  'test/index': './src/test/index.ts',
  'panoptic/v2/index': './src/panoptic/v2/index.ts',
  'panoptic/v2/react-public': './src/panoptic/v2/react-public.ts',
  'panoptic/v2/greeks/index': './src/panoptic/v2/greeks/index.ts',
  'uniswap/index': './src/uniswap/index.ts',
  'cow/index': './src/cow/index.ts',
  'zodiac/index': './src/zodiac/index.ts',
  'vault-transaction-fees': './src/vault-transaction-fees.ts',
}

for (const [key, path] of Object.entries(ENTRIES)) {
  process.stdout.write(`\n[sdk build:dts] ${key} <- ${path}\n`)
  const result = spawnSync('pnpm', ['exec', 'tsdown', '-c', 'tsdown.dts.config.ts'], {
    encoding: 'utf8',
    env: { ...process.env, SDK_DTS_ENTRY_KEY: key, SDK_DTS_ENTRY_PATH: path },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`\n[sdk build:dts] failed on entry ${key} (${path})`)
    process.exit(result.status ?? 1)
  }
}
