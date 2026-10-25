import Decimal from 'decimal.js'
import { type Address, type PublicClient, erc20Abi, zeroAddress } from 'viem'
import { readContract } from 'viem/actions'

import { stateViewAbi } from '../../panoptic/v2/abis/stateView'
import { uniswapV3PoolAbi } from '../../panoptic/v2/abis/uniswapV3Pool'
import { tickToSqrtPriceX96 } from '../../panoptic/v2/formatters/tick'
import { getLegDeltaInVaultFrame, isDefinedRisk } from '../../panoptic/v2/greeks'
import { getLegLiquidityRange } from '../../panoptic/v2/greeks/legLiquidity'
import { getAccountCollateral } from '../../panoptic/v2/reads/account'
import { getPool } from '../../panoptic/v2/reads/pool'
import { getPositions } from '../../panoptic/v2/reads/position'
import {
  getPositionValueCurve,
  preparePositionValueCurve,
} from '../../panoptic/v2/reads/positionValueCurve'
import { getAccountPremia } from '../../panoptic/v2/reads/premia'
import type { Position } from '../../panoptic/v2/types'
import { requireChainDeployment } from '../chainDeployments'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'
import { fetchVaultSharePriceSnapshot } from '../sharePrice/snapshot'
import type { VaultApyVaultLike } from '../sharePrice/types'
import { getVaultCandidatePoolInfos, resolveVaultTokenIdsByPool } from '../utils/vaultManagerInput'
import { fetchVaultNetLendingYieldUnderlying } from './vaultLendingAllocation'

const Precision = Decimal.clone({ precision: 60 })
const TICK_RATIO = new Precision('1.0001')
const DAY = 86_400n

/** Values every token amount in raw quote units; token ordering never changes the economic move. */
export function prepareFixedPoolValue({
  curve,
  currentTick,
  quoteIsToken0,
  balance0,
  balance1,
}: {
  curve: Parameters<typeof preparePositionValueCurve>[0]
  currentTick: bigint
  quoteIsToken0: boolean
  balance0: bigint
  balance1: bigint
}) {
  const atTick = preparePositionValueCurve(curve)
  return (movePct: Decimal.Value) => {
    const factor = new Precision(movePct).div(100).plus(1)
    if (!factor.isFinite() || factor.lte(0)) throw new RangeError('Invalid price move')
    const offset = factor
      .ln()
      .div(TICK_RATIO.ln())
      .mul(quoteIsToken0 ? -1 : 1)
    const tick = currentTick + BigInt(offset.toFixed(0))
    const amounts = atTick(tick)
    const ratio = TICK_RATIO.pow(tick.toString())
    const amount0 = new Precision((amounts.value0 + balance0).toString())
    const amount1 = new Precision((amounts.value1 + balance1).toString())
    return quoteIsToken0 ? amount0.plus(amount1.div(ratio)) : amount1.plus(amount0.mul(ratio))
  }
}

/** Price-only trigger estimates use the manager's option-size denominator and debt-aware delta. */
export function estimateFixedPoolHedgeTriggers({
  positions,
  currentTick,
  tickSpacing,
  riskAssetIndex,
  collateralRisk,
  walletRisk,
  thresholdBps,
}: {
  positions: readonly Pick<Position, 'legs' | 'positionSize' | 'tickAtMint'>[]
  currentTick: bigint
  tickSpacing: bigint
  riskAssetIndex: 0n | 1n
  collateralRisk: bigint
  walletRisk: bigint
  thresholdBps: bigint
}) {
  let optionSize = 0n
  for (const position of positions) {
    for (const leg of position.legs) {
      if (leg.width === 0n) continue
      const size = position.positionSize * leg.optionRatio
      const sqrt = tickToSqrtPriceX96(leg.strike)
      optionSize +=
        leg.asset === riskAssetIndex
          ? size
          : riskAssetIndex === 0n
            ? (size * (1n << 192n)) / (sqrt * sqrt)
            : (size * sqrt * sqrt) / (1n << 192n)
    }
  }
  const breachedAt = (move: Decimal.Value) => {
    const offset = new Precision(move).div(100).plus(1).ln().div(TICK_RATIO.ln())
    const tick = currentTick + BigInt(offset.mul(riskAssetIndex === 0n ? 1 : -1).toFixed(0))
    let delta = collateralRisk + walletRisk
    for (const position of positions) {
      const definedRisk = isDefinedRisk(position.legs)
      for (const leg of position.legs) {
        delta += getLegDeltaInVaultFrame(
          leg,
          tick,
          position.positionSize,
          tickSpacing,
          position.tickAtMint,
          definedRisk,
          riskAssetIndex,
        )
      }
    }
    return optionSize > 0n && ((delta < 0n ? -delta : delta) * 10000n) / optionSize > thresholdBps
  }
  const search = (direction: number) => {
    if (optionSize === 0n) return null
    if (breachedAt(0)) return '0'
    for (let step = 1; step <= 120; step++) {
      if (!breachedAt(new Precision(step).div(4).mul(direction))) continue
      let lower = new Precision(step - 1).div(4)
      let upper = new Precision(step).div(4)
      for (let iteration = 0; iteration < 16; iteration++) {
        const middle = lower.plus(upper).div(2)
        if (breachedAt(middle.mul(direction))) upper = middle
        else lower = middle
      }
      return upper.mul(direction).toString()
    }
    return null
  }
  return { downMovePct: search(-1), upMovePct: search(1), thresholdBps: thresholdBps.toString() }
}

