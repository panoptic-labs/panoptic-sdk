/**
 * Close a direct-SFPM covered call.
 * @module v2/sfpmCoveredCall/close
 */
import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { PanopticValidationError } from '../errors'
import { decodeSfpmLpLegs, getSfpmLpPosition, planSfpmLpBurn } from '../sfpmLp'
import { slippageBpsToTickDistance } from '../sfpmSwap'
import { encodeV3PoolKeyBytes } from '../simulations/sfpm'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

export interface PlanSfpmCoveredCallCloseParams {
  client: PublicClient
  sfpmAddress: Address
  poolAddress: Address
  /** The holder: receives the asset and the range's fees. */
  account: Address
  tokenId: bigint
  slippageBps: bigint
  blockNumber?: bigint
}

export interface SfpmCoveredCallClose {
  to: Address
  data: Hex
  calls: Hex[]
  /** Contracts left because they round to more liquidity than the range holds. */
  unburnableSize: bigint
}

/**
 * Burn the account's whole covered call. The account receives what the range
 * holds: the asset below the range, the quote token above it, a mix inside,
 * plus the range's fees. `slippageBps` bounds the pool tick at execution.
 */
export async function planSfpmCoveredCallClose(
  params: PlanSfpmCoveredCallCloseParams,
): Promise<SfpmCoveredCallClose> {
  const { sfpmAddress, poolAddress, tokenId, slippageBps } = params
  const legs = decodeSfpmLpLegs(tokenId)
  if (legs.length !== 1)
    throw new PanopticValidationError(`token ID ${tokenId} is not a single-range covered call`)
  const position = await getSfpmLpPosition(params)
  if (position.positionSize === 0n)
    throw new PanopticValidationError(`account ${params.account} holds no token ID ${tokenId}`)
  const { burnSizes, unburnableSize } = planSfpmLpBurn(
    legs,
    position.legs.map((leg) => leg.chunk.netLiquidity),
    position.positionSize,
  )
  if (burnSizes.length === 0)
    throw new PanopticValidationError(
      `token ID ${tokenId} rounds to more liquidity than the range holds`,
    )

  const distance = slippageBpsToTickDistance(slippageBps)
  if (distance < 1n) throw new PanopticValidationError('slippage must cover at least one tick')
  const tick = position.currentTick
  const low = Number(tick - distance < MIN_TICK ? MIN_TICK : tick - distance)
  const high = Number(tick + distance > MAX_TICK ? MAX_TICK : tick + distance)
  const poolKey = encodeV3PoolKeyBytes(poolAddress)
  const calls = burnSizes.map((size) =>
    encodeFunctionData({
      abi: sfpmV3Abi,
      functionName: 'burnTokenizedPosition',
      args: [poolKey, tokenId, size, low, high],
    }),
  )
  return {
    to: sfpmAddress,
    data: encodeFunctionData({ abi: sfpmV3Abi, functionName: 'multicall', args: [calls] }),
    calls,
    unburnableSize,
  }
}
