import type { Hex } from 'viem'
import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { describe, expect, it } from 'vitest'

import { Multicall3Abi } from '../../../abis/multicall3'
import { panopticLiquidatorAbi, panopticPoolV2Abi, panopticQueryAbi } from '../../../generated'
import { PanopticError } from '../errors/base'
import { emptyLiquidateParams, quoteLiquidation, screenAccountExact } from './index'

const POOL = '0x1000000000000000000000000000000000000001' as const
const QUERY = '0x2000000000000000000000000000000000000002' as const
const HELPER = '0x3000000000000000000000000000000000000003' as const
const OWNER = '0x4000000000000000000000000000000000000004' as const
const ALICE = '0x5000000000000000000000000000000000000005' as const

describe('emptyLiquidateParams', () => {
  it('zeroes every optional route and floor', () => {
    const p = emptyLiquidateParams(POOL, ALICE, [1n, 2n])
    expect(p.pool).toBe(POOL)
    expect(p.account).toBe(ALICE)
    expect(p.positionIdListTo).toEqual([1n, 2n])
    expect(p.flashAmount).toBe(0n)
    expect(p.nativeFundingAmount).toBe(0n)
    expect(p.preSwapTarget).toBe('0x0000000000000000000000000000000000000000')
    expect(p.minDelta0).toBe(0n)
    expect(p.minDelta1).toBe(0n)
  })
})

/** Build a fake client whose call() answers Multicall3.blockAndAggregate. */
function mockAggregateClient(
  answer: (target: string, callData: Hex) => Hex,
  onBlockNumber?: (blockNumber: bigint | undefined) => void,
  blockHashForCall: (callIndex: number) => Hex = () => `0x${'ab'.repeat(32)}`,
) {
  let callIndex = 0
  return {
    call: async ({ data, blockNumber }: { to: string; data: Hex; blockNumber?: bigint }) => {
      onBlockNumber?.(blockNumber)
      const decoded = decodeFunctionData({ abi: Multicall3Abi, data })
      if (decoded.functionName !== 'blockAndAggregate') throw new Error('unexpected call')
      const calls = decoded.args[0] as readonly { target: string; callData: Hex }[]
      const results = calls.map((c) => {
        // The trailing call readBlockAndAggregate appends for the timestamp.
        const inner = decodeSafe(c.callData)
        if (inner === 'getCurrentBlockTimestamp') {
          return {
            success: true,
            returnData: encodeFunctionResult({
              abi: Multicall3Abi,
              functionName: 'getCurrentBlockTimestamp',
              result: 1_700_000_000n,
            }),
          }
        }
        return { success: true, returnData: answer(c.target, c.callData) }
      })
      return {
        data: encodeFunctionResult({
          abi: Multicall3Abi,
          functionName: 'blockAndAggregate',
          result: [12345n, blockHashForCall(callIndex++), results],
        }),
      }
    },
  }
}

function decodeSafe(callData: Hex): string {
  for (const abi of [Multicall3Abi, panopticPoolV2Abi, panopticQueryAbi] as const) {
    try {
      return decodeFunctionData({ abi, data: callData }).functionName
    } catch {
      /* try next */
    }
  }
  return 'unknown'
}

const oracleTicks = encodeFunctionResult({
  abi: panopticPoolV2Abi,
  functionName: 'getOracleTicks',
  result: [100, 200, 999, 300, 0n], // current, spot, median (ignored), latest
})
const twap = encodeFunctionResult({
  abi: panopticPoolV2Abi,
  functionName: 'getTWAP',
  result: 400,
})

function solvencyAnswer(solventTicks: Set<number>) {
  return (target: string, callData: Hex): Hex => {
    const decoded = decodeFunctionData({
      abi: target === POOL ? panopticPoolV2Abi : panopticQueryAbi,
      data: callData,
    })
    if (decoded.functionName === 'getOracleTicks') return oracleTicks
    if (decoded.functionName === 'getTWAP') return twap
    if (decoded.functionName === 'isAccountSolvent') {
      const args = decoded.args ?? []
      if (args.length < 4) throw new Error('isAccountSolvent expects 4 args')
      const atTick = args[3] as number
      return encodeFunctionResult({
        abi: panopticQueryAbi,
        functionName: 'isAccountSolvent',
        result: solventTicks.has(atTick),
      })
    }
    throw new Error(`unexpected ${decoded.functionName}`)
  }
}