function annualizeReturnPct(returnPct: Decimal.Value, days: string): string | null {
  const factor = new Precision(returnPct).div(100).plus(1)
  if (!factor.isFinite() || factor.lt(0)) return null
  return factor.pow(new Precision(365).div(days)).minus(1).mul(100).toString()
}

/** Fixed holdings, flat carry rates, one terminal price shock; no rehedging or compounding. */
export function calculateFixedPortfolioScenarios({
  navRaw,
  quoteDecimals,
  valueChangeAtMove,
  premiumDailyRaw,
  lendingDailyRaw,
}: {
  navRaw: bigint
  quoteDecimals: number
  valueChangeAtMove: (movePct: Decimal.Value) => Decimal
  premiumDailyRaw: Decimal.Value
  lendingDailyRaw: Decimal.Value
}) {
  if (navRaw <= 0n) throw new RangeError('Vault NAV must be positive')
  const nav = new Precision(navRaw.toString())
  const units = new Precision(10).pow(quoteDecimals)
  const premium = new Precision(premiumDailyRaw)
  const lending = new Precision(lendingDailyRaw)
  if (!premium.isFinite() || !lending.isFinite()) throw new RangeError('Invalid carry rate')
  return ['7', '30', '90'].map((days) => {
    const premiumCost = premium.mul(days)
    const lendingIncome = lending.mul(days)
    const netCost = premiumCost.minus(lendingIncome)
    const returnAt = (move: Decimal.Value) =>
      valueChangeAtMove(move).minus(netCost).div(nav).mul(100)
    const targetMove = (target: string, direction: -1 | 1): string | null => {
      if (returnAt(0).gte(target)) return '0'
      const limit = direction === -1 ? 80 : 100
      for (let step = 1; step <= limit; step++) {
        const move = step * direction
        if (returnAt(move).lt(target)) continue
        let lower = new Precision(step - 1)
        let upper = new Precision(step)
        for (let iteration = 0; iteration < 16; iteration++) {
          const midpoint = lower.plus(upper).div(2)
          if (returnAt(midpoint.mul(direction)).gte(target)) upper = midpoint
          else lower = midpoint
        }
        return upper.mul(direction).toFixed(2)
      }
      return null
    }
    return {
      days,
      premiumCost: premiumCost.div(units).toString(),
      premiumCostPct: premiumCost.div(nav).mul(100).toString(),
      premiumCostApyPct: annualizeReturnPct(premiumCost.div(nav).mul(-100), days),
      lendingIncome: lendingIncome.div(units).toString(),
      lendingIncomePct: lendingIncome.div(nav).mul(100).toString(),
      lendingApyPct: annualizeReturnPct(lendingIncome.div(nav).mul(100), days),
      netCost: netCost.div(units).toString(),
      netCostPct: netCost.div(nav).mul(100).toString(),
      netCostApyPct: annualizeReturnPct(netCost.div(nav).mul(-100), days),
      targets: ['1', '3', '5'].map((target) => ({
        target,
        apyPct: annualizeReturnPct(target, days),
        downMovePct: targetMove(target, -1),
        upMovePct: targetMove(target, 1),
      })),
      points: Array.from({ length: 181 }, (_, index) => {
        const move = index - 80
        const returnPct = returnAt(move)
        return {
          movePct: String(move),
          returnPct: returnPct.toString(),
          apyPct: annualizeReturnPct(returnPct, days),
        }
      }),
    }
  })
}

