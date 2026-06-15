/**
 * Poll order state from the CoW order book.
 * @module cow/status
 */

import type { Hex } from 'viem'

import { cowApiRequest, resolveCowApiUrl } from './api'
import type { CowOrderState, CowOrderStatus, GetCowOrderStatusParams } from './types'

/** Raw `GET /orders/{uid}` fields we consume. */
interface CowOrderResponse {
  status: CowOrderStatus
  executedSellAmount: string
  executedBuyAmount: string
}

/** Raw `GET /trades` entry fields we consume. */
interface CowTradeResponse {
  txHash: Hex | null
}

/**
 * Fetch an order's lifecycle state. Once any trade has executed, the
 * settlement tx hash is included (fetched from the trades endpoint).
 */
export async function getCowOrderStatus(params: GetCowOrderStatusParams): Promise<CowOrderState> {
  const { chainId, orderUid, apiUrl } = params
  const baseUrl = resolveCowApiUrl(chainId, apiUrl)

  const order = await cowApiRequest<CowOrderResponse>(baseUrl, `/orders/${orderUid}`)

  const executedSellAmount = BigInt(order.executedSellAmount ?? '0')
  const executedBuyAmount = BigInt(order.executedBuyAmount ?? '0')

  let settlementTxHash: Hex | undefined
  if (executedBuyAmount > 0n) {
    const trades = await cowApiRequest<CowTradeResponse[]>(baseUrl, `/trades?orderUid=${orderUid}`)
    settlementTxHash = trades.find((t) => t.txHash)?.txHash ?? undefined
  }

  return { status: order.status, executedSellAmount, executedBuyAmount, settlementTxHash }
}
