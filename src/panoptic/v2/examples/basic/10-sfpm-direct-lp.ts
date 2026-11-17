/**
 * Basic Example 10: Direct SFPM LP (Uniswap v3)
 *
 * Demonstrates:
 * - Resolving the SFPM poolId with ensureSfpmV3PoolInitialized()
 * - Building a direct-LP token ID from tick ranges with buildSfpmLpTokenId()
 * - Simulating and sending create / collect / decrease / close
 * - Reading liquidity and pending fees with getSfpmLpPosition()
 *
 * Prerequisites:
 * - RPC_URL_1 (or RPC_URL) and PRIVATE_KEY environment variables
 * - SFPM_ADDRESS: SemiFungiblePositionManagerV3
 * - UNISWAP_POOL, TOKEN0, TOKEN1, FEE: the Uniswap v3 pool (FEE in hundredths of a bip, e.g. 500)
 * - POSITION_SIZE: contracts to mint, in token0 wei
 * - The account holds both tokens
 */

import { type Address, createPublicClient, createWalletClient, maxUint256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import { resolveRpcEndpoints, rpcTransport } from '../../../../rpc'
import {
  type SfpmLpAction,
  type SfpmLpTarget,
  approve,
  buildSfpmLpTokenId,
  closeSfpmLpPosition,
  collectSfpmLpFees,
  createSfpmLpPosition,
  decodeTickSpacing,
  decreaseSfpmLpPosition,
  ensureSfpmV3PoolInitialized,
  getSfpmLpPosition,
  minSfpmLpPositionSize,
  roundToTickSpacing,
  simulateSfpmLp,
  tickLimits,
} from '../../index'

const RPC_ENDPOINTS = resolveRpcEndpoints(mainnet.id, process.env, { legacyUrlEnv: ['RPC_URL'] })
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const SFPM_ADDRESS = process.env.SFPM_ADDRESS as Address
const UNISWAP_POOL = process.env.UNISWAP_POOL as Address
const TOKEN0 = process.env.TOKEN0 as Address
const TOKEN1 = process.env.TOKEN1 as Address
const FEE = Number(process.env.FEE ?? '500')
const POSITION_SIZE = BigInt(process.env.POSITION_SIZE ?? '0')

if (!PRIVATE_KEY || !SFPM_ADDRESS || !UNISWAP_POOL || !TOKEN0 || !TOKEN1 || POSITION_SIZE <= 0n) {
  console.error(
    'Error: PRIVATE_KEY, SFPM_ADDRESS, UNISWAP_POOL, TOKEN0, TOKEN1 and POSITION_SIZE are required',
  )
  process.exit(1)
}

const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
])

async function main() {
  console.log('=== Panoptic v2 SDK: Direct SFPM LP ===\n')

  const signer = privateKeyToAccount(PRIVATE_KEY)
  const account = signer.address
  const client = createPublicClient({ chain: mainnet, transport: rpcTransport(RPC_ENDPOINTS) })
  const walletClient = createWalletClient({
    account: signer,
    chain: mainnet,
    transport: rpcTransport(RPC_ENDPOINTS, { failover: false }),
  })

  console.log('1. Resolving the SFPM poolId and approving the SFPM...')
  const { poolId } = await ensureSfpmV3PoolInitialized({
    client,
    wallet: walletClient,
    sfpmAddress: SFPM_ADDRESS,
    token0: TOKEN0,
    token1: TOKEN1,
    fee: FEE,
    expectedPool: UNISWAP_POOL,
  })
  for (const tokenAddress of [TOKEN0, TOKEN1]) {
    const tx = await approve({
      client,
      walletClient,
      account,
      tokenAddress,
      spenderAddress: SFPM_ADDRESS,
      amount: maxUint256,
    })
    await tx.wait()
  }

  console.log('2. Building a token ID for a range around the current price...')
  const tickSpacing = decodeTickSpacing(poolId)
  const sfpm = { sfpmAddress: SFPM_ADDRESS, poolAddress: UNISWAP_POOL }
  const [, tick] = await client.readContract({
    address: UNISWAP_POOL,
    abi: poolAbi,
    functionName: 'slot0',
  })
  const currentTick = BigInt(tick)
  const center = roundToTickSpacing(currentTick, tickSpacing)
  const ranges = [
    { tickLower: center - 20n * tickSpacing, tickUpper: center + 20n * tickSpacing, asset: 0n },
  ] as const
  const tokenId = buildSfpmLpTokenId({ poolId, ranges })
  console.log(`   Token ID: ${tokenId}\n`)

  const { low, high } = tickLimits(currentTick, 100n)
  const target: SfpmLpTarget = { ...sfpm, tokenId, tickLimitLow: low, tickLimitHigh: high }
  const preview = async (action: SfpmLpAction) => {
    const simulation = await simulateSfpmLp({ client, account, ...target, action })
    if (!simulation.success) throw simulation.error
    const { amount0, amount1, fees0, fees1 } = simulation.data
    console.log(
      `   ${action.kind}: pays ${amount0} token0 / ${amount1} token1 (negative = receives)`,
    )
    console.log(`   fees paid out: ${fees0} token0 / ${fees1} token1`)
  }

  console.log('3. Creating the position...')
  await preview({ kind: 'increase', positionSize: POSITION_SIZE })
  const created = await createSfpmLpPosition({
    client,
    walletClient,
    account,
    ...target,
    poolId,
    ranges,
    positionSize: POSITION_SIZE,
  })
  await created.wait()

  console.log('4. Reading the position...')
  const position = await getSfpmLpPosition({ client, account, ...sfpm, tokenId })
  for (const leg of position.legs) {
    console.log(`   Range [${leg.tickLower}, ${leg.tickUpper}]: liquidity ${leg.liquidity}`)
    console.log(`     chunk fees: ${leg.chunk.pendingFees0} / ${leg.chunk.pendingFees1}`)
    console.log(`     attributed to this token ID: ${leg.attributedFees0} / ${leg.attributedFees1}`)
  }

  console.log('5. Collecting fees, halving when possible, then closing...')
  await preview({ kind: 'collect' })
  await (await collectSfpmLpFees({ client, walletClient, account, ...target })).wait()

  const half = position.positionSize / 2n
  if (half >= minSfpmLpPositionSize(position.legs)) {
    await preview({ kind: 'decrease', positionSize: half })
    await (
      await decreaseSfpmLpPosition({ client, walletClient, account, ...target, positionSize: half })
    ).wait()
  } else {
    console.log('   Half the position is too small to burn; closing directly.')
  }

  await preview({ kind: 'close' })
  await (await closeSfpmLpPosition({ client, walletClient, account, ...target })).wait()

  const closed = await getSfpmLpPosition({ client, account, ...sfpm, tokenId })
  console.log(`   Remaining balance: ${closed.positionSize}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
