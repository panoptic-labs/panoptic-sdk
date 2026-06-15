/**
 * Sign and submit CoW orders (and signed cancellations) to the order book.
 *
 * Orders are EIP-712 intents — submission returns an order UID, not a tx
 * hash. Settlement happens later when a solver includes the order in a batch;
 * track it via {@link getCowOrderStatus}.
 *
 * @module cow/order
 */

import type { Hex } from 'viem'

import { cowApiRequest, resolveCowApiUrl } from './api'
import {
  APP_DATA_DOC,
  APP_DATA_HASH,
  COW_CANCELLATION_TYPES,
  COW_ORDER_TYPES,
  cowDomain,
} from './eip712'
import type { CancelCowOrderParams, CowOrderResult, SignAndSubmitCowOrderParams } from './types'

/**
 * Build the final order from a quote, sign it (EIP-712) and POST it to the
 * order book. The signed `feeAmount` is 0 — the fee is already folded into the
 * quote's `orderSellAmount`.
 */
export async function signAndSubmitCowOrder(
  params: SignAndSubmitCowOrderParams,
): Promise<CowOrderResult> {
  const { walletClient, account, chainId, quote, receiver = account, apiUrl } = params
  const baseUrl = resolveCowApiUrl(chainId, apiUrl)

  const order = {
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    receiver,
    sellAmount: quote.orderSellAmount,
    buyAmount: quote.orderBuyAmount,
    validTo: Number(quote.validTo),
    appData: APP_DATA_HASH,
    feeAmount: 0n,
    kind: quote.kind,
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  } as const

  const signature = await walletClient.signTypedData({
    account,
    domain: cowDomain(chainId),
    types: COW_ORDER_TYPES,
    primaryType: 'Order',
    message: order,
  })

  const orderUid = await cowApiRequest<Hex>(baseUrl, '/orders', {
    method: 'POST',
    body: JSON.stringify({
      ...order,
      sellAmount: order.sellAmount.toString(),
      buyAmount: order.buyAmount.toString(),
      feeAmount: '0',
      // Full appData document so the API can verify it against the signed hash.
      appData: APP_DATA_DOC,
      appDataHash: APP_DATA_HASH,
      signingScheme: 'eip712',
      signature,
      from: account,
      quoteId: quote.quoteId ?? undefined,
    }),
  })

  return { orderUid }
}

/**
 * Cancel an open order off-chain (free, signed cancellation). Cancellation is
 * best-effort: an order already committed to a solver batch can still settle.
 */
export async function cancelCowOrder(params: CancelCowOrderParams): Promise<void> {
  const { walletClient, account, chainId, orderUid, apiUrl } = params
  const baseUrl = resolveCowApiUrl(chainId, apiUrl)

  const signature = await walletClient.signTypedData({
    account,
    domain: cowDomain(chainId),
    types: COW_CANCELLATION_TYPES,
    primaryType: 'OrderCancellations',
    message: { orderUids: [orderUid] },
  })

  await cowApiRequest<void>(baseUrl, '/orders', {
    method: 'DELETE',
    body: JSON.stringify({ orderUids: [orderUid], signature, signingScheme: 'eip712' }),
  })
}
