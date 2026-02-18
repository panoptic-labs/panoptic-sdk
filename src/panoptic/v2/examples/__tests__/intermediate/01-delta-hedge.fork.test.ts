/**
 * Fork test for intermediate example 01: Delta-Neutral Hedging
 *
 * Demonstrates a delta-neutral hedging strategy:
 * 1. Mint a short call option
 * 2. Detect its delta using calculatePositionGreeks
 * 3. Use getDeltaHedgeParams to calculate the hedge (loan + swapAtMint)
 * 4. Mint the hedge as a separate loan position with swapAtMint
 * 5. Confirm that the combined delta is near zero
 *
 * Hedging mechanism:
 * - Short call has negative delta → need positive delta
 * - getDeltaHedgeParams returns a loan of the numeraire token + swapAtMint
 * - The loan borrows numeraire (USDC), swapAtMint converts to asset (ETH)
 * - Net result: +ETH exposure → positive delta that offsets the short call
 *
 * Uses **eve** (Anvil account #4) to avoid nonce conflicts with basic tests.
 * Uses **frank** (Anvil account #5) to seed Uniswap pool liquidity.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/intermediate/
 *
 * @module examples/__tests__/intermediate/01-delta-hedge.fork.test
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

import {
  panopticPoolAbi,
  riskEngineAbi,
  semiFungiblePositionManagerAbi,
} from '../../../../../generated'
import { calculatePositionGreeks } from '../../../greeks'
import { getAccountCollateral } from '../../../reads/account'
import { getMaxPositionSize } from '../../../reads/collateralEstimate'
import type { DeltaHedgeResult } from '../../../reads/hedge'
import { getDeltaHedgeParams } from '../../../reads/hedge'
import { getPool } from '../../../reads/pool'
import { getPosition } from '../../../reads/position'
import { simulateOpenPosition } from '../../../simulations/simulateOpenPosition'
import type { StorageAdapter } from '../../../storage'
import { createMemoryStorage } from '../../../storage'
import { getTrackedPositionIds, syncPositions } from '../../../sync'
import { decodeTokenId, STANDARD_TICK_WIDTHS } from '../../../tokenId'
import { closePosition, openPosition } from '../../../writes/position'
import { deposit } from '../../../writes/vault'
import {
  assertValidDeployments,
  createTokenIdBuilder,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from '../network.config'

const WAD = 10n ** 18n

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sync positions and return only open (positionSize > 0) tokenIds.
 * Uses a shared storage instance for efficiency within the test.
 */
async function getOpenPositionIds(
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  chainId: bigint,
  storage: StorageAdapter,
): Promise<bigint[]> {
  await syncPositions({ client, chainId, poolAddress, account, storage })
  const ids = await getTrackedPositionIds({ chainId, poolAddress, account, storage })

  const verified: bigint[] = []
  for (const id of ids) {
    const pos = await getPosition({ client, poolAddress, owner: account, tokenId: id })
    if (pos.positionSize > 0n) {
      verified.push(id)
    }
  }
  return verified
}

/**
 * Seed Uniswap pool liquidity by opening a large ATM straddle with frank.
 * Idempotent — skips if straddle already exists on this Anvil instance.
 */