export type FixedPortfolioFeeCandle = {
  t: number
  h: number
  l: number
  c: number
  v0: string
  v1: string
  n: number
  liq?: string
}

/** Apply current leg liquidity to the recorded fee/price history; this is not paid-streamia accounting. */
export function estimateFixedPortfolioPremium({
  candles,
  legs,
  quoteIsToken0,
  feeFraction,
  endTime,
}: {
  candles: readonly FixedPortfolioFeeCandle[]
  legs: readonly { lowerTick: bigint; upperTick: bigint; liquidity: bigint; isLong: boolean }[]
  quoteIsToken0: boolean
  feeFraction: Decimal.Value
  endTime: number
}) {
  const end = Math.floor(endTime / 3600) * 3600
  const start = end - 30 * 86400
  const records = [
    ...new Map(
      candles
        .filter(
          (candle) =>
            Number.isSafeInteger(candle.t) &&
            candle.t % 3600 === 0 &&
            candle.t >= start &&
            candle.t < end &&
            candle.n > 0,
        )
        .map((candle) => [candle.t, candle]),
    ).values(),
  ].sort((a, b) => a.t - b.t)
  const first = records[0]
  const last = records[records.length - 1]
  if (
    !first ||
    !last ||
    records.length < 648 ||
    first.t > start + 3 * 3600 ||
    last.t < end - 3 * 3600
  )
    throw new Error('Insufficient or stale 30-day fee history')
  const fee = new Precision(feeFraction)
  if (!fee.isFinite() || fee.lt(0) || fee.gte(1)) throw new Error('Invalid pool fee')
  let cost = new Precision(0)
  for (const candle of records) {
    const liquidity = new Precision(candle.liq ?? 'NaN')
    const volume = new Precision(quoteIsToken0 ? candle.v0 : candle.v1)
    if (
      !liquidity.isFinite() ||
      liquidity.lte(0) ||
      !volume.isFinite() ||
      volume.lt(0) ||
      !Number.isInteger(candle.l) ||
      !Number.isInteger(candle.h) ||
      candle.l > candle.h
    )
      throw new Error('Fee history has missing liquidity or invalid volume')
    for (const leg of legs) {
      const lower = new Precision(leg.lowerTick.toString())
      const upper = new Precision(leg.upperTick.toString())
      const overlap =
        candle.h === candle.l
          ? new Precision(candle.c).gte(lower) && new Precision(candle.c).lt(upper)
            ? new Precision(1)
            : new Precision(0)
          : Precision.max(
              0,
              Precision.min(candle.h, upper).minus(Precision.max(candle.l, lower)),
            ).div(candle.h - candle.l)
      cost = cost.plus(
        volume
          .mul(fee)
          .mul(leg.liquidity.toString())
          .div(liquidity)
          .mul(overlap)
          .mul(leg.isLong ? 1 : -1),
      )
    }
  }
  return cost.div(30)
}

