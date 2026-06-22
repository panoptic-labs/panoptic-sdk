// Post-build step: rewrite the bare `@panoptic-eng/deployments` specifier in
// emitted declaration files to the local sidecar (`dist/deployments.d.ts`,
// produced by `tsdown.deployments.config.ts`).
//
// The main tsdown build bundles the package's runtime JS into every entry, but
// rolldown-plugin-dts (tsdown 0.9) cannot inline its types, so it leaves a bare
// `from "@panoptic-eng/deployments"` import in `dist/index.d.ts` that npm
// consumers cannot resolve. Pointing it at the self-contained sidecar makes the
// published types fully resolvable without shipping the unpublished package.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const SPECIFIER = '@panoptic-eng/deployments'

/** Recursively collect every .d.ts file under dist. */
function collectDts(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectDts(full))
    else if (full.endsWith('.d.ts')) out.push(full)
  }
  return out
}

let patched = 0
for (const file of collectDts(distDir)) {
  // Don't rewrite the sidecar's own declarations.
  if (file === join(distDir, 'deployments.d.ts')) continue

  const src = readFileSync(file, 'utf8')
  if (!src.includes(SPECIFIER)) continue

  // Relative path from this file to dist/deployments (no extension, POSIX-style).
  let rel = relative(dirname(file), join(distDir, 'deployments')).replaceAll('\\', '/')
  if (!rel.startsWith('.')) rel = `./${rel}`

  writeFileSync(file, src.replaceAll(SPECIFIER, rel))
  patched += 1
  console.log(`[inline-deployments-dts] ${relative(distDir, file)} -> ${rel}`)
}

console.log(`[inline-deployments-dts] patched ${patched} declaration file(s)`)
