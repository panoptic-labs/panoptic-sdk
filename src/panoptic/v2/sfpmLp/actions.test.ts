/**
 * Unit tests for direct-LP reads, call preparation, simulation, and writes.
 * @module v2/sfpmLp/actions.test
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeFunctionData,
  encodeFunctionResult,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import {
  type SfpmLpTarget,
  closeSfpmLpPosition,
  createSfpmLpPosition,
  prepareSfpmLpCall,
  simulateSfpmLp,
} from './actions'
import {
  type SfpmLpRange,
  buildSfpmLpTokenId,
  decodeSfpmLpLegs,
  minSfpmLpPositionSize,
  sfpmLpLegLiquidity,
} from './position'
import { getSfpmLpPosition } from './reads'

const SFPM: Address = '0x1111111111111111111111111111111111111111'
const POOL: Address = '0x2222222222222222222222222222222222222222'
const ACCOUNT: Address = '0x3333333333333333333333333333333333333333'
const TX_HASH: Hex = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
const POOL_ID = 0xa0488e6a0c2ddn
const CURRENT_TICK = 200_020
const Q64 = 1n << 64n

const ranges: SfpmLpRange[] = [
  { tickLower: 200_000n, tickUpper: 200_100n, asset: 0n },
  { tickLower: 199_500n, tickUpper: 200_050n, asset: 1n },
]
const tokenId = buildSfpmLpTokenId({ poolId: POOL_ID, ranges })
const legs = decodeSfpmLpLegs(tokenId)
const target: SfpmLpTarget = {
  sfpmAddress: SFPM,
  poolAddress: POOL,
  tokenId,
  tickLimitLow: 199_000n,
  tickLimitHigh: 201_000n,
}

interface AccountState {
  balance: bigint
  /** Net liquidity per leg chunk. */
  netLiquidity: bigint[]
  /** Fees accrued per leg chunk since the last touch, as [token0, token1]. */
  pendingFees?: [bigint, bigint][]
}

/** A client whose SFPM views answer from `state`. */
function createClient(state: AccountState, callResult?: Hex): PublicClient {
  const multicall = vi.fn(
    ({ contracts }: { contracts: { functionName: string; args: unknown[] }[] }) =>
      Promise.resolve(
        contracts.map(({ functionName, args }, i) => {
          if (functionName === 'balanceOf') return state.balance
          if (functionName === 'getCurrentTick') return CURRENT_TICK
          if (functionName === 'getAccountLiquidity') return state.netLiquidity[i] ?? 0n
          const [fees0, fees1] = state.pendingFees?.[i] ?? [0n, 0n]
          const net = state.netLiquidity[i] ?? 0n
          const isLive = args[5] === CURRENT_TICK
          const base = 5n * Q64
          return isLive && net > 0n
            ? [base + (fees0 * Q64) / net, base + (fees1 * Q64) / net]
            : [base, base]
        }),
      ),
  )
  return {
    getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: TX_HASH, timestamp: 1_700_000_000n }),
    multicall,
    call: vi.fn().mockResolvedValue({ data: callResult }),
    estimateContractGas: vi.fn().mockResolvedValue(500_000n),
  } as unknown as PublicClient
}

function decodeSteps(data: Hex) {
  const { args } = decodeFunctionData({ abi: sfpmV3Abi, data })
  const calls = args?.[0]
  if (!Array.isArray(calls)) throw new Error('not a multicall')
  return calls.map((call: Hex) => decodeFunctionData({ abi: sfpmV3Abi, data: call }))
}

function packLeftRight(right: bigint, left: bigint): bigint {
  const slot = (value: bigint) => (value < 0n ? value + (1n << 128n) : value)
  const packed = (slot(left) << 128n) | slot(right)
  return packed >= 1n << 255n ? packed - (1n << 256n) : packed
}

