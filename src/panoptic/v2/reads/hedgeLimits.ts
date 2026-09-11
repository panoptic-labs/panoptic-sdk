import type { Address, PublicClient } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi, riskEngineAbi } from '../../../generated'
import { toVaultFrameAtTick } from '../greeks'
import { decodeTokenId } from '../tokenId'
import { decodePositionBalance } from '../writes/utils'
import {
  accountHedgeDelta,
  buildCapacityHedge,
  ceilDiv,
  findHedgeBoundary,
  hedgeMargin,
} from './hedgeCapacity'
import { availableToBorrow, getPoolMetadata } from './pool'

const SCALE = 10_000_000n
const MAX_SIZE = (1n << 127n) - 1n
const MASK128 = (1n << 128n) - 1n
const RANGE = 12_800
const STEP = 400
const SAMPLE_BATCH_SIZE = 32

export interface HedgeLimitEstimate {
  current: {
    tick: number
    affordable: boolean
    reason: 'available' | 'margin' | 'insolvent' | 'capacity' | 'leg-limit'
    delta: bigint
    /** Minimum surplus across both cross-collateral constraints, in quote-token units. */
    headroom: bigint | null
  }
  /** First detected unaffordable tick on either side; null means none in the sampled range. */
  lowerTick: number | null
  upperTick: number | null
  minTick: number
  maxTick: number
  blockNumber: bigint
}

