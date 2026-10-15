import { type PublicClient, createPublicClient, custom } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { quoteSwapExactOutViaV3Router } from '../../../uniswap/v3/router'
import { quoteSwapExactOutViaRouter } from '../../../uniswap/v4/router'
import { NotEnoughTokensError, PanopticError } from '../errors'
import { getPoolMetadata } from '../reads/pool'
import { quoteTokenShortfallSwap } from './quoteTokenShortfallSwap'

vi.mock('../../../uniswap/v3/router', () => ({ quoteSwapExactOutViaV3Router: vi.fn() }))
vi.mock('../../../uniswap/v4/router', () => ({ quoteSwapExactOutViaRouter: vi.fn() }))
vi.mock('../reads/pool', () => ({ getPoolMetadata: vi.fn() }))

const token0 = '0x0000000000000000000000000000000000000010'
const token1 = '0x0000000000000000000000000000000000000011'
const tracker0 = '0x0000000000000000000000000000000000000020'
const tracker1 = '0x0000000000000000000000000000000000000021'
const poolAddress = '0x0000000000000000000000000000000000000030'
const client: PublicClient = createPublicClient({ transport: custom({ request: vi.fn() }) })
const meta = { blockNumber: 1n, blockTimestamp: 2n, blockHash: '0x01' as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPoolMetadata).mockResolvedValue({
    token0Asset: token0,
    token1Asset: token1,
    collateralToken0Address: tracker0,
    collateralToken1Address: tracker1,
    token0Symbol: 'USDC',
    token1Symbol: 'WETH',
    token0Decimals: 6n,
    token1Decimals: 18n,
    isV4: false,
    poolKeyBytes: '0x',
    poolId: 1n,
    riskEngineAddress: poolAddress,
    token0Name: 'USD Coin',
    token1Name: 'Wrapped Ether',
    underlyingPoolId: poolAddress,
    tickSpacing: 10n,
    fee: 500n,
    sfpmAddress: poolAddress,
  })
})

describe('quoteTokenShortfallSwap', () => {
  it.each([false, true])(
    'quotes either ordering and underlying or collateral tokens for v4=%s',
    async (isV4) => {
      vi.mocked(getPoolMetadata).mockResolvedValue({
        ...(await getPoolMetadata({ client, poolAddress })),
        isV4,
      })
      const quoteFn = isV4 ? quoteSwapExactOutViaRouter : quoteSwapExactOutViaV3Router
      for (const address of [token0, token1, tracker0, tracker1] as const) {
        const output0 = address === token0 || address === tracker0
        vi.mocked(quoteFn).mockResolvedValue({
          success: true,
          gasEstimate: 30n,
          data: {
            amountIn: 123n,
            amountInMaximum: 124n,
            tokenOut: output0 ? token0 : token1,
            zeroForOne: !output0,
            gasEstimate: 30n,
          },
          _meta: meta,
        })
        const result = await quoteTokenShortfallSwap({
          client,
          poolAddress,
          chainId: 1n,
          error: new NotEnoughTokensError(address, 20n, 8n),
        })
        expect(quoteFn).toHaveBeenLastCalledWith(
          expect.objectContaining({
            tokenIn: output0 ? token1 : token0,
            amountOut: 12n,
            slippageBps: 50n,
          }),
        )
        expect(result).toMatchObject({
          poolFeePips: 500n,
          estimatedPoolFee: 1n,
          deficit: 12n,
          outputSymbol: output0 ? 'USDC' : 'WETH',
          outputDecimals: output0 ? 6n : 18n,
          inputSymbol: output0 ? 'WETH' : 'USDC',
          quote: { amountIn: 123n, amountInMaximum: 124n },
        })
      }
    },
  )

  it('keeps the deficit when the quote fails', async () => {
    vi.mocked(quoteSwapExactOutViaV3Router).mockResolvedValue({
      success: false,
      error: new PanopticError('No liquidity'),
      _meta: meta,
    })
    expect(
      await quoteTokenShortfallSwap({
        client,
        poolAddress,
        chainId: 1n,
        error: new NotEnoughTokensError(token0, 20n, 8n),
      }),
    ).toMatchObject({ deficit: 12n, outputSymbol: 'USDC', quote: null })
  })

  it('does not quote incomplete errors, zero deficits, or unrelated tokens', async () => {
    for (const error of [
      new Error('unrelated'),
      new NotEnoughTokensError(token0, 8n, 20n),
      new NotEnoughTokensError(poolAddress, 20n, 8n),
    ]) {
      expect(await quoteTokenShortfallSwap({ client, poolAddress, chainId: 1n, error })).toBeNull()
    }
    expect(quoteSwapExactOutViaV3Router).not.toHaveBeenCalled()
  })
})