describe('getSfpmLpPosition', () => {
  it('reports chunk fees and attributes them pro rata when a chunk is shared', async () => {
    const balance = 4_000_000n
    const own = legs.map((leg) => sfpmLpLegLiquidity(leg, balance))
    const netLiquidity = [own[0] ?? 0n, (own[1] ?? 0n) * 4n]
    const client = createClient({
      balance,
      netLiquidity,
      pendingFees: [
        [1_000_000n, 2_000_000n],
        [8_000_000n, 0n],
      ],
    })

    const position = await getSfpmLpPosition({ client, account: ACCOUNT, ...target })

    expect(position.positionSize).toBe(balance)
    expect(position.currentTick).toBe(BigInt(CURRENT_TICK))
    const [sole, shared] = position.legs
    expect(sole?.liquidity).toBe(own[0])
    expect(sole?.chunk.pendingFees0).toBeGreaterThan(999_990n)
    expect(sole?.chunk.pendingFees0).toBeLessThanOrEqual(1_000_000n)
    expect(sole?.attributedFees0).toBe(sole?.chunk.pendingFees0)
    expect(sole?.attributedFees1).toBe(sole?.chunk.pendingFees1)

    expect(shared?.chunk.netLiquidity).toBe(netLiquidity[1])
    expect(shared?.chunk.pendingFees0).toBeGreaterThan(7_999_990n)
    expect(shared?.attributedFees0).toBe((shared?.chunk.pendingFees0 ?? 0n) / 4n)
    expect(shared?.chunk.pendingFees1).toBe(0n)
  })
})

describe('prepareSfpmLpCall', () => {
  const prepare = (
    state: AccountState,
    action: Parameters<typeof prepareSfpmLpCall>[0]['action'],
  ) => prepareSfpmLpCall({ client: createClient(state), account: ACCOUNT, ...target, action })
  const empty: AccountState = { balance: 0n, netLiquidity: [0n, 0n] }

  it('encodes an increase as one mint with ordered tick limits', async () => {
    const call = await prepare(empty, { kind: 'increase', positionSize: 1_000_000n })

    expect(call.to).toBe(SFPM)
    const [mint] = decodeSteps(call.data)
    expect(mint?.functionName).toBe('mintTokenizedPosition')
    expect(mint?.args?.slice(1)).toEqual([tokenId, 1_000_000n, 199_000, 201_000])
  })

  it('rejects sizes that round to zero liquidity and unordered tick limits', async () => {
    await expect(
      prepare(empty, { kind: 'increase', positionSize: minSfpmLpPositionSize(legs) - 1n }),
    ).rejects.toThrow(/rounds to zero liquidity/)
    await expect(
      prepareSfpmLpCall({
        client: createClient(empty),
        account: ACCOUNT,
        ...target,
        tickLimitLow: 201_000n,
        tickLimitHigh: 199_000n,
        action: { kind: 'increase', positionSize: 1_000_000n },
      }),
    ).rejects.toThrow(/Invalid tick limits/)
  })

  it('burns a partial decrease in one call and rejects more than the balance', async () => {
    const balance = 4_000_000n
    const state = { balance, netLiquidity: legs.map((leg) => sfpmLpLegLiquidity(leg, balance)) }

    const call = await prepare(state, { kind: 'decrease', positionSize: 1_500_000n })
    expect(call.steps.map((step) => [step.functionName, step.size])).toEqual([
      ['burnTokenizedPosition', 1_500_000n],
    ])
    expect(call.unburnableSize).toBe(0n)

    await expect(prepare(state, { kind: 'decrease', positionSize: balance + 1n })).rejects.toThrow(
      /holds 4000000/,
    )
  })

  it('closes the whole balance and keeps every burn within the chunk liquidity', async () => {
    const sizes = [1_000_003n, 777_777n, 2_222_221n]
    const balance = sizes.reduce((a, b) => a + b, 0n)
    const netLiquidity = legs.map((leg) =>
      sizes.reduce((sum, size) => sum + sfpmLpLegLiquidity(leg, size), 0n),
    )

    const call = await prepare({ balance, netLiquidity }, { kind: 'close' })

    expect(call.steps.every((step) => step.functionName === 'burnTokenizedPosition')).toBe(true)
    expect(call.steps.reduce((sum, step) => sum + step.size, 0n) + call.unburnableSize).toBe(
      balance,
    )
    legs.forEach((leg, i) => {
      const burned = call.steps.reduce((sum, step) => sum + sfpmLpLegLiquidity(leg, step.size), 0n)
      expect(burned).toBeLessThanOrEqual(netLiquidity[i] ?? 0n)
    })
  })

  it('rejects closing an empty position', async () => {
    await expect(prepare(empty, { kind: 'close' })).rejects.toThrow(/holds 0/)
  })

  it('collects fees with a minimum-size mint followed by the matching burn', async () => {
    const state = { balance: 1_000_000n, netLiquidity: [10n ** 15n, 10n ** 15n] }
    const call = await prepare(state, { kind: 'collect' })
    const min = minSfpmLpPositionSize(legs)

    expect(call.steps.map((step) => [step.functionName, step.size])).toEqual([
      ['mintTokenizedPosition', min],
      ['burnTokenizedPosition', min],
    ])
    await expect(prepare(empty, { kind: 'collect' })).rejects.toThrow(/no fees to collect/)
  })
})

