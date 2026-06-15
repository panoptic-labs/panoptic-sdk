import { afterEach, describe, expect, it, vi } from 'vitest'

import { COW_NATIVE_ETH } from './addresses'
import { CowNativeTokenError, CowOrderTooSmallError, CowUnsupportedChainError } from './errors'
import { quoteCowSwap } from './quote'

const SELL_TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const // USDC
const BUY_TOKEN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const // WETH
const FROM = '0x1111111111111111111111111111111111111111' as const

function mockQuoteResponse(quote: Record<string, unknown>, id: number | null = 42) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ quote, id }), { status: 200 }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quoteCowSwap', () => {
  it('sell order: folds fee into sell side and applies slippage to buy side', async () => {
    const fetchMock = mockQuoteResponse({
      sellToken: SELL_TOKEN,
      buyToken: BUY_TOKEN,
      sellAmount: '1000000',
      buyAmount: '500000000000000000',
      feeAmount: '5000',
      validTo: 1750000000,
      kind: 'sell',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quoteCowSwap({
      chainId: 1n,
      sellToken: SELL_TOKEN,
      buyToken: BUY_TOKEN,
      kind: 'sell',
      amount: 1005000n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.sellAmountTotal).toBe(1005000n)
    expect(result.data.orderSellAmount).toBe(1005000n)
    // 0.5 ETH minus 0.5% slippage.
    expect(result.data.orderBuyAmount).toBe(497500000000000000n)
    expect(result.data.quoteId).toBe(42)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.kind).toBe('sell')
    expect(body.sellAmountBeforeFee).toBe('1005000')
    expect(body.signingScheme).toBe('eip712')
  })

  it('buy order: pads gross sell amount by slippage with ceiling division', async () => {
    vi.stubGlobal(
      'fetch',
      mockQuoteResponse({
        sellToken: SELL_TOKEN,
        buyToken: BUY_TOKEN,
        sellAmount: '999',
        buyAmount: '1000000',
        feeAmount: '2',
        validTo: 1750000000,
        kind: 'buy',
      }),
    )

    const result = await quoteCowSwap({
      chainId: 1n,
      sellToken: SELL_TOKEN,
      buyToken: BUY_TOKEN,
      kind: 'buy',
      amount: 1000000n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.orderBuyAmount).toBe(1000000n)
    // (999 + 2) * 10050 / 10000 = 1006.005 → ceil → 1007
    expect(result.data.orderSellAmount).toBe(1007n)
  })

  it('maps SellAmountDoesNotCoverFee to CowOrderTooSmallError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ errorType: 'SellAmountDoesNotCoverFee', description: 'too small' }),
            { status: 400 },
          ),
        ),
    )

    const result = await quoteCowSwap({
      chainId: 1n,
      sellToken: SELL_TOKEN,
      buyToken: BUY_TOKEN,
      kind: 'sell',
      amount: 1n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBeInstanceOf(CowOrderTooSmallError)
  })

  it('rejects unsupported chains', async () => {
    const result = await quoteCowSwap({
      chainId: 130n, // unichain — no CoW order book
      sellToken: SELL_TOKEN,
      buyToken: BUY_TOKEN,
      kind: 'sell',
      amount: 1000n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBeInstanceOf(CowUnsupportedChainError)
  })

  it('rejects a native (zero-address) sell token', async () => {
    const result = await quoteCowSwap({
      chainId: 1n,
      sellToken: '0x0000000000000000000000000000000000000000',
      buyToken: BUY_TOKEN,
      kind: 'sell',
      amount: 1000n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBeInstanceOf(CowNativeTokenError)
  })

  it('maps a native (zero-address) buy token to the CoW ETH sentinel', async () => {
    const fetchMock = mockQuoteResponse({
      sellToken: SELL_TOKEN,
      buyToken: COW_NATIVE_ETH,
      sellAmount: '1000000',
      buyAmount: '500000000000000000',
      feeAmount: '5000',
      validTo: 1750000000,
      kind: 'sell',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await quoteCowSwap({
      chainId: 1n,
      sellToken: SELL_TOKEN,
      buyToken: '0x0000000000000000000000000000000000000000',
      kind: 'sell',
      amount: 1005000n,
      from: FROM,
      slippageBps: 50n,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    // The signed order must carry the sentinel, not the zero address.
    expect(result.data.buyToken).toBe(COW_NATIVE_ETH)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.buyToken).toBe(COW_NATIVE_ETH)
  })
})
