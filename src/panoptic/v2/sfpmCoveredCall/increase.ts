/**
 * Add to an open direct-SFPM covered call.
 * @module v2/sfpmCoveredCall/increase
 */
import type { Address } from 'viem'

import { PanopticValidationError } from '../errors'
import { decodeAllLegs } from '../tokenId'
import { type SfpmCoveredCallOpen, planSfpmCoveredCallOpen } from './open'

const POOL_ID_MASK = (1n << 64n) - 1n

export interface PlanSfpmCoveredCallIncreaseParams {
  sfpmAddress: Address
  poolAddress: Address
  /** The covered call to add to. Its range, asset and pool are reused as is. */
  tokenId: bigint
  /** Additional asset to lock, at most. */
  deposit: bigint
  currentTick: bigint
  sqrtPriceX96?: bigint
  liquidity: bigint
  fee: number
  slippageBps: bigint
}

/**
 * Size and encode an increase: the same swap-then-mint as an open, minting the
 * same token ID, which the SFPM adds to the account's balance. The mint also
 * pays out the range's pending fees.
 */
export function planSfpmCoveredCallIncrease(
  params: PlanSfpmCoveredCallIncreaseParams,
): SfpmCoveredCallOpen {
  const { tokenId } = params
  const legs = decodeAllLegs(tokenId)
  const [leg] = legs
  if (
    legs.length !== 1 ||
    !leg ||
    leg.isLong ||
    leg.optionRatio !== 1n ||
    leg.asset !== leg.tokenType
  )
    throw new PanopticValidationError(`token ID ${tokenId} is not a single-range covered call`)
  const plan = planSfpmCoveredCallOpen({
    ...params,
    poolId: tokenId & POOL_ID_MASK,
    assetIdx: leg.asset === 0n ? 0n : 1n,
    strike: leg.strike,
    width: leg.width,
  })
  if (plan.tokenId !== tokenId)
    throw new PanopticValidationError(
      `token ID ${tokenId} does not match the covered call the planner builds (${plan.tokenId})`,
    )
  return plan
}