async function seedPoolLiquidity(
  client: PublicClient,
  frankWallet: WalletClient,
  frankAddress: Address,
  config: ReturnType<typeof getNetworkConfig>,
) {
  const chainId = config.chainId
  const poolAddress = config.contracts.pool.address
  const frankStorage = createMemoryStorage()

  // Fund frank
  await fundTestAccount({
    client,
    walletClient: frankWallet,
    account: frankAddress,
    token0Amount: parseUnits('9000', config.tokens.token0.decimals),
    token1Amount: parseUnits('37500000000', config.tokens.token1.decimals),
    approveCollateral: true,
  })

  // Deposit collateral
  const dep0 = await deposit({
    client,
    walletClient: frankWallet,
    account: frankAddress,
    collateralTrackerAddress: config.contracts.pool.collateralTracker0,
    assets: parseUnits('9000', config.tokens.token0.decimals),
  })
  await dep0.wait()

  const dep1 = await deposit({
    client,
    walletClient: frankWallet,
    account: frankAddress,
    collateralTrackerAddress: config.contracts.pool.collateralTracker1,
    assets: parseUnits('37500000000', config.tokens.token1.decimals),
  })
  await dep1.wait()

  // Build ATM straddle
  const pool = await getPool({ client, poolAddress, chainId })
  const tickSpacing = pool.poolKey.tickSpacing
  const atmStrike = (pool.currentTick / tickSpacing) * tickSpacing

  // Width in the tokenId is a tickSpacing multiplier: actualTicks = width * tickSpacing
  const straddleWidth = STANDARD_TICK_WIDTHS['1D'] / tickSpacing
  const straddleTokenId = createTokenIdBuilder(pool.poolId)
    .addCall({ strike: atmStrike, width: straddleWidth, optionRatio: 1n, isLong: false })
    .addPut({ strike: atmStrike, width: straddleWidth, optionRatio: 1n, isLong: false })
    .build()

  // Idempotent: skip if already seeded
  const existing = await getPosition({
    client,
    poolAddress,
    owner: frankAddress,
    tokenId: straddleTokenId,
  })
  if (existing.positionSize > 0n) {
    console.log('Frank straddle already exists, skipping seed')
    return
  }

  // Estimate max safe size
  const frankIds = await getOpenPositionIds(
    client,
    poolAddress,
    frankAddress,
    chainId,
    frankStorage,
  )
  const queryAddress = config.contracts.panopticQuery as Address
  const estimate = await getMaxPositionSize({
    client,
    poolAddress,
    account: frankAddress,
    tokenId: straddleTokenId,
    queryAddress,
    existingPositionIds: frankIds,
    precisionPct: 0.1,
  })
  expect(estimate.maxSize).toBeGreaterThan(0n)

  // Scale down by BP_DECREASE_BUFFER for safety margin
  const riskEngineAddress = await client.readContract({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: 'riskEngine',
  })
  const bpDecreaseBuffer = await client.readContract({
    address: riskEngineAddress,
    abi: riskEngineAbi,
    functionName: 'BP_DECREASE_BUFFER',
  })
  const straddleSize = (10_000_000n * estimate.maxSize) / BigInt(bpDecreaseBuffer)
  expect(straddleSize).toBeGreaterThan(0n)

  // Simulate then execute
  const sim = await simulateOpenPosition({
    client,
    poolAddress,
    account: frankAddress,
    tokenId: straddleTokenId,
    positionSize: straddleSize,
    existingPositionIds: frankIds,
    tickLimitLow: -887272n,
    tickLimitHigh: 887272n,
  })
  if (!sim.success) {
    console.log(`Frank straddle simulation failed: ${sim.error?.message?.slice(0, 300)}`)
  }
  expect(sim.success).toBe(true)

  const receipt = await (
    await openPosition({
      client,
      walletClient: frankWallet,
      account: frankAddress,
      poolAddress,
      tokenId: straddleTokenId,
      positionSize: straddleSize,
      existingPositionIds: frankIds,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
    })
  ).wait()
  expect(receipt.status).toBe('success')

  console.log(
    `Frank seeded liquidity: ATM straddle w=${straddleWidth} (${STANDARD_TICK_WIDTHS['1D']} ticks) size=${straddleSize} strike=${atmStrike}`,
  )

  // Log chunk liquidity for both tokenTypes after the mint
  const halfWidth = (straddleWidth * tickSpacing) / 2n
  const chunkTickLower = Number(atmStrike - halfWidth)
  const chunkTickUpper = Number(atmStrike + halfWidth)

  const [sfpmAddress, poolKeyBytes] = await Promise.all([
    client.readContract({ address: poolAddress, abi: panopticPoolAbi, functionName: 'SFPM' }),
    client.readContract({ address: poolAddress, abi: panopticPoolAbi, functionName: 'poolKey' }),
  ])

  for (const tokenType of [0n, 1n]) {
    const liq = await client.readContract({
      address: sfpmAddress,
      abi: semiFungiblePositionManagerAbi,
      functionName: 'getAccountLiquidity',
      args: [poolKeyBytes, poolAddress, tokenType, chunkTickLower, chunkTickUpper],
    })
    const netLiquidity = liq & ((1n << 128n) - 1n) // right slot
    const removedLiquidity = liq >> 128n // left slot
    console.log(
      `  Chunk tokenType=${tokenType}: net=${netLiquidity}, removed=${removedLiquidity}, tickRange=[${chunkTickLower}, ${chunkTickUpper}]`,
    )
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Intermediate 01: Delta-Neutral Hedging (Fork Test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let eveAddress: Address
  let eveStorage: StorageAdapter
  const config = getNetworkConfig()

  // Shared state across steps
  let callTokenId: bigint
  let hedgeTokenId: bigint
  let hedgeParams: DeltaHedgeResult
  const positionSize = 10n ** 15n // 0.001 units (18 decimals)

  beforeAll(async () => {
    assertValidDeployments()

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0, // Disable block number caching for write-then-read tests
    })

    eveStorage = createMemoryStorage()

    // --- Seed pool liquidity with frank ---
    const frankAccount = privateKeyToAccount(config.testAccounts.frank)
    const frankWallet = createWalletClient({
      account: frankAccount,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })
    await seedPoolLiquidity(client, frankWallet, frankAccount.address, config)

    // --- Fund eve (the hedging account) ---
    const eveAccount = privateKeyToAccount(config.testAccounts.eve)
    eveAddress = eveAccount.address

    walletClient = createWalletClient({
      account: eveAccount,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })

    await fundTestAccount({
      client,
      walletClient,
      account: eveAddress,
      token0Amount: parseUnits('9000', config.tokens.token0.decimals),
      token1Amount: parseUnits('10000000000', config.tokens.token1.decimals),
      approveCollateral: true,
    })

    const dep0 = await deposit({
      client,
      walletClient,
      account: eveAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      assets: parseUnits('9000', config.tokens.token0.decimals),
    })
    await dep0.wait()

    const dep1 = await deposit({
      client,
      walletClient,
      account: eveAddress,
      collateralTrackerAddress: config.contracts.pool.collateralTracker1,
      assets: parseUnits('10000000000', config.tokens.token1.decimals),
    })
    await dep1.wait()

    const collateral = await getAccountCollateral({
      client,
      poolAddress: config.contracts.pool.address,
      account: eveAddress,
    })
    console.log(`Eve funded — WETH: ${collateral.token0.assets}, USDC: ${collateral.token1.assets}`)
  })

  describe('Step 1: Open short call', () => {
    it('should open an OTM short call position', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      // OTM: strike above current tick for calls
      const strike = (currentTick / tickSpacing + 5n) * tickSpacing

      // Width in the tokenId is a tickSpacing multiplier: actualTicks = width * tickSpacing
      const callWidth = STANDARD_TICK_WIDTHS['1W'] / tickSpacing
      callTokenId = createTokenIdBuilder(pool.poolId)
        .addCall({
          strike,
          width: callWidth, // ~1-month DTE gamma profile
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Idempotent: skip if already minted
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: callTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log(`Short call already exists (size=${existing.positionSize}), skipping`)
        return
      }

      const eveIds = await getOpenPositionIds(
        client,
        config.contracts.pool.address,
        eveAddress,
        config.chainId,
        eveStorage,
      )

      console.log('pool', pool)
      // Simulate then execute
      const sim = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: eveAddress,
        tokenId: callTokenId,
        positionSize,
        existingPositionIds: eveIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })
      expect(sim.success).toBe(true)

      const receipt = await (
        await openPosition({
          client,
          walletClient,
          account: eveAddress,
          poolAddress: config.contracts.pool.address,
          tokenId: callTokenId,
          positionSize,
          existingPositionIds: eveIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })
      ).wait()
      expect(receipt.status).toBe('success')

      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: callTokenId,
      })
      expect(position.positionSize).toBe(positionSize)

      console.log(
        `Short call opened: strike=${strike}, width=${callWidth} (${STANDARD_TICK_WIDTHS['1D']} ticks), size=${positionSize}`,
      )
    })
  })

  describe('Step 2: Measure initial delta', () => {
    it('should have negative delta for short call', async () => {
      const [position, pool] = await Promise.all([
        getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: eveAddress,
          tokenId: callTokenId,
        }),
        getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        }),
      ])

      expect(position.positionSize).toBeGreaterThan(0n)

      const greeks = calculatePositionGreeks({
        legs: position.legs,
        currentTick: pool.currentTick,
        mintTick: position.tickAtMint,
        positionSize: position.positionSize,
        poolTickSpacing: pool.poolKey.tickSpacing,
      })

      // Short call = negative delta
      expect(greeks.delta).toBeLessThan(0n)

      const perContract = (n: bigint) =>
        (Number(n) / Number(WAD) / Number(position.positionSize)).toFixed(6)
      console.log(
        `Short call greeks: delta=${perContract(greeks.delta)}/ct, gamma=${perContract(greeks.gamma)}/ct, value=${perContract(greeks.value)}/ct`,
      )
    })
  })

  describe('Step 3: Calculate hedge with getDeltaHedgeParams', () => {
    it('should recommend a loan of numeraire + swapAtMint for short call', async () => {
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: callTokenId,
      })

      hedgeParams = await getDeltaHedgeParams({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
        tokenId: callTokenId,
        positionSize: position.positionSize,
        targetDelta: 0n,
        mintTick: position.tickAtMint,
      })

      // Short call has negative delta → deltaAdjustment > 0 → loan numeraire + swapAtMint
      expect(hedgeParams.hedgeType).toBe('loan')
      expect(hedgeParams.swapAtMint).toBe(true)
      expect(hedgeParams.hedgeAmount).toBeGreaterThan(0n)
      expect(hedgeParams.currentDelta).toBeLessThan(0n)
      expect(hedgeParams.deltaAdjustment).toBeGreaterThan(0n)

      // Hedge leg should be a loan (width=0, isLong=false)
      expect(hedgeParams.hedgeLeg.width).toBe(0n)
      expect(hedgeParams.hedgeLeg.isLong).toBe(false)

      // For short call on asset=0 pool, numeraire is token1
      const decoded = decodeTokenId(callTokenId)
      const primaryAsset = decoded.legs[0].asset
      const expectedNumeraire = primaryAsset === 0n ? 1n : 0n
      expect(hedgeParams.hedgeLeg.tokenType).toBe(expectedNumeraire)

      console.log(
        `Hedge: ${hedgeParams.hedgeType} (swapAtMint=${hedgeParams.swapAtMint}), amount=${hedgeParams.hedgeAmount}, tokenType=${hedgeParams.hedgeLeg.tokenType}`,
      )
    })
  })

  describe('Step 4: Open hedge position', () => {
    it('should open the hedge loan with swapAtMint', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      // Build hedge tokenId from params computed in Step 3
      hedgeTokenId = createTokenIdBuilder(pool.poolId)
        .addLoan({
          asset: hedgeParams.hedgeLeg.asset,
          tokenType: hedgeParams.hedgeLeg.tokenType,
          strike: hedgeParams.hedgeLeg.strike,
          optionRatio: hedgeParams.hedgeLeg.optionRatio,
        })
        .build()
      console.log('hedgeParams', hedgeParams)
      // Verify encoding
      const decoded = decodeTokenId(hedgeTokenId)
      console.log('decoded', decoded)
      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs[0].width).toBe(0n)
      expect(decoded.legs[0].isLong).toBe(false)

      // Idempotent: skip if already minted
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: hedgeTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('Hedge position already exists, skipping')
        return
      }

      const hedgeSize = hedgeParams.hedgeAmount > 0n ? hedgeParams.hedgeAmount : 1n

      // Simulate then execute — with swapAtMint as indicated by getDeltaHedgeParams
      const eveIds = await getOpenPositionIds(
        client,
        config.contracts.pool.address,
        eveAddress,
        config.chainId,
        eveStorage,
      )

      console.log('hedgeParams', hedgeParams)
      const sim = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: eveAddress,
        tokenId: hedgeTokenId,
        positionSize: hedgeSize,
        existingPositionIds: eveIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: hedgeParams.swapAtMint,
      })
      if (!sim.success) {
        console.log(`Hedge simulation failed: ${sim.error?.message?.slice(0, 200)}`)
      }
      expect(sim.success).toBe(true)

      const receipt = await (
        await openPosition({
          client,
          walletClient,
          account: eveAddress,
          poolAddress: config.contracts.pool.address,
          tokenId: hedgeTokenId,
          positionSize: hedgeSize,
          existingPositionIds: eveIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
          swapAtMint: hedgeParams.swapAtMint,
        })
      ).wait()
      expect(receipt.status).toBe('success')

      const hedgePosition = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: eveAddress,
        tokenId: hedgeTokenId,
      })
      expect(hedgePosition.positionSize).toBe(hedgeSize)

      console.log(
        `Hedge opened: loan tokenType=${decoded.legs[0].tokenType}, size=${hedgeSize}, swapAtMint=${hedgeParams.swapAtMint}`,
      )
    })
  })

  describe('Step 5: Verify delta-neutral', () => {
    it('should have combined delta near zero', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const [callPosition, hedgePosition] = await Promise.all([
        getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: eveAddress,
          tokenId: callTokenId,
        }),
        getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: eveAddress,
          tokenId: hedgeTokenId,
        }),
      ])

      expect(callPosition.positionSize).toBeGreaterThan(0n)
      expect(hedgePosition.positionSize).toBeGreaterThan(0n)

      console.log('callPosoition', callPosition)
      console.log('hedgePosition', hedgePosition)
      // Calculate greeks for the short call
      const callGreeks = calculatePositionGreeks({
        legs: callPosition.legs,
        currentTick: pool.currentTick,
        mintTick: callPosition.tickAtMint,
        positionSize: callPosition.positionSize,
        poolTickSpacing: pool.poolKey.tickSpacing,
      })

      console.log('callGreels', callGreeks)
      // For the hedge (loan + swapAtMint), calculatePositionGreeks doesn't
      // account for the swapAtMint effect. Compute effective delta manually:
      //   loan numeraire + swap → +asset exposure → +hedgeSize * WAD
      //   loan asset    + swap → −asset exposure → −hedgeSize * WAD
      const decoded = decodeTokenId(callTokenId)
      const primaryAsset = decoded.legs[0].asset
      const numeraire = primaryAsset === 0n ? 1n : 0n
      const isLoanOfNumeraire = hedgeParams.hedgeLeg.tokenType === numeraire
      const hedgeDelta = isLoanOfNumeraire
        ? hedgePosition.positionSize * WAD
        : -(hedgePosition.positionSize * WAD)

      const combinedDelta = callGreeks.delta + hedgeDelta
      const absCombined = combinedDelta < 0n ? -combinedDelta : combinedDelta
      const absOriginal = callGreeks.delta < 0n ? -callGreeks.delta : callGreeks.delta

      // Hedge should reduce delta significantly (80%+ reduction)
      expect(absCombined).toBeLessThan(absOriginal)
      const tolerance = absOriginal / 5n // 20% of original delta
      expect(absCombined).toBeLessThanOrEqual(tolerance)

      const reduction =
        absOriginal > 0n
          ? ((1 - Number(absCombined) / Number(absOriginal)) * 100).toFixed(1)
          : '100'

      console.log(
        `Delta verification: call=${callGreeks.delta}, hedge=${hedgeDelta}, combined=${combinedDelta} (${reduction}% reduction)`,
      )
    })
  })

  describe('Cleanup', () => {
    it('should close both positions', async () => {
      const poolAddress = config.contracts.pool.address

      // Close call (opened without swapAtMint)
      const callPos = await getPosition({
        client,
        poolAddress,
        owner: eveAddress,
        tokenId: callTokenId,
      })
      if (callPos.positionSize > 0n) {
        const ids = await getOpenPositionIds(
          client,
          poolAddress,
          eveAddress,
          config.chainId,
          eveStorage,
        )
        const receipt = await (
          await closePosition({
            client,
            walletClient,
            account: eveAddress,
            poolAddress,
            positionIdList: ids,
            tokenId: callTokenId,
            positionSize: 0n,
            tickLimitLow: -887272n,
            tickLimitHigh: 887272n,
          })
        ).wait()
        expect(receipt.status).toBe('success')
        console.log('Short call closed')
      }

      // Close hedge (opened with swapAtMint)
      const hedgePos = await getPosition({
        client,
        poolAddress,
        owner: eveAddress,
        tokenId: hedgeTokenId,
      })
      if (hedgePos.positionSize > 0n) {
        const ids = await getOpenPositionIds(
          client,
          poolAddress,
          eveAddress,
          config.chainId,
          eveStorage,
        )
        const receipt = await (
          await closePosition({
            client,
            walletClient,
            account: eveAddress,
            poolAddress,
            positionIdList: ids,
            tokenId: hedgeTokenId,
            positionSize: 0n,
            tickLimitLow: -887272n,
            tickLimitHigh: 887272n,
            swapAtMint: true,
          })
        ).wait()
        expect(receipt.status).toBe('success')
        console.log('Hedge position closed')
      }

      // Verify both closed
      const [callAfter, hedgeAfter] = await Promise.all([
        getPosition({ client, poolAddress, owner: eveAddress, tokenId: callTokenId }),
        getPosition({ client, poolAddress, owner: eveAddress, tokenId: hedgeTokenId }),
      ])
      expect(callAfter.positionSize).toBe(0n)
      expect(hedgeAfter.positionSize).toBe(0n)

      console.log('Both positions closed and verified')
    })
  })
})
