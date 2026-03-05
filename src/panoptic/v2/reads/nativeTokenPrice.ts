/**
 * Read the native token (e.g. ETH) price in USD from a PanopticPool's on-chain tick.
 *
 * @module v2/reads/nativeTokenPrice
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { tickToPriceDecimalScaled } from '../formatters/tick'

export interface GetNativeTokenPriceParams {
  client: PublicClient
  /** Address of a PanopticPool deployed on a native/USD stablecoin underlying pool */
  panopticPoolAddress: Address
  /** Decimals of token0 in the underlying pool */
  token0Decimals: bigint
  /** Decimals of token1 in the underlying pool */
  token1Decimals: bigint
  /** Whether the native asset is token0 (true) or token1 (false) */
  nativeIsToken0: boolean
}

/**
 * Fetch the native token price in USD by reading `getCurrentTick()` from a
 * PanopticPool deployed on a native/stablecoin pair.
 *
 * @returns The price as a decimal string (e.g. "2000.00")
 */
export async function getNativeTokenPrice(params: GetNativeTokenPriceParams): Promise<string> {
  const { client, panopticPoolAddress, token0Decimals, token1Decimals, nativeIsToken0 } = params

  const currentTick = await client.readContract({
    address: panopticPoolAddress,
    abi: panopticPoolAbi,
    functionName: 'getCurrentTick',
  })

  // tickToPriceDecimalScaled returns token0/token1 price (price of token0 denominated in token1).
  // If nativeIsToken0: price = USD per native (what we want)
  // If !nativeIsToken0: price = native per USD → invert by swapping decimals
  if (nativeIsToken0) {
    return tickToPriceDecimalScaled(BigInt(currentTick), token0Decimals, token1Decimals, 2n)
  } else {
    // Swap decimals to get the inverse price
    return tickToPriceDecimalScaled(BigInt(currentTick), token1Decimals, token0Decimals, 2n)
  }
}
