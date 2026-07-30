/**
 * Quote an SFPM off-venue swap by simulating the actual multicall.
 * @module v2/sfpmSwap/quote
 */
import { type Address, type PublicClient, type StateOverride, decodeFunctionResult } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError, parsePanopticError } from '../errors'
import type { SimulationResult } from '../types'
import { buildSfpmSwapCalldata } from './calldata'
import type { SfpmSwapPlan, SfpmSwapQuote } from './types'

const UINT128 = 1n << 128n
const INT128_MAX = (1n << 127n) - 1n

/** Extract the two signed 128-bit slots from a packed `LeftRightSigned` int256. */
function unpackLeftRightSigned(packed: bigint): { right: bigint; left: bigint } {
  const u = packed < 0n ? packed + (1n << 256n) : packed
  const toInt128 = (half: bigint): bigint => (half > INT128_MAX ? half - UINT128 : half)
  return {
    right: toInt128(u & (UINT128 - 1n)), // token0
    left: toInt128((u >> 128n) & (UINT128 - 1n)), // token1
  }
}

/** Wrap an unknown thrown value as a PanopticError, decoding Panoptic reverts when possible. */
function toPanopticError(err: unknown): PanopticError {
  if (err instanceof PanopticError) return err
  const parsed = parsePanopticError(err)
  if (parsed) return parsed.error
  return new PanopticError(
    err instanceof Error ? err.message : 'SFPM swap simulation failed',
    err instanceof Error ? err : undefined,
  )
}

export interface QuoteSfpmSwapParams {
  client: PublicClient
  /** Plan from {@link buildSfpmSwapPlan}. */
  plan: SfpmSwapPlan
  /** Caller executing the swap (the Safe in production); must hold the input token. */
  account: Address
  /**
   * Optional viem state overrides — e.g. to grant the input-token allowance to the
   * SFPM and/or fund the account so the quote works before approvals exist. In
   * production (Safe already approved + funded) this can be omitted.
   */
  stateOverride?: StateOverride
  blockNumber?: bigint
}

/**
 * Quote a swap by simulating `SFPM.multicall([mint, burn])` and decoding the swap
 * call's `totalMoved` return. Authoritative — captures the width-0 loan-leg wei
 * rounding a raw QuoterV2 quote would miss.
 */
export async function quoteSfpmSwap(
  params: QuoteSfpmSwapParams,
): Promise<SimulationResult<SfpmSwapQuote>> {
  const { client, plan, account, stateOverride, blockNumber } = params
  const { mintData, burnData } = buildSfpmSwapCalldata(plan)
  const _meta = await getBlockMeta({ client, blockNumber })

  try {
    const { result } = await client.simulateContract({
      account,
      address: plan.sfpmAddress,
      abi: sfpmV3Abi,
      functionName: 'multicall',
      args: [[mintData, burnData]],
      blockNumber,
      stateOverride,
    })

    const swapIndex = plan.swapOn === 'mint' ? 0 : 1
    const decoded = decodeFunctionResult({
      abi: sfpmV3Abi,
      functionName: plan.swapOn === 'mint' ? 'mintTokenizedPosition' : 'burnTokenizedPosition',
      data: (result as readonly `0x${string}`[])[swapIndex],
    }) as readonly [readonly bigint[], bigint, number]

    const finalTick = Number(decoded[2])
    const { right, left } = unpackLeftRightSigned(decoded[1])
    const inSlot = [right, left].find((s) => s > 0n)
    const outSlot = [right, left].find((s) => s < 0n)
    if (inSlot === undefined || outSlot === undefined) {
      return {
        success: false,
        error: new PanopticError(`SFPM swap simulation moved no tokens (totalMoved=${decoded[1]})`),
        _meta,
      }
    }

    return {
      success: true,
      data: { amountIn: inSlot, amountOut: -outSlot, finalTick },
      gasEstimate: 0n,
      _meta,
    }
  } catch (err) {
    return { success: false, error: toPanopticError(err), _meta }
  }
}
