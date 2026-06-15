/**
 * Regenerate `src/cow/xstockWrappers.generated.ts`.
 *
 * The Backed `WrappedBackedTokenFactory`s expose no underlying→wrapper lookup,
 * and their `NewToken(address indexed newToken, string, string)` event omits the
 * underlying. So we discover every wrapper from the `NewToken` logs across all
 * known factories, then read each wrapper's ERC4626 metadata (`asset()` is the
 * underlying xStock). When an underlying has been re-wrapped on a newer factory
 * we keep the canonical (most-liquid) wrapper — see the dedup below.
 *
 * Usage:
 *   MAINNET_RPC_URL=https://... pnpm --filter panoptic-v2-sdk gen:xstock-wrappers
 *
 * Idempotent. Logs counts and any wrapper whose `asset()` read failed (those are
 * skipped, never silently dropped).
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Address, createPublicClient, erc20Abi, getAddress, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'

/**
 * Backed WrappedBackedTokenFactory deployments on Ethereum mainnet. Backed has
 * shipped more than one factory over time; every one emits the same
 * `NewToken` event, so we scan all of them and merge the discovered wrappers.
 * `deployBlock` is the first block with code — start scanning each there.
 */
const FACTORIES: { address: Address; deployBlock: bigint }[] = [
  { address: '0x3dd6fbDecb1Dee5Ebeb883B12c6da4D20F45f148', deployBlock: 21810766n },
  { address: '0x28b40fc9dDE267A91eD739961042cA34D5A1Db2A', deployBlock: 25043278n },
]
/** publicnode and most providers cap eth_getLogs at 50k blocks. */
const LOG_CHUNK = 50_000n

const NEW_TOKEN_EVENT = parseAbiItem(
  'event NewToken(address indexed newToken, string name, string symbol)',
)

const erc4626AssetAbi = [
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

async function main() {
  const rpcUrl = process.env.MAINNET_RPC_URL
  if (!rpcUrl) throw new Error('Set MAINNET_RPC_URL to a mainnet RPC endpoint.')
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })

  const head = await client.getBlockNumber()

  const wrappers = new Set<Address>()
  for (const factory of FACTORIES) {
    console.log(
      `Scanning ${factory.address} NewToken logs ${factory.deployBlock}..${head} (chunks of ${LOG_CHUNK})`,
    )
    for (let from = factory.deployBlock; from <= head; from += LOG_CHUNK) {
      const to = from + LOG_CHUNK - 1n > head ? head : from + LOG_CHUNK - 1n
      const logs = await client.getLogs({
        address: factory.address,
        event: NEW_TOKEN_EVENT,
        fromBlock: from,
        toBlock: to,
      })
      for (const log of logs) {
        if (log.args.newToken) wrappers.add(getAddress(log.args.newToken))
      }
    }
  }
  console.log(`Found ${wrappers.size} wrappers across ${FACTORIES.length} factories.`)

  const entries: {
    wrapper: Address
    underlying: Address
    symbol: string
    name: string
    decimals: number
    supply: bigint
  }[] = []
  const skipped: Address[] = []

  const MAX_READ_ATTEMPTS = 3
  for (const wrapper of wrappers) {
    let lastErr: unknown
    let pushed = false
    for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt++) {
      try {
        const [asset, symbol, name, decimals, supply] = await Promise.all([
          client.readContract({ address: wrapper, abi: erc4626AssetAbi, functionName: 'asset' }),
          client.readContract({ address: wrapper, abi: erc20Abi, functionName: 'symbol' }),
          client.readContract({ address: wrapper, abi: erc20Abi, functionName: 'name' }),
          client.readContract({ address: wrapper, abi: erc20Abi, functionName: 'decimals' }),
          client.readContract({ address: wrapper, abi: erc20Abi, functionName: 'totalSupply' }),
        ])
        entries.push({
          wrapper,
          underlying: getAddress(asset),
          symbol,
          name,
          decimals,
          supply,
        })
        pushed = true
        break
      } catch (err) {
        lastErr = err
        // Retry transient RPC failures with linear backoff before giving up.
        if (attempt < MAX_READ_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        }
      }
    }
    if (!pushed) {
      console.error(
        `Failed to read wrapper ${wrapper} after ${MAX_READ_ATTEMPTS} attempts:`,
        lastErr,
      )
      skipped.push(wrapper)
    }
  }

  // Backed has re-wrapped some xStocks on the newer factory, so one underlying
  // can have multiple wrappers. The lookup tables are 1:1 per underlying, so we
  // keep a single canonical wrapper — the one holding real supply (the freshly
  // re-deployed duplicates sit at dust/zero). Tie-break deterministically on
  // wrapper address so regens are stable. Log every drop; never drop silently.
  const byUnderlying = new Map<Address, (typeof entries)[number]>()
  for (const e of entries) {
    const cur = byUnderlying.get(e.underlying)
    if (
      !cur ||
      e.supply > cur.supply ||
      (e.supply === cur.supply && e.wrapper.toLowerCase() < cur.wrapper.toLowerCase())
    ) {
      if (cur) {
        const [winner, loser] = e.supply > cur.supply ? [e, cur] : [cur, e]
        console.log(
          `Duplicate wrapper for ${e.symbol} (${e.underlying}): keeping ${winner.wrapper} ` +
            `(supply ${winner.supply}), dropping ${loser.wrapper} (supply ${loser.supply}).`,
        )
      }
      byUnderlying.set(e.underlying, e)
    } else {
      console.log(
        `Duplicate wrapper for ${e.symbol} (${e.underlying}): keeping ${cur.wrapper} ` +
          `(supply ${cur.supply}), dropping ${e.wrapper} (supply ${e.supply}).`,
      )
    }
  }
  const deduped = [...byUnderlying.values()]
  deduped.sort((a, b) => a.symbol.toLowerCase().localeCompare(b.symbol.toLowerCase()))

  // Never emit a partial registry: a missing wrapper would silently disappear
  // from the app. Abort so the failure is investigated and the run retried.
  if (skipped.length > 0) {
    throw new Error(
      `Aborting: ${skipped.length} wrapper(s) could not be read after retries:\n` +
        skipped.map((s) => `  ${s}`).join('\n'),
    )
  }
  console.log(`Writing ${deduped.length} entries.`)

  const body = deduped
    .map(
      (e) =>
        `    {\n` +
        `      wrapper: '${e.wrapper}',\n` +
        `      underlying: '${e.underlying}',\n` +
        `      symbol: ${JSON.stringify(e.symbol)},\n` +
        `      name: ${JSON.stringify(e.name)},\n` +
        `      decimals: ${e.decimals},\n` +
        `    },`,
    )
    .join('\n')

  const file = `/**
 * Generated registry of Backed xStock ERC4626 wrappers on Ethereum mainnet.
 *
 * DO NOT EDIT BY HAND. Regenerate with \`pnpm --filter panoptic-v2-sdk gen:xstock-wrappers\`
 * (scripts/gen-xstock-wrappers.ts), which scans the WrappedBackedTokenFactory
 * \`NewToken\` events and reads each wrapper's ERC4626 \`asset()\` as the underlying.
 *
 * @module cow/xstockWrappers.generated
 */

import type { XstockWrapperRegistry } from './xstockWrappers'

export const XSTOCK_WRAPPERS: XstockWrapperRegistry = {
  1: [
${body}
  ],
}
`

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'cow',
    'xstockWrappers.generated.ts',
  )
  writeFileSync(outPath, file)
  console.log(`Wrote ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
