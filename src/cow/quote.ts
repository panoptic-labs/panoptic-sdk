/**
 * Quote swaps via the CoW order-book API.
 *
 * Unlike the Uniswap quoter this is an off-chain HTTP call; results still come
 * back as a `SimulationResult` so UI error handling matches the router path.
 *
 * @module cow/quote
 */

import { zeroAddress } from 'viem'

import { PanopticError } from '../panoptic/v2/errors'
import type { SimulationResult } from '../panoptic/v2/types'
import { COW_NATIVE_ETH } from './addresses'
import { cowApiRequest, resolveCowApiUrl } from './api'
import { APP_DATA_DOC } from './eip712'
import { CowNativeTokenError } from './errors'
import type { CowQuote, QuoteCowSwapParams } from './types'

const BPS_DENOMINATOR = 10_000n
/** Default order validity window (30 minutes). */
export const DEFAULT_VALID_FOR_SECONDS = 1800n

/** No block context for off-chain quotes. */
const OFFCHAIN_META = {
  blockNumber: 0n,
  blockTimestamp: 0n,
  blockHash: '0x0' as `0x${string}`,
}

/**
 * Reject out-of-range slippage so the limit-amount math can't underflow/overflow.
 * 100% (BPS_DENOMINATOR) is forbidden too: on the exact-in path it would reduce
 * `orderBuyAmount` to 0, signing an order that accepts any fill.
 */
function assertSlippageBps(slippageBps: bigint): void {
  if (slippageBps < 0n || slippageBps >= BPS_DENOMINATOR) {
    throw new PanopticError(`invalid slippageBps ${slippageBps}, must be 0..9999`)
  }
}

/** Raw order-book quote response (amounts are decimal strings). */
interface CowQuoteResponse {
  quote: {
    sellToken: string
    buyToken: string
    sellAmount: string
    buyAmount: string
    feeAmount: string
    validTo: number
    kind: 'sell' | 'buy'
  }
  id: number | null
}

/**
 * Quote a swap via the CoW order book.
 *
 * For `kind: 'sell'` (exact-in) `amount` is the sell amount before fee; for
 * `kind: 'buy'` (exact-out) it is the exact buy amount. The returned
 * `orderSellAmount`/`orderBuyAmount` are ready to sign: the fee is folded into
 * the sell side (orders are placed with `feeAmount: 0` under the current fee
 * model) and `slippageBps` is applied to the non-exact side.
 */
export async function quoteCowSwap(
  params: QuoteCowSwapParams,
): Promise<SimulationResult<CowQuote>> {
  const {
    chainId,
    sellToken,
    buyToken,
    kind,
    amount,
    from,
    slippageBps,
    validForSeconds = DEFAULT_VALID_FOR_SECONDS,
    apiUrl,
  } = params

  try {
    assertSlippageBps(slippageBps)
    // Selling native ETH would need the eth-flow contract; buying it is fine —
    // orders use the buy-token sentinel and settle in native ETH.
    if (sellToken === zeroAddress) {
      throw new CowNativeTokenError()
    }
    const resolvedBuyToken = buyToken === zeroAddress ? COW_NATIVE_ETH : buyToken
    if (amount <= 0n) {
      throw new PanopticError(`amount ${amount} must be positive`)
    }

    const baseUrl = resolveCowApiUrl(chainId, apiUrl)
    const response = await cowApiRequest<CowQuoteResponse>(baseUrl, '/quote', {
      method: 'POST',
      body: JSON.stringify({
        sellToken,
        buyToken: resolvedBuyToken,
        from,
        receiver: from,
        validFor: Number(validForSeconds),
        appData: APP_DATA_DOC,
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        signingScheme: 'eip712',
        ...(kind === 'sell'
          ? { kind: 'sell', sellAmountBeforeFee: amount.toString() }
          : { kind: 'buy', buyAmountAfterFee: amount.toString() }),
      }),
    })

    const sellAmount = BigInt(response.quote.sellAmount)
    const buyAmount = BigInt(response.quote.buyAmount)
    const feeAmount = BigInt(response.quote.feeAmount)
    const sellAmountTotal = sellAmount + feeAmount

    // Fold the fee into the signed sell amount (feeAmount signs as 0), then
    // apply slippage to the side the user did not fix. Buy-order sell cap uses
    // ceiling division so the buffer never rounds down.
    const orderSellAmount =
      kind === 'sell'
        ? sellAmountTotal
        : (sellAmountTotal * (BPS_DENOMINATOR + slippageBps) + BPS_DENOMINATOR - 1n) /
          BPS_DENOMINATOR
    const orderBuyAmount =
      kind === 'sell' ? (buyAmount * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR : buyAmount

    return {
      success: true,
      data: {
        kind,
        sellToken,
        // The signed order must carry the resolved (sentinel) buy token.
        buyToken: resolvedBuyToken,
        sellAmount,
        buyAmount,
        feeAmount,
        sellAmountTotal,
        orderSellAmount,
        orderBuyAmount,
        validTo: BigInt(response.quote.validTo),
        quoteId: response.id,
      },
      gasEstimate: 0n,
      _meta: OFFCHAIN_META,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'CoW quote failed',
              error instanceof Error ? error : undefined,
            ),
      _meta: OFFCHAIN_META,
    }
  }
}
