import { readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(scriptDir, '..')
const srcRoot = join(packageRoot, 'src')

const allowed = new Set(['src/panoptic/v2/abis/types.d.ts'])

async function walk(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

const found = await walk(srcRoot)
const disallowed = found
  .map((fullPath) => relative(packageRoot, fullPath).replaceAll('\\', '/'))
  .filter((relPath) => !allowed.has(relPath))

if (disallowed.length > 0) {
  console.error('Unexpected declaration files found under src/:')
  for (const relPath of disallowed) {
    console.error(`- ${relPath}`)
  }
  process.exit(1)
}

