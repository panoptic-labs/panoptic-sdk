/**
 * Fork test for Long Gamma Scalping
 *
 * Demonstrates the long gamma side of the gamma scalping flow:
 * 1. Seed short-side liquidity with an ATM straddle
 * 2. Atomically buy an ATM straddle and open a hedge loan
 * 3. Verify positive gamma
 * 4. Open a delta hedge with a loan and swapAtMint
 * 5. Verify that the hedge reduces net delta
 *
 * Uses eve (Anvil account #4) for the long gamma trader.
 * Uses frank (Anvil account #5) to seed short-side liquidity.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/long-gamma-scalping.fork.test.ts
 *
 * @module examples/__tests__/long-gamma-scalping.fork.test
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'

import { calculatePositionGreeks } from '../../greeks'
import type { DeltaHedgeResult } from '../../reads/hedge'
import { getDeltaHedgeParams } from '../../reads/hedge'
import { getPool } from '../../reads/pool'
import { getPosition } from '../../reads/position'
import { simulateDispatch } from '../../simulations/simulateDispatch'
import { simulateOpenPosition } from '../../simulations/simulateOpenPosition'
import { decodeTokenId, STANDARD_TICK_WIDTHS } from '../../tokenId'
import { dispatchAndWait } from '../../writes/dispatch'
import { openPosition } from '../../writes/position'
import { deposit } from '../../writes/vault'
import {
  assertValidDeployments,
  createTokenIdBuilder,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
  isNativeTokenAddress,
} from './network.config'

const config = getNetworkConfig()

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

async function fundAndDepositCollateral(params: {
  client: PublicClient
  walletClient: WalletClient
  account: Address
  token0Amount: bigint
  token1Amount: bigint
}) {
  const { client, walletClient, account, token0Amount, token1Amount } = params

  await fundTestAccount({
    client,
    walletClient,
    account,
    token0Amount,
    token1Amount,
    approveCollateral: true,
  })

  await (
    await deposit({
      client,
      walletClient,
      account,
      collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      assets: token0Amount,
      isNativeETH: isNativeTokenAddress(config.tokens.token0.address),
    })
  ).wait()

  await (
    await deposit({
      client,
      walletClient,
      account,
      collateralTrackerAddress: config.contracts.pool.collateralTracker1,
      assets: token1Amount,
    })
  ).wait()
}

function buildAtmStraddle(params: {
  poolId: bigint
  strike: bigint
  width: bigint
  isLong: boolean
}) {
  return createTokenIdBuilder(params.poolId)
    .addCall({
      strike: params.strike,
      width: params.width,
      optionRatio: 1n,
      isLong: params.isLong,
    })
    .addPut({
      strike: params.strike,
      width: params.width,
      optionRatio: 1n,
      isLong: params.isLong,
    })
    .build()
}

function buildHedgeLoan(poolId: bigint, hedge: DeltaHedgeResult): bigint {
  return createTokenIdBuilder(poolId)
    .addLoan({
      asset: hedge.hedgeLeg.asset,
      tokenType: hedge.hedgeLeg.tokenType,
      strike: hedge.hedgeLeg.strike,
      optionRatio: hedge.hedgeLeg.optionRatio,
    })
    .build()
}

function getSwapAtMintLoanDelta(params: {
  optionTokenId: bigint
  hedge: DeltaHedgeResult
  hedgePositionSize: bigint
}): bigint {
  const { optionTokenId, hedge, hedgePositionSize } = params
  const primaryAsset = decodeTokenId(optionTokenId).legs[0].asset
  const numeraire = primaryAsset === 0n ? 1n : 0n
  const direction = hedge.hedgeLeg.tokenType === numeraire ? 1n : -1n

  return direction * hedgePositionSize
}

async function seedShortSideLiquidity(params: {
  client: PublicClient
  walletClient: WalletClient
  account: Address
}) {
  const { client, walletClient, account } = params
  const pool = await getPool({
    client,
    poolAddress: config.contracts.pool.address,
    chainId: config.chainId,
  })
  const strike = (pool.currentTick / pool.tickSpacing) * pool.tickSpacing
  const width = STANDARD_TICK_WIDTHS['1D'] / pool.tickSpacing
  const tokenId = buildAtmStraddle({ poolId: pool.poolId, strike, width, isLong: false })
  const candidateSizes = [10n ** 15n, 10n ** 14n, 10n ** 13n, 10n ** 12n]

  for (const positionSize of candidateSizes) {
    const simulation = await simulateOpenPosition({
      client,
      poolAddress: config.contracts.pool.address,
      account,
      tokenId,
      positionSize,
      existingPositionIds: [],
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })
    if (!simulation.success) continue

    const receipt = await (
      await openPosition({
        client,
        walletClient,
        account,
        poolAddress: config.contracts.pool.address,
        tokenId,
        positionSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })
    ).wait()
    expect(receipt.status).toBe('success')
    return
  }

  throw new Error('Could not seed short-side liquidity for the long straddle')
}

describe('Long Gamma Scalping fork example', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let eveAddress: Address

  beforeAll(async () => {
    assertValidDeployments()

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0,
    })

    const frank = privateKeyToAccount(config.testAccounts.frank)
    const frankWallet = createWalletClient({
      account: frank,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })

    await fundAndDepositCollateral({
      client,
      walletClient: frankWallet,
      account: frank.address,
      token0Amount: parseUnits('100', config.tokens.token0.decimals),
      token1Amount: parseUnits('1000000', config.tokens.token1.decimals),
    })
    await seedShortSideLiquidity({ client, walletClient: frankWallet, account: frank.address })

    const eve = privateKeyToAccount(config.testAccounts.eve)
    eveAddress = eve.address
    walletClient = createWalletClient({
      account: eve,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })

    await fundAndDepositCollateral({
      client,
      walletClient,
      account: eveAddress,
      token0Amount: parseUnits('100', config.tokens.token0.decimals),
      token1Amount: parseUnits('1000000', config.tokens.token1.decimals),
    })
  }, 180000)

  it('atomically opens a long straddle and delta-hedges it with a swapAtMint loan', async () => {
    const pool = await getPool({
      client,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
    })
    const strike = (pool.currentTick / pool.tickSpacing) * pool.tickSpacing
    const width = STANDARD_TICK_WIDTHS['1D'] / pool.tickSpacing
    const candidateSizes = [10n ** 13n, 10n ** 12n, 10n ** 11n, 10n ** 10n]
    const straddleTokenId = buildAtmStraddle({
      poolId: pool.poolId,
      strike,
      width,
      isLong: true,
    })

    const decoded = decodeTokenId(straddleTokenId)
    expect(decoded.legCount).toBe(2n)
    expect(decoded.legs.every((leg) => leg.isLong)).toBe(true)

    let positionSize = 0n
    let straddleSimulation: Awaited<ReturnType<typeof simulateOpenPosition>> | undefined
    for (const candidateSize of candidateSizes) {
      const simulation = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: eveAddress,
        tokenId: straddleTokenId,
        positionSize: candidateSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })
      if (simulation.success) {
        positionSize = candidateSize
        straddleSimulation = simulation
        break
      }
      console.log(
        `Long straddle simulation failed at size ${candidateSize}: ${simulation.error.message.slice(0, 200)}`,
      )
    }
    expect(straddleSimulation?.success).toBe(true)
    if (!straddleSimulation || 'error' in straddleSimulation) {
      throw straddleSimulation?.error ?? new Error('Long straddle simulation failed')
    }

    const hedge = await getDeltaHedgeParams({
      client,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
      tokenId: straddleTokenId,
      positionSize,
      targetDelta: 0n,
      mintTick: pool.currentTick,
    })
    expect(hedge.hedgeType).toBe('loan')
    expect(hedge.swapAtMint).toBe(true)
    expect(hedge.hedgeAmount).toBeGreaterThan(0n)

    const hedgeTokenId = buildHedgeLoan(pool.poolId, hedge)
    const finalPositionIds = [straddleTokenId, hedgeTokenId]
    const straddleLimits = [-887272n, 887272n, 0n] as const
    const hedgeLimits = [887272n, -887272n, 0n] as const

    const batchSimulation = await simulateDispatch({
      client,
      poolAddress: config.contracts.pool.address,
      account: eveAddress,
      positionIdList: [straddleTokenId, hedgeTokenId],
      finalPositionIdList: finalPositionIds,
      existingPositionIdList: [],
      positionSizes: [positionSize, hedge.hedgeAmount],
      tickAndSpreadLimits: [straddleLimits, hedgeLimits],
    })
    expect(batchSimulation.success).toBe(true)
    if ('error' in batchSimulation) throw batchSimulation.error

    const receipt = await dispatchAndWait({
      client,
      walletClient,
      account: eveAddress,
      poolAddress: config.contracts.pool.address,
      positionIdList: [straddleTokenId, hedgeTokenId],
      finalPositionIdList: finalPositionIds,
      positionSizes: [positionSize, hedge.hedgeAmount],
      tickAndSpreadLimits: [straddleLimits, hedgeLimits],
    })
    expect(receipt.status).toBe('success')

    const [straddlePosition, hedgePosition] = await Promise.all([
      getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: straddleTokenId,
      }),
      getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: hedgeTokenId,
      }),
    ])
    expect(straddlePosition.positionSize).toBe(positionSize)
    expect(hedgePosition.positionSize).toBe(hedge.hedgeAmount)

    const latestPool = await getPool({
      client,
      poolAddress: config.contracts.pool.address,
      chainId: config.chainId,
    })
    const straddleGreeks = calculatePositionGreeks({
      legs: straddlePosition.legs,
      currentTick: latestPool.currentTick,
      mintTick: straddlePosition.tickAtMint,
      positionSize: straddlePosition.positionSize,
      poolTickSpacing: latestPool.tickSpacing,
    })
    expect(straddleGreeks.gamma).toBeGreaterThan(0n)
    expect(abs(straddleGreeks.delta)).toBeGreaterThan(0n)

    const hedgeDelta = getSwapAtMintLoanDelta({
      optionTokenId: straddleTokenId,
      hedge,
      hedgePositionSize: hedgePosition.positionSize,
    })
    const combinedDelta = straddleGreeks.delta + hedgeDelta

    expect(abs(combinedDelta)).toBeLessThan(abs(straddleGreeks.delta))
  }, 180000)
})
