/**
 * Retry wrapper around `tsdown` that absorbs a known *non-deterministic* failure
 * in declaration generation.
 *
 * `rolldown-plugin-dts` (used by tsdown for `.d.ts` output) shares a single
 * in-memory module map across all build entries and generates declarations in
 * parallel. On multi-core CI it races: a barrel's `index.d.ts` re-export is
 * processed before the sibling leaf's declaration is registered, so rolldown
 * falls back to reading the sibling declaration from disk under `src` — which
 * never exists — and aborts with `UNLOADABLE_DEPENDENCY`. It fails ~half the time
 * on CI while
 * passing every time locally, which made the SDK build (and the `ci` /
 * `build-and-publish` jobs, and Vercel deploys) flaky.
 *
 * Each `tsdown` run cleans its own output and emits byte-identical artifacts, so
 * retrying is safe and side-effect-free — it just re-runs the declaration
 * bundling. We retry ONLY on the race marker so genuine build errors (type
 * errors, etc.) still fail fast.
 *
 * The proper upstream fix is a tsdown/rolldown upgrade past the racy beta, or
 * `isolatedDeclarations` — both larger changes (the latter is blocked by React
 * hooks returning un-nameable wagmi/react-query types). Tracked separately.
 */
import { spawnSync } from 'node:child_process'

const MAX_ATTEMPTS = Number(process.env.SDK_BUILD_MAX_ATTEMPTS ?? 5)
const RACE_MARKER = 'UNLOADABLE_DEPENDENCY'
const tsdownArgs = process.argv.slice(2)

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync('pnpm', ['exec', 'tsdown', ...tsdownArgs], { encoding: 'utf8' })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')

  if (result.status === 0) process.exit(0)

  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const isRace = output.includes(RACE_MARKER)
  if (!isRace || attempt === MAX_ATTEMPTS) {
    if (isRace) {
      console.error(`\n[sdk build] rolldown dts race persisted across ${MAX_ATTEMPTS} attempts.`)
    }
    process.exit(result.status ?? 1)
  }
  console.error(
    `\n[sdk build] rolldown dts race on attempt ${attempt}/${MAX_ATTEMPTS}; retrying…\n`,
  )
}
