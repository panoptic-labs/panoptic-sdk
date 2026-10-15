import { type Address, type PublicClient, isAddressEqual } from 'viem'

import { quoteSwapExactOutViaV3Router } from '../../../uniswap/v3/router'
import { quoteSwapExactOutViaRouter } from '../../../uniswap/v4/router'
import { getPoolMetadata } from '../reads/pool'
import { getNotEnoughTokensError } from './tokenShortfallRecovery'

/** Quote the opposite pool token needed to buy the deficit in a NotEnoughTokens revert. */
export async function quoteTokenShortfallSwap({
  client,
  chainId,
  poolAddress,
  error,
  slippageBps = 50n,
}: {
  client: PublicClient
  chainId: bigint
  poolAddress: Address
  error: unknown
  slippageBps?: bigint
}) {
  const shortfall = getNotEnoughTokensError(error)
  if (shortfall === null || shortfall.deficit === 0n) return null
  const metadata = await getPoolMetadata({ client, poolAddress })
  const matches0 = [metadata.token0Asset, metadata.collateralToken0Address].some((address) =>
    isAddressEqual(address, shortfall.tokenAddress),
  )
  const matches1 = [metadata.token1Asset, metadata.collateralToken1Address].some((address) =>
    isAddressEqual(address, shortfall.tokenAddress),
  )
  if (matches0 === matches1) return null
  const tokenIn = matches0 ? metadata.token1Asset : metadata.token0Asset
  const quote = await (metadata.isV4 ? quoteSwapExactOutViaRouter : quoteSwapExactOutViaV3Router)({
    client,
    chainId,
    poolAddress,
    tokenIn,
    amountOut: shortfall.deficit,
    slippageBps,
  })
  return {
    deficit: shortfall.deficit,
    outputSymbol: matches0 ? metadata.token0Symbol : metadata.token1Symbol,
    outputDecimals: matches0 ? metadata.token0Decimals : metadata.token1Decimals,
    inputSymbol: matches0 ? metadata.token1Symbol : metadata.token0Symbol,
    inputDecimals: matches0 ? metadata.token1Decimals : metadata.token0Decimals,
    tokenIn,
    slippageBps,
    poolFeePips: metadata.fee <= 1000000n ? metadata.fee : null,
    estimatedPoolFee:
      quote.success && metadata.fee <= 1000000n
        ? (quote.data.amountIn * metadata.fee + 999999n) / 1000000n
        : null,
    quote: quote.success ? quote.data : null,
  }
}
