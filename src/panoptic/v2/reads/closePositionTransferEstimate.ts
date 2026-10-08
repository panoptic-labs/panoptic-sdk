import { tickToSqrtPriceX96 } from '../formatters/tick'
import { decodeTokenId } from '../tokenId/decode'
import { type GetNetLiquidationValueParams, getNetLiquidationValue } from './account'
import { getItmAmounts } from './collateralEstimate'
import { getCurrentPositionSizes } from './positionSizes'

/** Spot-price burn swap projection; excludes AMM fees, price impact, and commissions. */
export function estimateCloseZapSwap({
  itm0,
  itm1,
  asset,
  sqrtPriceX96,
}: {
  itm0: bigint
  itm1: bigint
  asset: bigint
  sqrtPriceX96: bigint
}) {
  if (sqrtPriceX96 <= 0n) throw new RangeError('Price must be positive')
  if (asset !== 0n && asset !== 1n) throw new RangeError('Asset must be token0 or token1')
  const priceSquared = sqrtPriceX96 * sqrtPriceX96
  const q192 = 1n << 192n
  // SFPM swaps the nonzero ITM token, using the first leg's asset when both are nonzero.
  const swapToken0 = itm0 !== 0n && (itm1 === 0n || asset === 0n)
  return swapToken0
    ? { amount0: -itm0, amount1: (itm0 * priceSquared) / q192 }
    : { amount0: (itm1 * q192) / priceSquared, amount1: -itm1 }
}

/** Estimate collateral transfers without dispatching a close or checking account solvency. */
export async function getClosePositionTransferEstimate(
  params: Pick<
    GetNetLiquidationValueParams,
    'client' | 'poolAddress' | 'account' | 'queryAddress' | 'blockNumber'
  > & { tokenId: bigint },
) {
  const { client, poolAddress, account, queryAddress, tokenId } = params
  const blockNumber = params.blockNumber ?? (await client.getBlockNumber())
  const [positionSize] = await getCurrentPositionSizes({
    client,
    poolAddress,
    account,
    positionIdList: [tokenId],
    blockNumber,
  })
  if (positionSize === undefined || positionSize === 0n) {
    throw new Error('This position is no longer open in the owner’s account.')
  }
  const firstLeg = decodeTokenId(tokenId).legs[0]
  if (!firstLeg) throw new RangeError('Position must contain at least one leg')
  const value = await getNetLiquidationValue({
    client,
    poolAddress,
    account,
    queryAddress,
    tokenIds: [tokenId],
    includePendingPremium: false,
    blockNumber,
  })
  const itm = await getItmAmounts({
    client,
    poolAddress,
    queryAddress,
    tokenId,
    positionSize,
    blockNumber,
    _meta: value._meta,
  })
  const swap = estimateCloseZapSwap({
    itm0: itm.itm0,
    itm1: itm.itm1,
    asset: firstLeg.asset,
    sqrtPriceX96: tickToSqrtPriceX96(value.atTick),
  })
  return {
    exercise: { amount0: value.value0, amount1: value.value1 },
    swap,
    zap: { amount0: value.value0 + swap.amount0, amount1: value.value1 + swap.amount1 },
    _meta: value._meta,
  }
}
