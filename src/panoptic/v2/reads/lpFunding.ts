import type { Address, Hex, PublicClient } from 'viem'

import { getLpPositionFunding } from '../../../uniswap/lpDeposit'
import { stateViewAbi } from '../abis/stateView'
import { uniswapV3PoolAbi } from '../abis/uniswapV3Pool'
import { type MulticallContract, multicallRead } from '../clients'
import { PanopticError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import { convertToTokenIndex } from '../utils/priceConvert'
import { prepareMarginBufferRead } from './margin'
import { getPoolMetadata } from './pool'

export interface LpFundingPolicy {
  queryAddress: Address
  quoteTokenIndex: 0 | 1
  stateViewAddress?: Address
}

/** Recheck full LP backing against fresh pool and account state before signing. */
export async function readLpFundingSnapshot(
  params: LpFundingPolicy & {
    client: PublicClient
    poolAddress: Address
    account: Address
    existingPositionIds: bigint[]
    tokenId: bigint
    positionSize: bigint
    blockNumber?: bigint
  },
) {
  const { client, poolAddress, account, existingPositionIds, queryAddress, quoteTokenIndex } =
    params
  const metadata = await getPoolMetadata({ client, poolAddress })
  if (metadata.isV4 && !params.stateViewAddress)
    throw new PanopticError('Missing V4 StateView for LP funding check')
  const priceContract: MulticallContract =
    metadata.isV4 && params.stateViewAddress
      ? {
          address: params.stateViewAddress,
          abi: stateViewAbi,
          functionName: 'getSlot0',
          args: [metadata.underlyingPoolId as Hex],
        }
      : {
          address: metadata.underlyingPoolId as Address,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
        }
  const marginRead = prepareMarginBufferRead({
    poolAddress,
    account,
    tokenIds: existingPositionIds,
    queryAddress,
    collateralAddresses: {
      collateralToken0: metadata.collateralToken0Address,
      collateralToken1: metadata.collateralToken1Address,
    },
  })
  const { results, _meta } = await multicallRead({
    client,
    contracts: [priceContract, ...marginRead.contracts],
    blockNumber: params.blockNumber,
  })
  const priceResult = results[0]
  if (!priceResult) throw new PanopticError('Missing pool price result for LP funding check')
  if (priceResult.status === 'failure') throw priceResult.error
  const slot0 = priceResult.result as readonly [bigint, ...unknown[]]
  const margin = marginRead.decode(results.slice(1), _meta)
  const valuationSqrtPriceX96 = tickToSqrtPriceX96(margin.currentTick)
  const fundingParams = {
    tokenId: params.tokenId,
    positionSize: params.positionSize,
    tickSpacing: metadata.tickSpacing,
    sqrtPriceX96: slot0[0],
    valuationSqrtPriceX96,
    quoteTokenIndex,
  }
  const funding = getLpPositionFunding(fundingParams)
  const available =
    margin.mintableMarginBinding ??
    (margin.denominatedInToken === 0 ? margin.currentMargin0 : margin.currentMargin1)
  const availableInQuote = convertToTokenIndex(
    available,
    BigInt(margin.denominatedInToken),
    BigInt(quoteTokenIndex),
    valuationSqrtPriceX96,
  )
  return {
    funding,
    fundingParams,
    availableInQuote,
    blockNumber: _meta.blockNumber,
    currentTick: margin.currentTick,
    _meta,
  }
}

/** Recheck the same funding policy used by executable LP sizing before signing. */
export async function assertLpPositionFunded(params: Parameters<typeof readLpFundingSnapshot>[0]) {
  const { funding, availableInQuote } = await readLpFundingSnapshot(params)
  if (availableInQuote < funding.totalInQuote)
    throw new PanopticError(
      'Insufficient collateral for the full LP principal and 5% funding buffer. Refresh the position and deposit collateral or reduce its size.',
    )
  return funding
}
