import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  concatHex,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  pad,
  parseAbi,
  toHex,
  isAddress,
} from 'viem'

process.chdir(fileURLToPath(new URL('.', import.meta.url)))
const backend = process.env.SAFE_VANITY_BACKEND ?? 'cpu'
assert(['cpu', 'cuda', 'cuda-host'].includes(backend), 'Unknown backend')
const worker = {
  cpu: './target/release/safe-vanity-local',
  cuda: './target/safe-vanity-cuda',
  'cuda-host': './target/safe-vanity-cuda-host',
}[backend]
const batchSize = backend === 'cuda' ? 1000000000n : 1000000n
const setupAbi = parseAbi([
  'function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)',
])
const factoryAbi = parseAbi([
  'function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)',
])
const artifacts = {
  '1.4.1': JSON.parse(readFileSync('proxy.json', 'utf8')),
  '1.5.0': JSON.parse(readFileSync('proxy-1.5.0.json', 'utf8')),
}
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const save = (path, value) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n')
  renameSync(`${path}.tmp`, path)
}

function prepare(c) {
  assert(Object.hasOwn(artifacts, c.safeVersion), 'Supported Safe versions: 1.4.1, 1.5.0')
  const artifact = artifacts[c.safeVersion]
  assert(BigInt(c.chainId) > 0n)
  for (const address of [
    c.factory,
    c.singleton,
    ...c.owners,
    c.to,
    c.fallbackHandler,
    c.paymentToken,
    c.paymentReceiver,
  ])
    assert(isAddress(address, { strict: false }), `Invalid address ${address}`)
  assert(
    c.owners.length > 0 && new Set(c.owners.map((a) => a.toLowerCase())).size === c.owners.length,
  )
  assert(
    c.owners.every((a) => BigInt(a) > 1n),
    'Invalid owner',
  )
  assert(BigInt(c.threshold) > 0n && BigInt(c.threshold) <= BigInt(c.owners.length))
  assert(/^(0x)([0-9a-fA-F]{2})*$/.test(c.data))
  assert(BigInt(c.threads) >= 1n && BigInt(c.threads) <= 256n)
  const start = BigInt(c.start),
    count = BigInt(c.count)
  assert(
    start >= 0n && count > 0n && start + count <= (1n << 64n) - 256n,
    'Local worker supports a uint64 nonce range',
  )
  const prefixes = c.prefixes.map((p) => p.toLowerCase().replace(/^0x/, ''))
  assert(prefixes.length > 0 && prefixes.length <= 16 && new Set(prefixes).size === prefixes.length)
  assert(prefixes.every((p) => /^[0-9a-f]{1,40}$/.test(p)))
  assert(
    prefixes.every((p, i) => prefixes.every((q, j) => i === j || !p.startsWith(q))),
    'Use non-overlapping prefixes for independent Safes',
  )
  const initializer = encodeFunctionData({
    abi: setupAbi,
    functionName: 'setup',
    args: [
      c.owners,
      BigInt(c.threshold),
      c.to,
      c.data,
      c.fallbackHandler,
      c.paymentToken,
      BigInt(c.payment),
      c.paymentReceiver,
    ],
  })
  const initializerHash = keccak256(initializer)
  const bytecodeHash = keccak256(concatHex([artifact.bytecode, pad(c.singleton, { size: 32 })]))
  const predict = (nonce) =>
    getCreate2Address({
      from: c.factory,
      salt: keccak256(concatHex([initializerHash, toHex(nonce, { size: 32 })])),
      bytecodeHash,
    })
  return {
    initializer,
    initializerHash,
    bytecodeHash,
    prefixes,
    predict,
    proxyCreationCode: artifact.bytecode,
  }
}