/** Snapshot estimate; prices, balances and requirements share one block, with spot swaps excluding price impact. */
export async function getHedgeLimits({
  client,
  poolAddress,
  account,
  positionIds,
  assetIndex,
  blockNumber: requestedBlock,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIds: readonly bigint[]
  assetIndex: 0n | 1n
  blockNumber?: bigint
}): Promise<HedgeLimitEstimate> {
  if (
    positionIds.length === 0 ||
    positionIds.length > 26 ||
    new Set(positionIds).size !== positionIds.length
  ) {
    throw new Error('Hedge limits require a complete, nonempty list of open positions')
  }
  const blockNumber = requestedBlock ?? (await client.getBlockNumber())
  const metadata = await getPoolMetadata({ client, poolAddress })
  const {
    collateralToken0Address: ct0,
    collateralToken1Address: ct1,
    riskEngineAddress: engine,
  } = metadata
  if (metadata.fee >= 1_000_000n) throw new Error('A fixed swap fee is required for this estimate')
  const [
    full,
    currentTick,
    pool0,
    pool1,
    total0,
    total1,
    interest0,
    interest1,
    buffer,
    notionalFee,
    cross0,
    cross1,
    maxLegs,
    accountLegs,
    supply0,
    supply1,
  ] = await client.multicall({
    contracts: [
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        args: [account, false, positionIds],
      },
      { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'getCurrentTick' },
      { address: ct0, abi: collateralTrackerV2Abi, functionName: 'getPoolData' },
      { address: ct1, abi: collateralTrackerV2Abi, functionName: 'getPoolData' },
      { address: ct0, abi: collateralTrackerV2Abi, functionName: 'totalAssets' },
      { address: ct1, abi: collateralTrackerV2Abi, functionName: 'totalAssets' },
      {
        address: ct0,
        abi: collateralTrackerV2Abi,
        functionName: 'assetsAndInterest',
        args: [account],
      },
      {
        address: ct1,
        abi: collateralTrackerV2Abi,
        functionName: 'assetsAndInterest',
        args: [account],
      },
      { address: engine, abi: riskEngineAbi, functionName: 'BP_DECREASE_BUFFER' },
      { address: engine, abi: riskEngineAbi, functionName: 'NOTIONAL_FEE' },
      { address: engine, abi: riskEngineAbi, functionName: 'CROSS_BUFFER_0' },
      { address: engine, abi: riskEngineAbi, functionName: 'CROSS_BUFFER_1' },
      { address: engine, abi: riskEngineAbi, functionName: 'MAX_OPEN_LEGS' },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'numberOfLegs',
        args: [account],
      },
      { address: ct0, abi: collateralTrackerV2Abi, functionName: 'totalSupply' },
      { address: ct1, abi: collateralTrackerV2Abi, functionName: 'totalSupply' },
    ],
    allowFailure: false,
    blockNumber,
  })
  const [shortPremium, longPremium, balances] = full
  if (
    balances.length !== positionIds.length ||
    balances.some((value) => (value & MASK128) === 0n)
  ) {
    throw new Error('Position snapshot is incomplete; refresh positions and retry')
  }
  const decoded = positionIds.map((id) => decodeTokenId(id).legs)
  const legCount = decoded.reduce((sum, legs) => sum + legs.length, 0)
  if (BigInt(legCount) !== accountLegs) throw new Error('The account position list is incomplete')
  const borrowCapacity = [availableToBorrow(pool0, supply0), availableToBorrow(pool1, supply1)]
  const currentUtilizations = [pool0[3], pool1[3]]
  const globalUtilizations = balances.reduce(
    (result, value) => {
      const decodedBalance = decodePositionBalance(value)
      return [
        result[0] > decodedBalance.poolUtilization0 ? result[0] : decodedBalance.poolUtilization0,
        result[1] > decodedBalance.poolUtilization1 ? result[1] : decodedBalance.poolUtilization1,
      ]
    },
    [0n, 0n],
  )
  const [baseCross0, baseCross1] = await client.multicall({
    contracts: [
      {
        address: engine,
        abi: riskEngineAbi,
        functionName: 'crossBufferRatio',
        args: [globalUtilizations[0], cross0],
      },
      {
        address: engine,
        abi: riskEngineAbi,
        functionName: 'crossBufferRatio',
        args: [globalUtilizations[1], cross1],
      },
    ],
    allowFailure: false,
    blockNumber,
  })
  const [assets, interest] = assetIndex === 0n ? interest0 : interest1
  const premiumShift = assetIndex * 128n
  const collateralDelta =
    (assets > interest ? assets - interest : 0n) +
    ((shortPremium >> premiumShift) & MASK128) -
    ((longPremium >> premiumShift) & MASK128)

  const marginCall = (tick: number, ids: readonly bigint[], positionBalances: readonly bigint[]) =>
    ({
      address: engine,
      abi: riskEngineAbi,
      functionName: 'getMargin',
      args: [positionBalances, tick, account, ids, shortPremium, longPremium, ct0, ct1],
    }) as const

  const evaluate = async (tick: number) => {
    const delta = accountHedgeDelta({
      positionIds,
      balances,
      collateralDelta,
      tick: BigInt(tick),
      tickSpacing: metadata.tickSpacing,
      assetIndex,
    })
    const hedge = buildCapacityHedge({
      delta,
      assetIndex,
      tick: BigInt(tick),
      tickSpacing: metadata.tickSpacing,
      poolId: metadata.poolId,
      notionalFee: BigInt(notionalFee),
      swapFee: metadata.fee,
    })
    const unavailable = (reason: 'capacity' | 'leg-limit') => ({
      tick,
      affordable: false,
      reason,
      delta,
      headroom: null,
    })
    if (hedge.amount > 0n && BigInt(legCount) >= maxLegs) return unavailable('leg-limit')
    const totalAssets = hedge.borrowToken === 0n ? total0 : total1
    if (
      hedge.amount > 0n &&
      (hedge.amount > MAX_SIZE ||
        hedge.amount > borrowCapacity[Number(hedge.borrowToken)] ||
        totalAssets === 0n)
    )
      return unavailable('capacity')
    // Conservatively ignore fee revenue when projecting the tracker's utilization.
    const projectedUtilization = currentUtilizations.map((util, i) =>
      hedge.amount > 0n && BigInt(i) === hedge.borrowToken
        ? ceilDiv(util * totalAssets + hedge.amount * 10_000n, totalAssets)
        : util,
    )
    if (hedge.amount > 0n && projectedUtilization.some((util) => util > 10_000n))
      return unavailable('capacity')
    const global = projectedUtilization.map((util, i) =>
      util > globalUtilizations[i] ? util : globalUtilizations[i],
    )
    const syntheticBalance =
      hedge.amount | (projectedUtilization[0] << 128n) | (projectedUtilization[1] << 144n)
    const hedgedIds = hedge.amount === 0n ? positionIds : [...positionIds, hedge.tokenId]
    const hedgedBalances = hedge.amount === 0n ? balances : [...balances, syntheticBalance]
    const [base, after, ratio0, ratio1] = await client.multicall({
      contracts: [
        marginCall(tick, positionIds, balances),
        marginCall(tick, hedgedIds, hedgedBalances),
        {
          address: engine,
          abi: riskEngineAbi,
          functionName: 'crossBufferRatio',
          args: [global[0], cross0],
        },
        {
          address: engine,
          abi: riskEngineAbi,
          functionName: 'crossBufferRatio',
          args: [global[1], cross1],
        },
      ],
      allowFailure: false,
      blockNumber,
    })
    const before = hedgeMargin({
      tokenData: [base[0], base[1]],
      balanceChanges: [0n, 0n],
      crossRatios: [baseCross0, baseCross1],
      tick: BigInt(tick),
      buffer: SCALE,
    })
    const balanceChanges: [bigint, bigint] =
      hedge.borrowToken === 0n ? [0n, hedge.proceeds] : [hedge.proceeds, 0n]
    const margin = hedgeMargin({
      tokenData: [after[0], after[1]],
      balanceChanges,
      crossRatios: hedge.amount === 0n ? [baseCross0, baseCross1] : [ratio0, ratio1],
      tick: BigInt(tick),
      buffer: hedge.amount === 0n ? SCALE : BigInt(buffer),
    })
    return {
      tick,
      affordable: before.solvent && margin.solvent,
      reason: !before.solvent
        ? ('insolvent' as const)
        : !margin.solvent
          ? ('margin' as const)
          : ('available' as const),
      delta,
      headroom: toVaultFrameAtTick(
        margin.headroom,
        margin.denomination,
        assetIndex === 0n ? 1n : 0n,
        BigInt(tick),
      ),
    }
  }
  const current = await evaluate(currentTick)
  const minTick = Math.max(-887200, currentTick - RANGE)
  const maxTick = Math.min(887200, currentTick + RANGE)
  if (!current.affordable)
    return {
      current,
      lowerTick: currentTick,
      upperTick: currentTick,
      minTick,
      maxTick,
      blockNumber,
    }
  const ticks = new Set<number>([minTick, maxTick])
  for (let tick = minTick; tick <= maxTick; tick += STEP) ticks.add(tick)
  for (const leg of decoded.flat()) {
    const halfWidth = (leg.width * metadata.tickSpacing) / 2n
    for (const tick of [leg.strike - halfWidth, leg.strike, leg.strike + halfWidth]) {
      for (const offset of [-1, 0, 1]) {
        const value = Number(tick) + offset
        if (value >= minTick && value <= maxTick) ticks.add(value)
      }
    }
  }
  ticks.delete(currentTick)
  const samples: Awaited<ReturnType<typeof evaluate>>[] = []
  const sortedTicks = [...ticks].sort((a, b) => a - b)
  // Bound concurrent RPC calls while sampling both sides and option-range transitions.
  for (let i = 0; i < sortedTicks.length; i += SAMPLE_BATCH_SIZE)
    samples.push(...(await Promise.all(sortedTicks.slice(i, i + SAMPLE_BATCH_SIZE).map(evaluate))))
  const [lowerTick, upperTick] = await Promise.all([
    findHedgeBoundary(current, samples, -1, evaluate),
    findHedgeBoundary(current, samples, 1, evaluate),
  ])
  return { current, lowerTick, upperTick, minTick, maxTick, blockNumber }
}
