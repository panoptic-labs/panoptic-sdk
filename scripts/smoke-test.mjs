#!/usr/bin/env node
/**
 * Clean-package smoke test for @panoptic-eng/sdk.
 *
 * Builds the package, runs `npm pack`, then installs the resulting tarball into
 * fresh temporary projects to verify that the published artifact:
 *   1. Has a clean packed package.json (no workspace:* deps, deployments not a
 *      runtime dependency, @tanstack/react-query declared as an optional peer,
 *      stable React peer ranges with no canary pin).
 *   2. Installs under Yarn v1 (`yarn add <tarball> viem`).
 *   3. Installs under default npm (`npm install <tarball> viem`) with NO
 *      --force / --legacy-peer-deps.
 *   4. Can import `@panoptic-eng/sdk/v2` (the React-using entry) once the React
 *      peers are installed alongside it.
 *   5. Exposes calculatePositionGreeks, calculatePositionValue,
 *      calculatePositionDeltaWithSwap, and getTickSpacing from `/v2`.
 *
 * Does NOT publish anything.
 *
 * Usage: node ./scripts/smoke-test.mjs   (or: pnpm test:pack)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SDK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// React-stack peers required to actually import the (React-using) /v2 entry.
// Kept loose so the test does not pin to a specific patch.
const REACT_PEERS = ['react@^18.3.0', 'react-dom@^18.3.0', 'wagmi@^2.14.0', '@tanstack/react-query@^5.45.0']
const VIEM = 'viem@^2.41.0'

const tempDirs = []
let failures = 0

function log(msg) {
  console.log(`\n\x1b[1m▶ ${msg}\x1b[0m`)
}
function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
}
function fail(msg) {
  failures += 1
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m`)
}
function assert(cond, msg) {
  if (cond) ok(msg)
  else fail(msg)
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    // Disable corepack's packageManager enforcement: the temp projects are
    // standalone and must be installable with yarn/npm regardless of the
    // monorepo's "packageManager" field.
    env: { ...process.env, COREPACK_ENABLE_STRICT: '0', COREPACK_ENABLE_PROJECT_SPEC: '0' },
  })
}

function mkTempProject(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `panoptic-sdk-smoke-${name}-`))
  tempDirs.push(dir)
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: `smoke-${name}`, version: '1.0.0', private: true, type: 'module' }, null, 2),
  )
  return dir
}

function cleanup() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

try {
  // ----------------------------------------------------------------------------
  log('Building @panoptic-eng/sdk')
  run('pnpm', ['build'], SDK_DIR)
  ok('build succeeded')

  // ----------------------------------------------------------------------------
  log('Packing tarball (npm pack)')
  // --ignore-scripts: we already built above; skipping prepack avoids a second
  // build and keeps lifecycle logging out of the --json stdout we parse.
  const packJson = run('npm', ['pack', '--json', '--ignore-scripts'], SDK_DIR)
  const packInfo = JSON.parse(packJson)[0]
  const tarball = path.join(SDK_DIR, packInfo.filename)
  assert(existsSync(tarball), `tarball created: ${packInfo.filename}`)

  // ----------------------------------------------------------------------------
  log('Inspecting packed package.json')
  // `npm pack --json` reports the files it included; read the on-disk source of
  // truth (it is what gets published) and assert on it.
  const pkg = JSON.parse(readFileSync(path.join(SDK_DIR, 'package.json'), 'utf8'))
  const allDepBlocks = JSON.stringify({
    dependencies: pkg.dependencies,
    peerDependencies: pkg.peerDependencies,
    optionalDependencies: pkg.optionalDependencies,
  })
  assert(!allDepBlocks.includes('workspace:'), 'no workspace:* in published dep blocks')
  assert(
    !pkg.dependencies?.['@panoptic-eng/deployments'],
    '@panoptic-eng/deployments not a runtime dependency (inlined)',
  )
  assert(
    pkg.peerDependencies?.['@tanstack/react-query'],
    '@tanstack/react-query declared as a peer dependency',
  )
  assert(
    pkg.peerDependenciesMeta?.['@tanstack/react-query']?.optional === true,
    '@tanstack/react-query peer is optional',
  )
  for (const dep of ['react', 'react-dom', 'wagmi', 'viem']) {
    assert(pkg.peerDependencies?.[dep], `${dep} declared as a peer dependency`)
  }
  assert(
    !/canary/.test(pkg.peerDependencies?.react ?? '') && !/canary/.test(pkg.peerDependencies?.['react-dom'] ?? ''),
    'react/react-dom peers use stable ranges (no canary pin)',
  )
  for (const dep of ['react', 'react-dom', 'wagmi']) {
    assert(pkg.peerDependenciesMeta?.[dep]?.optional === true, `${dep} peer is optional`)
  }
  assert(pkg.peerDependenciesMeta?.viem?.optional !== true, 'viem peer is required (not optional)')

  // ----------------------------------------------------------------------------
  log('Yarn v1 install (yarn add <tarball> viem)')
  try {
    const yarnDir = mkTempProject('yarn')
    const yarnVer = run('yarn', ['--version'], yarnDir).trim()
    run('yarn', ['add', `file:${tarball}`, VIEM, '--no-lockfile'], yarnDir)
    assert(
      existsSync(path.join(yarnDir, 'node_modules', '@panoptic-eng', 'sdk', 'package.json')),
      `yarn v${yarnVer}: SDK installed`,
    )
  } catch (err) {
    fail(`yarn install failed: ${err.message?.split('\n')[0] ?? err}`)
  }

  // ----------------------------------------------------------------------------
  log('Default npm install (no --force / --legacy-peer-deps)')
  const npmDir = mkTempProject('npm')
  run('npm', ['install', tarball, VIEM], npmDir)
  assert(
    existsSync(path.join(npmDir, 'node_modules', '@panoptic-eng', 'sdk', 'package.json')),
    'npm: SDK + viem installed with default resolution',
  )

  // ----------------------------------------------------------------------------
  log('Import @panoptic-eng/sdk/v2 (with React peers installed)')
  // Install the optional React peers into the npm project so the React-using /v2
  // entry can be evaluated, then import it and check the named exports.
  run('npm', ['install', ...REACT_PEERS], npmDir)
  const checkFile = path.join(npmDir, 'check.mjs')
  writeFileSync(
    checkFile,
    [
      "import * as v2 from '@panoptic-eng/sdk/v2'",
      'const required = [',
      "  'calculatePositionGreeks',",
      "  'calculatePositionValue',",
      "  'calculatePositionDeltaWithSwap',",
      "  'getTickSpacing',",
      ']',
      'const missing = required.filter((name) => typeof v2[name] !== "function")',
      'if (missing.length) {',
      '  console.error("MISSING:" + missing.join(","))',
      '  process.exit(1)',
      '}',
      'console.log("V2_OK")',
    ].join('\n'),
  )
  const importOut = run('node', [checkFile], npmDir)
  assert(importOut.includes('V2_OK'), 'import @panoptic-eng/sdk/v2 resolves')
  assert(
    importOut.includes('V2_OK'),
    'calculatePositionGreeks, calculatePositionValue, calculatePositionDeltaWithSwap, getTickSpacing all exported from /v2',
  )
} catch (err) {
  failures += 1
  console.error(`\n\x1b[31mUnexpected error:\x1b[0m ${err.stack ?? err}`)
  if (err.stdout) console.error(String(err.stdout))
  if (err.stderr) console.error(String(err.stderr))
} finally {
  cleanup()
}

console.log('')
if (failures > 0) {
  console.error(`\x1b[31m✗ smoke test failed (${failures} failure${failures === 1 ? '' : 's'})\x1b[0m`)
  process.exit(1)
}
console.log('\x1b[32m✓ all smoke tests passed\x1b[0m')