async function batch(c, p, start, count) {
  const child = spawn(
    worker,
    [
      p.initializerHash.slice(2),
      c.factory.slice(2),
      p.bytecodeHash.slice(2),
      String(start),
      String(count),
      c.threads,
      p.prefixes.join(','),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  await new Promise((resolve, reject) => {
    child.on('error', reject)
    // 'close' fires after stdout is drained; 'exit' can precede the last data chunk.
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Worker exited ${code}; resume checkpoint to retry batch`)),
    )
  })
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [index, saltNonce, address] = line.split(' ')
      assert(BigInt(saltNonce) >= start && BigInt(saltNonce) < start + count)
      assert.equal(
        address,
        p.predict(BigInt(saltNonce)).toLowerCase(),
        'Independent viem verification failed',
      )
      assert(address.slice(2).startsWith(p.prefixes[Number(index)]))
      return {
        prefix: `0x${p.prefixes[Number(index)]}`,
        saltNonce,
        address,
        transaction: {
          to: c.factory,
          value: '0',
          data: encodeFunctionData({
            abi: factoryAbi,
            functionName: 'createProxyWithNonce',
            args: [c.singleton, p.initializer, BigInt(saltNonce)],
          }),
        },
      }
    })
}

async function selfTest(c) {
  assert.equal(
    keccak256('0x'),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  )
  assert.equal(
    getCreate2Address({
      from: '0x0000000000000000000000000000000000000000',
      salt: toHex(0n, { size: 32 }),
      bytecode: '0x00',
    }).toLowerCase(),
    '0x4d1a2e2bb4f88f0250f26ffff098b0b30b26bf38',
  )
  for (const safeVersion of Object.keys(artifacts)) {
    for (const start of [0n, 255n, 65535n, 1n << 63n]) {
      const config = {
        ...c,
        safeVersion,
        prefixes: Array.from({ length: 16 }, (_, i) => i.toString(16)),
      }
      const p = prepare(config)
      const hits = await batch(config, p, start, 4096n)
      assert.equal(new Set(hits.map((h) => h.prefix)).size, 16)
      for (const hit of hits)
        assert.equal(
          p.predict(BigInt(hit.saltNonce)),
          prepare({ ...config, chainId: '11155111' }).predict(BigInt(hit.saltNonce)),
        )
    }
  }
  for (const start of [0n, 255n, 65535n, 1n << 63n]) {
    const reference = prepare(c)
    for (const digits of [9, 40]) {
      const prefix = reference
        .predict(start)
        .slice(2, 2 + digits)
        .toLowerCase()
      const config = { ...c, prefixes: [prefix] }
      const hits = await batch(config, prepare(config), start, 1n)
      assert.equal(hits.length, 1, 'Known candidate must match')
      assert.equal(hits[0].saltNonce, String(start))
      const wrong = { ...config, prefixes: [(prefix[0] === '0' ? '1' : '0') + prefix.slice(1)] }
      assert.equal((await batch(wrong, prepare(wrong), start, 1n)).length, 0)
    }
  }
  console.log(
    'Passed: Safe 1.4.1 and 1.5.0, Ethereum Keccak, EIP-1014 vector, worker/viem agreement, nonce boundaries, all prefix nibbles, chain ID independence.',
  )
}

async function main() {
  const mode = process.argv[2]
  assert(['test', 'bench', 'mine', 'verify'].includes(mode), 'Use test, bench, mine, or verify')
  if (mode === 'verify') {
    assert(process.argv[4], 'verify requires checkpoint path and trusted configuration path')
    const state = read(process.argv[3])
    assert.deepEqual(
      state.config,
      read(process.argv[4]),
      'Checkpoint configuration differs from trusted configuration',
    )
    const p = prepare(state.config)
    assert.equal(state.fingerprint, keccak256(toHex(JSON.stringify(state.config))))
    assert.equal(state.initializer, p.initializer)
    assert.equal(state.proxyCreationCode, p.proxyCreationCode)
    for (const [prefix, hit] of Object.entries(state.results)) {
      assert(
        BigInt(hit.saltNonce) >= BigInt(state.config.start) &&
          BigInt(hit.saltNonce) < BigInt(state.config.start) + BigInt(state.config.count),
      )
      assert.equal(prefix, hit.prefix)
      assert(p.prefixes.includes(prefix.slice(2)))
      assert.equal(hit.address, p.predict(BigInt(hit.saltNonce)).toLowerCase())
      assert(hit.address.startsWith(prefix))
      assert.deepEqual(hit.transaction, {
        to: state.config.factory,
        value: '0',
        data: encodeFunctionData({
          abi: factoryAbi,
          functionName: 'createProxyWithNonce',
          args: [state.config.singleton, p.initializer, BigInt(hit.saltNonce)],
        }),
      })
    }
    console.log(
      `Verified ${Object.keys(state.results).length}/${p.prefixes.length} results locally. Configuration matches your trusted original; on-chain deployment checks remain.`,
    )
    return
  }
  const c = read(process.argv[3] ?? 'config.example.json')
  if (mode === 'test') return selfTest(c)
  if (backend === 'cuda') await selfTest(c)
  const p = prepare(c)
  if (mode === 'bench') {
    const count = 100000000n,
      t = performance.now()
    await batch(c, p, 0n, count)
    const rate = Number(count) / ((performance.now() - t) / 1000)
    console.log(
      `${Math.round(rate).toLocaleString()} candidates/s (${backend}; CPU thread setting ${c.threads})`,
    )
    for (const prefix of p.prefixes)
      console.log(`0x${prefix}: expected ${(16 ** prefix.length / rate / 60).toFixed(1)} minutes`)
    if (p.prefixes.length === 4 && p.prefixes.every((x) => x.length === p.prefixes[0].length))
      console.log(
        `All four: expected ${((16 ** p.prefixes[0].length * (1 + 1 / 2 + 1 / 3 + 1 / 4)) / rate / 60).toFixed(1)} minutes; ~95% within ${((-(16 ** p.prefixes[0].length) * Math.log(1 - 0.95 ** 0.25)) / rate / 60).toFixed(1)} minutes. Random outcomes, not guarantees.`,
      )
    return
  }
  assert(
    c.development === true || process.argv.includes('--production'),
    'Final parameters require deliberate --production acknowledgement',
  )
  const seconds = BigInt(process.env.SAFE_VANITY_MAX_SECONDS ?? '3600')
  assert(seconds > 0n && seconds <= 604800n, 'Runtime limit must be 1..604800 seconds')
  const deadline = performance.now() + Number(seconds) * 1000
  const checkpointPath = process.argv[4] ?? 'checkpoint.json'
  assert(!checkpointPath.startsWith('--'))
  const fingerprint = keccak256(toHex(JSON.stringify(c)))
  const state = existsSync(checkpointPath)
    ? read(checkpointPath)
    : {
        fingerprint,
        config: c,
        initializer: p.initializer,
        proxyCreationCode: p.proxyCreationCode,
        nextNonce: c.start,
        results: {},
      }
  assert.equal(state.fingerprint, fingerprint, 'Configuration changed; use a new checkpoint')
  assert.equal(state.initializer, p.initializer)
  assert.equal(state.proxyCreationCode, p.proxyCreationCode)
  const lock = `${checkpointPath}.lockfile`
  const fd = openSync(lock, 'wx')
  let stop = false
  process.on('SIGINT', () => {
    stop = true
    console.log('Stopping after current batch; a killed batch is replayed on resume.')
  })
  process.on('SIGTERM', () => {
    stop = true
  })
  try {
    for (const result of Object.values(state.results))
      assert.equal(result.address, p.predict(BigInt(result.saltNonce)).toLowerCase())
    let next = BigInt(state.nextNonce)
    const end = BigInt(c.start) + BigInt(c.count)
    assert(next >= BigInt(c.start) && next <= end)
    console.log(
      c.development
        ? 'DEVELOPMENT ONLY: placeholder owners; do not fund these addresses.'
        : 'Mining configured Safes offline. No transactions will be sent.',
    )
    while (
      !stop &&
      performance.now() < deadline &&
      next < end &&
      Object.keys(state.results).length < p.prefixes.length
    ) {
      const count = end - next < batchSize ? end - next : batchSize
      const t = performance.now()
      for (const hit of await batch(c, p, next, count))
        if (!state.results[hit.prefix]) {
          state.results[hit.prefix] = hit
          console.log(JSON.stringify(hit))
        }
      next += count
      state.nextNonce = String(next)
      save(checkpointPath, state)
      console.log(
        `nextNonce=${next} found=${Object.keys(state.results).length}/${p.prefixes.length} rate=${Math.round(Number(count) / ((performance.now() - t) / 1000))}/s checkpoint=${checkpointPath}`,
      )
    }
    console.log(
      `Stopped with ${Object.keys(state.results).length}/${p.prefixes.length} targets. Runtime limit ${seconds}s applies per invocation; cloud billing continues until you stop/destroy the instance.`,
    )
  } finally {
    closeSync(fd)
    unlinkSync(lock)
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