describe('simulateSfpmLp', () => {
  const stepResult = (
    functionName: 'mintTokenizedPosition' | 'burnTokenizedPosition',
    moved: bigint,
    fees: bigint,
  ) =>
    encodeFunctionResult({
      abi: sfpmV3Abi,
      functionName,
      result: [[fees, 0n, 0n, 0n], moved, CURRENT_TICK],
    })

  it('nets moved tokens against collected fees across steps', async () => {
    const callResult = encodeFunctionResult({
      abi: sfpmV3Abi,
      functionName: 'multicall',
      result: [
        stepResult('mintTokenizedPosition', packLeftRight(10n, 20n), packLeftRight(700n, 300n)),
        stepResult('burnTokenizedPosition', packLeftRight(-9n, -19n), 0n),
      ],
    })
    const client = createClient(
      { balance: 1_000_000n, netLiquidity: [10n ** 15n, 10n ** 15n] },
      callResult,
    )

    const result = await simulateSfpmLp({
      client,
      account: ACCOUNT,
      ...target,
      action: { kind: 'collect' },
    })

    if (!result.success) throw result.error
    expect(result.data).toMatchObject({
      amount0: 1n - 700n,
      amount1: 1n - 300n,
      fees0: 700n,
      fees1: 300n,
      finalTick: BigInt(CURRENT_TICK),
    })
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, to: SFPM, data: result.data.call.data }),
    )
  })

  it('returns validation failures as a failed simulation', async () => {
    const result = await simulateSfpmLp({
      client: createClient({ balance: 0n, netLiquidity: [0n, 0n] }),
      account: ACCOUNT,
      ...target,
      action: { kind: 'close' },
    })
    expect(result.success).toBe(false)
  })
})

describe('direct-LP writes', () => {
  const createWallet = () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH)
    return { walletClient: { writeContract } as unknown as WalletClient, writeContract }
  }

  it('creates a position from ranges and returns its token ID', async () => {
    const { walletClient, writeContract } = createWallet()
    const result = await createSfpmLpPosition({
      client: createClient({ balance: 0n, netLiquidity: [0n, 0n] }),
      walletClient,
      account: ACCOUNT,
      sfpmAddress: SFPM,
      poolAddress: POOL,
      poolId: POOL_ID,
      ranges,
      positionSize: 1_000_000n,
      tickLimitLow: 199_000n,
      tickLimitHigh: 201_000n,
    })

    expect(result.tokenId).toBe(tokenId)
    expect(result.hash).toBe(TX_HASH)
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: SFPM, functionName: 'multicall' }),
    )
  })

  it('sends a close as the prepared multicall', async () => {
    const { walletClient, writeContract } = createWallet()
    const balance = 2_000_000n
    const state = { balance, netLiquidity: legs.map((leg) => sfpmLpLegLiquidity(leg, balance)) }
    const expected = await prepareSfpmLpCall({
      client: createClient(state),
      account: ACCOUNT,
      ...target,
      action: { kind: 'close' },
    })

    const result = await closeSfpmLpPosition({
      client: createClient(state),
      walletClient,
      account: ACCOUNT,
      ...target,
    })

    expect(result.hash).toBe(TX_HASH)
    expect(result.unburnableSize).toBe(expected.unburnableSize)

    expect(writeContract.mock.calls[0]?.[0].args).toEqual([expected.steps.map((step) => step.data)])
  })
})
