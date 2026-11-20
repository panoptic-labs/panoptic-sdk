/**
 * Collect a direct-SFPM covered call's fees without changing its size.
 * @module v2/sfpmCoveredCall/collect
 */
import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { PanopticValidationError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import {
  decodeSfpmLpLegs,
  getSfpmLpPosition,
  minSfpmLpPositionSize,
  sfpmLpLegLiquidity,
} from '../sfpmLp'
import { slippageBpsToTickDistance } from '../sfpmSwap'
import { encodeV3PoolKeyBytes } from '../simulations/sfpm'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

const Q96 = 1n << 96n
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

export interface PlanSfpmCoveredCallCollectParams {
  client: PublicClient
  sfpmAddress: Address
  poolAddress: Address
  /** The holder: pays the dust the mint step needs and receives the fees. */
  account: Address
  tokenId: bigint
  slippageBps: bigint
  blockNumber?: bigint
}

export interface SfpmCoveredCallCollect {
  to: Address
  data: Hex
  calls: Hex[]
  /**
   * Most token0 / token1 the mint step can pull, whatever the price: the SFPM
   * allowance the account needs for this call. A few wei at most; the burn
   * step returns it.
   */
  maxIn0: bigint
  maxIn1: bigint
  /** Fees the call is expected to pay out, from the current block. */
  pendingFees0: bigint
  pendingFees1: bigint
}

/**
 * Pay out a covered call's pending fees. The SFPM only collects when a range is
 * touched, so this mints and burns the smallest size the range can hold: the
 * position keeps its size and the account receives the whole range's fees.
 */
export async function planSfpmCoveredCallCollect(
  params: PlanSfpmCoveredCallCollectParams,
): Promise<SfpmCoveredCallCollect> {
  const { sfpmAddress, poolAddress, tokenId, slippageBps } = params
  const legs = decodeSfpmLpLegs(tokenId)
  if (legs.length !== 1)
    throw new PanopticValidationError(`token ID ${tokenId} is not a single-range covered call`)
  const position = await getSfpmLpPosition(params)
  const [leg] = position.legs
  if (position.positionSize === 0n || !leg || leg.chunk.netLiquidity === 0n)
    throw new PanopticValidationError(`account ${params.account} holds no token ID ${tokenId}`)

  const size = minSfpmLpPositionSize(legs)
  const liquidity = sfpmLpLegLiquidity(leg, size)
  const sqrtLower = tickToSqrtPriceX96(leg.tickLower)
  const sqrtUpper = tickToSqrtPriceX96(leg.tickUpper)
  // Uniswap rounds mint amounts up; the bounds below are the range's full one-sided
  // amounts (price below / above the range), plus one wei of margin.
  const maxIn0 =
    ceilDiv(ceilDiv(liquidity * (sqrtUpper - sqrtLower) * Q96, sqrtUpper), sqrtLower) + 1n
  const maxIn1 = ceilDiv(liquidity * (sqrtUpper - sqrtLower), Q96) + 1n

  const distance = slippageBpsToTickDistance(slippageBps)
  if (distance < 1n) throw new PanopticValidationError('slippage must cover at least one tick')
  const tick = position.currentTick
  const low = Number(tick - distance < MIN_TICK ? MIN_TICK : tick - distance)
  const high = Number(tick + distance > MAX_TICK ? MAX_TICK : tick + distance)
  const poolKey = encodeV3PoolKeyBytes(poolAddress)
  const calls = (['mintTokenizedPosition', 'burnTokenizedPosition'] as const).map((functionName) =>
    encodeFunctionData({
      abi: sfpmV3Abi,
      functionName,
      args: [poolKey, tokenId, size, low, high],
    }),
  )
  return {
    to: sfpmAddress,
    data: encodeFunctionData({ abi: sfpmV3Abi, functionName: 'multicall', args: [calls] }),
    calls,
    maxIn0,
    maxIn1,
    pendingFees0: leg.chunk.pendingFees0,
    pendingFees1: leg.chunk.pendingFees1,
  }
}
