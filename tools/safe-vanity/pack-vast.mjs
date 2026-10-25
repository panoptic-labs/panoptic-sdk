import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

process.chdir(fileURLToPath(new URL('.', import.meta.url)))
const directory = 'target/vast-bundle'
rmSync(directory, { recursive: true, force: true })
mkdirSync(directory, { recursive: true })
for (const name of [
  'cli.mjs',
  'cuda.cu',
  'proxy.json',
  'proxy-1.5.0.json',
  'config.example.json',
  'VAST.txt',
]) {
  copyFileSync(name, join(directory, name))
}
copyFileSync('records/ethereum-mainnet/configs/vanity.json', join(directory, 'config.json'))
copyFileSync('standalone-lock.yaml', join(directory, 'pnpm-lock.yaml'))
const local = JSON.parse(readFileSync('package.json', 'utf8'))
const scripts = Object.fromEntries(
  Object.entries(local.scripts).filter(([name]) => name.includes('cuda') || name === 'verify'),
)
writeFileSync(
  join(directory, 'package.json'),
  JSON.stringify(
    {
      name: 'safe-vanity-vast',
      private: true,
      type: 'module',
      scripts,
      dependencies: { viem: '2.41.2' },
      packageManager: 'pnpm@10.29.2',
    },
    null,
    2,
  ) + '\n',
)
execFileSync('tar', ['-czf', 'target/safe-vanity-vast.tar.gz', '-C', directory, '.'])
console.log(
  'Created target/safe-vanity-vast.tar.gz (explicit file allowlist; public deployment configuration only)',
)
console.log(
  `SHA256 ${createHash('sha256').update(readFileSync('target/safe-vanity-vast.tar.gz')).digest('hex')}`,
)