describe('screenAccountExact', () => {
  it('uses [spot, twap, latest, current] — twap replaces medianTick', async () => {
    const seenTicks: number[] = []
    const client = mockAggregateClient((target, callData) => {
      const decoded = decodeFunctionData({
        abi: target === POOL ? panopticPoolV2Abi : panopticQueryAbi,
        data: callData,
      })
      if (decoded.functionName === 'isAccountSolvent' && decoded.args !== undefined) {
        seenTicks.push(decoded.args[3] as number)
      }
      return solvencyAnswer(new Set())(target, callData)
    })

    const result = await screenAccountExact({
      client: client as never,
      poolAddress: POOL,
      queryAddress: QUERY,
      account: ALICE,
      tokenIds: [7n],
    })

    expect(seenTicks).toEqual([200, 400, 300, 100]) // spot, twap, latest, current — never 999
    expect(result.ticks).toEqual({
      spotTick: 200n,
      twapTick: 400n,
      latestTick: 300n,
      currentTick: 100n,
    })
    expect(result.isLiquidatable).toBe(true)
    expect(result._meta.blockNumber).toBe(12345n)
  })

  it('partial insolvency is NOT liquidatable (pool reverts NotMarginCalled)', async () => {
    const client = mockAggregateClient(solvencyAnswer(new Set([400]))) // solvent at twap only
    const result = await screenAccountExact({
      client: client as never,
      poolAddress: POOL,
      queryAddress: QUERY,
      account: ALICE,
      tokenIds: [7n],
    })
    expect(result.solventAt).toEqual([false, true, false, false])
    expect(result.isLiquidatable).toBe(false)
  })

  it('pins phase 2 to phase 1 block', async () => {
    const pins: (bigint | undefined)[] = []
    const client = mockAggregateClient(solvencyAnswer(new Set()), (bn) => pins.push(bn))
    await screenAccountExact({
      client: client as never,
      poolAddress: POOL,
      queryAddress: QUERY,
      account: ALICE,
      tokenIds: [7n],
    })
    expect(pins).toEqual([undefined, 12345n]) // phase 1 latest, phase 2 pinned
  })
})

describe('screenAccountExact error paths', () => {
  it('rejects with PanopticError when the pinned block hash changes between phases', async () => {
    const client = mockAggregateClient(
      solvencyAnswer(new Set()),
      undefined,
      (callIndex) => `0x${(callIndex === 0 ? 'ab' : 'cd').repeat(32)}`,
    )

    await expect(
      screenAccountExact({
        client: client as never,
        poolAddress: POOL,
        queryAddress: QUERY,
        account: ALICE,
        tokenIds: [7n],
      }),
    ).rejects.toBeInstanceOf(PanopticError)
  })

  it('rejects when a sub-call fails (requireReturnData)', async () => {
    const client = {
      call: async ({ data }: { data: Hex }) => {
        const decoded = decodeFunctionData({ abi: Multicall3Abi, data })
        const calls = decoded.args[0] as readonly { callData: Hex }[]
        const results = calls.map(() => ({ success: false, returnData: '0x' as Hex }))
        return {
          data: encodeFunctionResult({
            abi: Multicall3Abi,
            functionName: 'blockAndAggregate',
            result: [1n, `0x${'ab'.repeat(32)}` as Hex, results],
          }),
        }
      },
    }
    await expect(
      screenAccountExact({
        client: client as never,
        poolAddress: POOL,
        queryAddress: QUERY,
        account: ALICE,
        tokenIds: [7n],
      }),
    ).rejects.toThrow()
  })
})

describe('quoteLiquidation', () => {
  it('rejects when the eth_call returns no data', async () => {
    const client = { call: async () => ({ data: undefined }) }
    await expect(
      quoteLiquidation({
        client: client as never,
        liquidatorAddress: HELPER,
        owner: OWNER,
        params: emptyLiquidateParams(POOL, ALICE, [7n]),
      }),
    ).rejects.toThrow('no data')
  })

  it('calls from the owner and decodes the six outputs', async () => {
    let captured: { account?: unknown; to?: unknown; stateOverride?: unknown } = {}
    const client = {
      call: async (args: Record<string, unknown>) => {
        captured = args
        return {
          data: encodeFunctionResult({
            abi: panopticLiquidatorAbi,
            functionName: 'quoteLiquidation',
            result: [-5n, 10n, 5n, 0n, 1n, 2n],
          }),
        }
      },
    }

    const quote = await quoteLiquidation({
      client: client as never,
      liquidatorAddress: HELPER,
      owner: OWNER,
      params: emptyLiquidateParams(POOL, ALICE, [7n]),
      stateOverride: [{ address: HELPER, balance: 123n }],
    })

    expect(captured.account).toBe(OWNER)
    expect(captured.to).toBe(HELPER)
    expect(captured.stateOverride).toEqual([{ address: HELPER, balance: 123n }])
    expect(quote).toEqual({
      bonus0: -5n,
      bonus1: 10n,
      shortfall0: 5n,
      shortfall1: 0n,
      protocolLoss0: 1n,
      protocolLoss1: 2n,
    })
  })
})