/** Prepare the same immutable position-value curves used by portfolio sensitivity. Carry is independent. */
export async function fetchFixedVaultPortfolio({
  client,
  chainId,
  vault,
  positionCurveProvider = getPositionValueCurve,
}: {
  client: PublicClient
  chainId: number
  vault: VaultApyVaultLike
  positionCurveProvider?: typeof getPositionValueCurve
}) {
  const deployment = requireChainDeployment(chainId)
  const riskToken = deployment.sfpmSwap?.weth
  if (riskToken === undefined) throw new Error('Risk-token configuration is unavailable')
  const vaultAddress = vault.id as Address
  const quote = vault.underlyingToken.id.toLowerCase()
  const quoteDecimals = Number(vault.underlyingToken.decimals)
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 36)
    throw new Error('Invalid quote decimals')
  const blockNumber = await client.getBlockNumber()
  const block = await client.getBlock({ blockNumber })
  const pools = getVaultCandidatePoolInfos(vaultAddress, chainId)
  if (pools.length === 0) throw new Error('No configured pools')
  const ids = await resolveVaultTokenIdsByPool({
    viemClient: client,
    chainId,
    vaultAddress,
    poolInfos: pools,
    verificationBlockNumber: blockNumber,
  })
  const isRisk = (address: Address) =>
    address.toLowerCase() === riskToken.toLowerCase() || address === zeroAddress
  const rows = await Promise.all(
    pools.map(async (info, index) => {
      const [positions, collateral, premium] = await Promise.all([
        getPositions({
          client,
          poolAddress: info.pool,
          owner: vaultAddress,
          tokenIds: ids[index] ?? [],
          blockNumber,
        }),
        getAccountCollateral({
          client,
          poolAddress: info.pool,
          account: vaultAddress,
          blockNumber,
        }),
        getAccountPremia({
          client,
          poolAddress: info.pool,
          account: vaultAddress,
          tokenIds: ids[index] ?? [],
          blockNumber,
        }),
      ])
      if (
        positions.positions.length === 0 &&
        collateral.token0.assets === 0n &&
        collateral.token1.assets === 0n &&
        premium.shortPremium0 === 0n &&
        premium.shortPremium1 === 0n &&
        premium.longPremium0 === 0n &&
        premium.longPremium1 === 0n
      )
        return null
      const pool = await getPool({
        client,
        chainId: BigInt(chainId),
        poolAddress: info.pool,
        blockNumber,
      })
      const quoteIsToken0 = pool.metadata.token0Asset.toLowerCase() === quote
      const quoteIsToken1 = pool.metadata.token1Asset.toLowerCase() === quote
      if (
        (!quoteIsToken0 && !quoteIsToken1) ||
        !isRisk(quoteIsToken0 ? pool.metadata.token1Asset : pool.metadata.token0Asset)
      )
        throw new Error(
          `Unsupported active asset frame: ${pool.metadata.token0Symbol}/${pool.metadata.token1Symbol}`,
        )
      const curve = await positionCurveProvider({
        client,
        queryAddress: deployment.panoptic.v2.panopticQuery,
        positions: positions.positions,
      })
      const valueAt = prepareFixedPoolValue({
        curve,
        currentTick: pool.currentTick,
        quoteIsToken0,
        balance0: collateral.token0.assets + premium.shortPremium0 - premium.longPremium0,
        balance1: collateral.token1.assets + premium.shortPremium1 - premium.longPremium1,
      })
      const baseline = valueAt(0)
      const ratio = TICK_RATIO.pow(pool.currentTick.toString())
      const legs = positions.positions.flatMap((position) =>
        position.legs
          .filter((leg) => leg.width > 0n)
          .map((leg) => ({
            ...getLegLiquidityRange(leg, position.positionSize, pool.tickSpacing),
            isLong: leg.isLong,
          })),
      )
      return {
        valueAt,
        baseline,
        poolAddress: info.pool,
        positions: positions.positions,
        collateralRisk: quoteIsToken0 ? collateral.token1.assets : collateral.token0.assets,
        pool,
        legs,
        quoteIsToken0,
        riskPriceRaw: quoteIsToken0 ? new Precision(1).div(ratio) : ratio,
        riskAsset: quoteIsToken0 ? pool.metadata.token1Asset : pool.metadata.token0Asset,
      }
    }),
  )
  const contexts = rows.filter((row): row is NonNullable<typeof row> => row !== null)
  const nav = await fetchVaultSharePriceSnapshot({
    client,
    vault,
    chainId,
    windowLabel: 'now',
    blockNumber,
    readContractFn: readContract,
    positionsByPool: pools.map((info, index) => ({
      poolAddress: info.pool,
      tokenIds: ids[index] ?? [],
    })),
  })
  const adjustedNav = nav.nav + 1n - nav.assetsDeposited - nav.reservedWithdrawalAssets
  const walletTokens = [
    ...new Set(
      [riskToken, zeroAddress, ...contexts.map((context) => context.riskAsset)].map(
        (token) => token.toLowerCase() as Address,
      ),
    ),
  ]
  const balances = await Promise.all(
    walletTokens.map(async (token) =>
      token === zeroAddress
        ? await client.getBalance({ address: vaultAddress, blockNumber })
        : await client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [vaultAddress],
            blockNumber,
          }),
    ),
  )
  const reference = contexts[0]
  if (reference === undefined) throw new Error('No valuation reference')
  const walletRiskRaw = balances.reduce((sum, balance) => sum + balance, 0n)
  const valueChangeAtMove = (move: Decimal.Value) =>
    contexts
      .reduce(
        (sum, context) => sum.plus(context.valueAt(move).minus(context.baseline)),
        new Precision(0),
      )
      .plus(
        new Precision(walletRiskRaw.toString())
          .mul(reference.riskPriceRaw)
          .mul(new Precision(move).div(100)),
      )
  const calculate = (premiumDailyRaw: Decimal.Value, lendingDailyRaw: Decimal.Value) =>
    calculateFixedPortfolioScenarios({
      navRaw: adjustedNav,
      quoteDecimals,
      valueChangeAtMove,
      premiumDailyRaw,
      lendingDailyRaw,
    })
  const config = getHypoVaultConfigForVault(vaultAddress, chainId)
  const poolTriggers =
    config?.deltaHedge === undefined
      ? []
      : contexts.map((context) =>
          estimateFixedPoolHedgeTriggers({
            positions: context.positions,
            currentTick: context.pool.currentTick,
            tickSpacing: context.pool.tickSpacing,
            riskAssetIndex: context.quoteIsToken0 ? 1n : 0n,
            collateralRisk: context.collateralRisk,
            walletRisk:
              context.poolAddress.toLowerCase() === config.automation?.primaryPool?.toLowerCase()
                ? walletRiskRaw
                : 0n,
            thresholdBps: config.deltaHedge?.deltaThresholdBps ?? 200n,
          }),
        )
  const nearestTrigger = (direction: 'downMovePct' | 'upMovePct') => {
    const moves = poolTriggers.flatMap((trigger) => {
      const move = trigger[direction]
      return move === null ? [] : [new Precision(move)]
    })
    moves.sort((a, b) => a.abs().comparedTo(b.abs()))
    return moves[0]?.toString() ?? null
  }
  const hedgeTriggers =
    config?.deltaHedge === undefined
      ? null
      : {
          downMovePct: nearestTrigger('downMovePct'),
          upMovePct: nearestTrigger('upMovePct'),
          thresholdBps: (config.deltaHedge.deltaThresholdBps ?? 200n).toString(),
        }
  const endTime = Number((block.timestamp / 3600n) * 3600n)
  return {
    blockNumber: blockNumber.toString(),
    timestamp: block.timestamp.toString(),
    riskPrice: reference.riskPriceRaw.mul(new Precision(10).pow(18 - quoteDecimals)).toString(),
    nav: new Precision(adjustedNav.toString()).div(new Precision(10).pow(quoteDecimals)).toString(),
    scenarios: calculate(0, 0),
    hedgeTriggers,
    feeMarkets: contexts
      .filter((context) => context.legs.length > 0)
      .map((context) => context.pool.metadata.underlyingPoolId),
    feeHistoryEnd: endTime,
    estimateHoldingCosts: async (
      candlesByMarket: ReadonlyMap<string, readonly FixedPortfolioFeeCandle[]>,
    ) => {
      const premiumByPool = await Promise.all(
        contexts.map(async (context) => {
          if (context.legs.length === 0) return new Precision(0)
          const pool = context.pool
          let protocolFraction = new Precision(0)
          let fee = new Precision(pool.metadata.fee.toString()).div(1_000_000)
          if (pool.metadata.isV4) {
            const stateView = deployment.infrastructure.stateView
            const slot0 = await client.readContract({
              address: stateView,
              abi: stateViewAbi,
              functionName: 'getSlot0',
              args: [pool.metadata.underlyingPoolId as `0x${string}`],
              blockNumber,
            })
            const packed = BigInt(slot0[2])
            const protocolPips = context.quoteIsToken0 ? packed & 4095n : packed >> 12n
            fee = Precision.max(0, fee.minus(new Precision(protocolPips.toString()).div(1_000_000)))
          } else {
            const slot0 = await client.readContract({
              address: pool.metadata.underlyingPoolId as Address,
              abi: uniswapV3PoolAbi,
              functionName: 'slot0',
              blockNumber,
            })
            const denominator = context.quoteIsToken0
              ? BigInt(slot0[5]) & 15n
              : BigInt(slot0[5]) >> 4n
            if (denominator > 0n) protocolFraction = new Precision(1).div(denominator.toString())
            fee = fee.mul(new Precision(1).minus(protocolFraction))
          }
          return estimateFixedPortfolioPremium({
            candles: candlesByMarket.get(pool.metadata.underlyingPoolId) ?? [],
            legs: context.legs,
            quoteIsToken0: context.quoteIsToken0,
            feeFraction: fee,
            endTime,
          })
        }),
      )
      const lending = await fetchVaultNetLendingYieldUnderlying({
        client,
        chainId,
        vaultAddress,
        underlyingTokenAddress: vault.underlyingToken.id as Address,
        blockNumber,
        intervalSeconds: DAY,
      })
      if (lending === null) throw new Error('Lending and borrowing carry is unavailable')
      return calculate(
        premiumByPool.reduce((sum, premium) => sum.plus(premium), new Precision(0)),
        lending.toString(),
      )
    },
  }
}
