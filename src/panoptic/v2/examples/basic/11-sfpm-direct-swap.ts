/**
 * Basic Example 11: Direct SFPM Swap (Uniswap v3)
 *
 * Demonstrates:
 * - Building a swap plan with buildSfpmSwapPlan() (exact-in or exact-out, either direction)
 * - Quoting it with quoteSfpmSwap()
 * - Sending it atomically with executeSfpmSwap()
 *
 * Slippage: the only on-chain check bounds the pool's final tick. There is no
 * minimum-output check, so quote right before sending and keep SLIPPAGE_BPS tight.
 *
 * Prerequisites:
 * - RPC_URL_1 (or RPC_URL) and PRIVATE_KEY environment variables
 * - SFPM_ADDRESS: SemiFungiblePositionManagerV3
 * - UNISWAP_POOL, TOKEN0, TOKEN1, FEE: the Uniswap v3 pool (FEE in hundredths of a bip, e.g. 500)
 * - AMOUNT: wei of the fixed token (input for exactIn, output for exactOut)
 * - KIND: exactIn (default) or exactOut
 * - ZERO_FOR_ONE: true (default) sells token0, false sells token1
 * - SLIPPAGE_BPS: tick-band tolerance (default 30)
 */

import { type Address, createPublicClient, createWalletClient, maxUint256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import { resolveRpcEndpoints, rpcTransport } from '../../../../rpc'
import {
  approve,
  buildSfpmSwapPlan,
  ensureSfpmV3PoolInitialized,
  executeSfpmSwap,
  quoteSfpmSwap,
} from '../../index'

const RPC_ENDPOINTS = resolveRpcEndpoints(mainnet.id, process.env, { legacyUrlEnv: ['RPC_URL'] })
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const SFPM_ADDRESS = process.env.SFPM_ADDRESS as Address
const UNISWAP_POOL = process.env.UNISWAP_POOL as Address
const TOKEN0 = process.env.TOKEN0 as Address
const TOKEN1 = process.env.TOKEN1 as Address
const FEE = Number(process.env.FEE ?? '500')
const AMOUNT = BigInt(process.env.AMOUNT ?? '0')
const KIND = process.env.KIND === 'exactOut' ? 'exactOut' : 'exactIn'
const ZERO_FOR_ONE = process.env.ZERO_FOR_ONE !== 'false'
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS ?? '30')

if (!PRIVATE_KEY || !SFPM_ADDRESS || !UNISWAP_POOL || !TOKEN0 || !TOKEN1 || AMOUNT <= 0n) {
  console.error(
    'Error: PRIVATE_KEY, SFPM_ADDRESS, UNISWAP_POOL, TOKEN0, TOKEN1 and AMOUNT are required',
  )
  process.exit(1)
}

const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
])

async function main() {
  console.log('=== Panoptic v2 SDK: Direct SFPM Swap ===\n')

  const signer = privateKeyToAccount(PRIVATE_KEY)
  const account = signer.address
  const client = createPublicClient({ chain: mainnet, transport: rpcTransport(RPC_ENDPOINTS) })
  const walletClient = createWalletClient({
    account: signer,
    chain: mainnet,
    transport: rpcTransport(RPC_ENDPOINTS, { failover: false }),
  })

  console.log('1. Resolving the SFPM poolId and approving the input token...')
  const { poolId } = await ensureSfpmV3PoolInitialized({
    client,
    wallet: walletClient,
    sfpmAddress: SFPM_ADDRESS,
    token0: TOKEN0,
    token1: TOKEN1,
    fee: FEE,
    expectedPool: UNISWAP_POOL,
  })
  const approval = await approve({
    client,
    walletClient,
    account,
    tokenAddress: ZERO_FOR_ONE ? TOKEN0 : TOKEN1,
    spenderAddress: SFPM_ADDRESS,
    amount: maxUint256,
  })
  await approval.wait()

  console.log('2. Building and quoting the plan...')
  const [, currentTick] = await client.readContract({
    address: UNISWAP_POOL,
    abi: poolAbi,
    functionName: 'slot0',
  })
  const plan = buildSfpmSwapPlan({
    sfpmAddress: SFPM_ADDRESS,
    poolAddress: UNISWAP_POOL,
    poolId,
    kind: KIND,
    zeroForOne: ZERO_FOR_ONE,
    amount: AMOUNT,
    currentTick,
    slippageBps: SLIPPAGE_BPS,
  })
  const quote = await quoteSfpmSwap({ client, plan, account })
  if (!quote.success) throw quote.error
  console.log(`   In:  ${quote.data.amountIn}`)
  console.log(`   Out: ${quote.data.amountOut}`)
  console.log(`   Final tick: ${quote.data.finalTick} (was ${currentTick})\n`)

  console.log('3. Sending the swap...')
  const tx = await executeSfpmSwap({ client, walletClient, account, plan })
  const receipt = await tx.wait()
  console.log(`   ${receipt.status} in block ${receipt.blockNumber}: ${tx.hash}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
