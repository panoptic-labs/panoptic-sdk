import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('.', import.meta.url)))
const registryPath = 'records/ethereum-mainnet/deployments.json'
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const registry = read(registryPath)
const stateFor = (safe) => read(registry.runs[safe.run].checkpoint)

function check() {
  for (const paths of Object.values(registry.runs)) {
    execFileSync(process.execPath, ['cli.mjs', 'verify', paths.checkpoint, paths.config], {
      stdio: 'inherit',
    })
  }
  execFileSync(
    process.execPath,
    ['cli.mjs', 'verify', 'archive/seven-digit/checkpoint.json', 'archive/seven-digit/config.json'],
    { stdio: 'inherit' },
  )
  for (const move of read('records/file-moves.json')) {
    assert.equal(
      createHash('sha256').update(readFileSync(move.path)).digest('hex'),
      move.sha256,
      `Original file changed: ${move.path}`,
    )
  }
  const expectedCount = Object.values(registry.runs).reduce(
    (n, run) => n + Object.keys(read(run.checkpoint).results).length,
    0,
  )
  assert.equal(registry.safes.length, expectedCount)
  assert.equal(new Set(registry.safes.map((s) => s.address.toLowerCase())).size, expectedCount)
  for (const safe of registry.safes) {
    const state = stateFor(safe)
    const result = state.results[safe.prefix]
    assert.equal(registry.chainId, state.config.chainId)
    assert.equal(registry.safeVersion, state.config.safeVersion)
    assert.equal(result.address, safe.address)
    assert.equal(result.saltNonce, safe.saltNonce)
    assert.equal(safe.explorer, `https://etherscan.io/address/${safe.address}`)
    assert(['reported-deployed', 'verified-deployed'].includes(safe.deploymentStatus))
    if (safe.deploymentStatus === 'verified-deployed') {
      assert(/^0x[0-9a-f]{64}$/i.test(safe.transactionHash))
      assert(BigInt(safe.blockNumber) > 0n)
      assert(safe.onchainVerifiedAt && safe.verification)
      assert.equal(
        safe.verification.transactionFrom.toLowerCase(),
        safe.reportedDeployer.toLowerCase(),
      )
      assert.deepEqual(
        safe.verification.owners.map((a) => a.toLowerCase()),
        state.config.owners.map((a) => a.toLowerCase()),
      )
      assert.equal(safe.verification.threshold, state.config.threshold)
      assert.equal(safe.verification.singleton.toLowerCase(), state.config.singleton.toLowerCase())
      assert.equal(
        safe.verification.fallbackHandler.toLowerCase(),
        state.config.fallbackHandler.toLowerCase(),
      )
      assert.equal(safe.verification.version, registry.safeVersion)
    }
  }
  console.log(
    `Registry matches ${expectedCount} final Safes; archived run and all original file hashes verified.`,
  )
}

async function verifyOnchain() {
  if (process.env.SAFE_VANITY_ENV_FILE) {
    const { config } = await import('dotenv')
    const loaded = config({ path: process.env.SAFE_VANITY_ENV_FILE, quiet: true })
    if (loaded.error) throw loaded.error
  }
  const { resolveRpcEndpoints, rpcTransport } = await import('@panoptic-eng/sdk/rpc')
  const { createPublicClient, decodeFunctionData, decodeEventLog, parseAbi, keccak256, toHex } =
    await import('viem')
  const { mainnet } = await import('viem/chains')
  const client = createPublicClient({
    chain: mainnet,
    transport: rpcTransport(resolveRpcEndpoints(1, process.env, { legacyUrlEnv: ['RPC_URL'] }), {
      retryCount: 1,
      timeout: 20000,
    }),
  })
  assert.equal(await client.getChainId(), 1)
  const block = await client.getBlock()
  const abi = parseAbi([
    'function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)',
    'function proxyCreationCode() view returns (bytes)',
    'event ProxyCreation(address indexed proxy,address singleton)',
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function VERSION() view returns (string)',
    'function masterCopy() view returns (address)',
  ])
  const hashes = process.argv.slice(3)
  if (!hashes.length) hashes.push(...registry.safes.map((s) => s.transactionHash))
  assert.equal(hashes.length, registry.safes.length)
  assert.equal(new Set(hashes).size, hashes.length)
  assert(
    hashes.every((h) => typeof h === 'string' && /^0x[0-9a-f]{64}$/i.test(h)),
    'Supply five deployment transaction hashes',
  )
  const matched = new Set()
  for (const hash of hashes) {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ])
    assert.equal(receipt.status, 'success')
    assert(receipt.blockNumber <= block.number)
    const decoded = decodeFunctionData({ abi, data: tx.input })
    assert.equal(decoded.functionName, 'createProxyWithNonce')
    const [singleton, initializer, nonce] = decoded.args
    const safe = registry.safes.find((s) => s.saltNonce === String(nonce))
    assert(safe, `Unrecognized deployment nonce ${nonce}`)
    assert(!matched.has(safe.address))
    matched.add(safe.address)
    const state = stateFor(safe),
      c = state.config
    assert.equal(tx.from.toLowerCase(), safe.reportedDeployer.toLowerCase())
    assert.equal(tx.to.toLowerCase(), c.factory.toLowerCase())
    assert.equal(tx.value, 0n)
    assert.equal(singleton.toLowerCase(), c.singleton.toLowerCase())
    assert.equal(initializer, state.initializer)
    assert.equal(tx.input, state.results[safe.prefix].transaction.data)
    const events = receipt.logs
      .filter((log) => log.address.toLowerCase() === c.factory.toLowerCase())
      .flatMap((log) => {
        try {
          return [
            decodeEventLog({ abi, eventName: 'ProxyCreation', data: log.data, topics: log.topics }),
          ]
        } catch {
          return []
        }
      })
    assert(
      events.some(
        (e) =>
          e.args.proxy.toLowerCase() === safe.address &&
          e.args.singleton.toLowerCase() === c.singleton.toLowerCase(),
      ),
    )
    const call = (address, functionName) =>
      client.readContract({ address, abi, functionName, blockNumber: block.number })
    const [creationCode, owners, threshold, version, implementation, fallbackSlot, code] =
      await Promise.all([
        call(c.factory, 'proxyCreationCode'),
        call(safe.address, 'getOwners'),
        call(safe.address, 'getThreshold'),
        call(safe.address, 'VERSION'),
        call(safe.address, 'masterCopy'),
        client.getStorageAt({
          address: safe.address,
          slot: keccak256(toHex('fallback_manager.handler.address')),
          blockNumber: block.number,
        }),
        client.getCode({ address: safe.address, blockNumber: block.number }),
      ])
    assert.equal(creationCode, state.proxyCreationCode)
    assert(code && code !== '0x')
    assert.deepEqual(
      owners.map((a) => a.toLowerCase()),
      c.owners.map((a) => a.toLowerCase()),
    )
    assert.equal(String(threshold), c.threshold)
    assert.equal(version, c.safeVersion)
    assert.equal(implementation.toLowerCase(), c.singleton.toLowerCase())
    assert(fallbackSlot)
    const fallbackHandler = `0x${fallbackSlot.slice(-40)}`
    assert.equal(fallbackHandler, c.fallbackHandler.toLowerCase())
    Object.assign(safe, {
      deploymentStatus: 'verified-deployed',
      transactionHash: hash,
      blockNumber: String(receipt.blockNumber),
      onchainVerifiedAt: new Date().toISOString(),
      verification: {
        blockNumber: String(block.number),
        blockHash: block.hash,
        transactionFrom: tx.from,
        owners,
        threshold: String(threshold),
        version,
        singleton: implementation,
        fallbackHandler,
        runtimeCodeHash: keccak256(code),
        proxyCreationCodeHash: keccak256(creationCode),
      },
    })
    console.log(
      `Verified ${safe.prefix}: ${safe.address} (deployment block ${receipt.blockNumber})`,
    )
  }
  assert.equal(matched.size, registry.safes.length)
  writeFileSync(`${registryPath}.tmp`, JSON.stringify(registry, null, 2) + '\n')
  renameSync(`${registryPath}.tmp`, registryPath)
  check()
}

async function main() {
  check()
  if (process.argv[2] === 'onchain') return verifyOnchain()
  assert(['check', 'status', undefined].includes(process.argv[2]), 'Use check, status, or onchain')
  if (process.argv[2] !== 'check')
    console.table(
      registry.safes.map((s) => ({
        prefix: s.prefix,
        address: s.address,
        status: s.deploymentStatus,
        transaction: s.transactionHash ?? 'pending',
      })),
    )
}
main().catch(async (error) => {
  if (process.argv[2] === 'onchain') {
    const { redactRpcSecrets } = await import('@panoptic-eng/sdk/rpc')
    console.error(redactRpcSecrets(error.shortMessage ?? error.message))
  } else console.error(error.message)
  process.exitCode = 1
})
