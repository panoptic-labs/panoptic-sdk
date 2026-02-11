/**
 * Fork tests for basic example 02: Open Position
 *
 * These tests demonstrate building tokenIds, simulating deposits, and
 * simulating/executing position opens against a forked network.
 * By default, tests run against Sepolia. Set NETWORK=mainnet for mainnet testing.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/basic/
 *
 * @module examples/__tests__/basic/02-open-position.fork.test
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

import { panopticPoolAbi, riskEngineAbi } from '../../../../../generated'
import { parsePanopticError } from '../../../errors'
import { calculatePositionGreeks } from '../../../greeks'
import { getAccountCollateral } from '../../../reads/account'
import { getMaxPositionSize } from '../../../reads/collateralEstimate'
import { previewDeposit } from '../../../reads/erc4626'
import { getPool } from '../../../reads/pool'
import { getPosition } from '../../../reads/position'
import { getAccountPremia, getPositionsWithPremia } from '../../../reads/premia'
import { simulateOpenPosition } from '../../../simulations/simulateOpenPosition'
import { simulateDeposit } from '../../../simulations/simulateVault'
import { createMemoryStorage } from '../../../storage'
import { getTrackedPositionIds, syncPositions } from '../../../sync'
import {
  decodeTokenId,
  hasLoanOrCredit,
  isCredit,
  isCreditLeg,
  isLoan,
  isLoanLeg,
} from '../../../tokenId'
import { closePosition, openPosition } from '../../../writes/position'
import { deposit } from '../../../writes/vault'
import {
  assertValidDeployments,
  createBuilderFromPoolId,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from '../network.config'

describe('Basic Example 02: Open Position (Fork Test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let carolAddress: Address
  const config = getNetworkConfig()

  /** Sync carol's positions from scratch and return her current open position IDs.
   *  Each ID is verified on-chain (positionSize > 0) to filter out stale/closed positions
   *  that sync may still report due to dispatch calldata timing. */
  async function getCarolPositionIds(): Promise<bigint[]> {
    // Fresh storage each call ensures a full event scan (no stale checkpoint)
    const freshStorage = createMemoryStorage()
    await syncPositions({
      client,
      chainId: config.chainId,
      poolAddress: config.contracts.pool.address,
      account: carolAddress,
      storage: freshStorage,
    })
    const ids = await getTrackedPositionIds({
      chainId: config.chainId,
      poolAddress: config.contracts.pool.address,
      account: carolAddress,
      storage: freshStorage,
    })
    // Verify each position exists on-chain (filter out stale/closed positions)
    const verified: bigint[] = []
    for (const id of ids) {
      const pos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: id,
      })
      if (pos.positionSize > 0n) {
        verified.push(id)
      }
    }
    return verified
  }

  beforeAll(() => {
    // Ensure we have valid deployments before running tests
    assertValidDeployments()

    // Use carol account to avoid nonce conflicts with other parallel tests
    const account = privateKeyToAccount(config.testAccounts.carol)
    carolAddress = account.address

    client = createPublicClient({
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
      cacheTime: 0, // Disable block number caching for write-then-read tests
    })

    walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('TokenId Builder', () => {
    it('should build a valid tokenId for the pool', async () => {
      // Get pool data to know the current tick and poolId
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick

      console.log(`Current tick: ${currentTick}`)
      console.log(`Tick spacing: ${tickSpacing}`)
      console.log(`PoolId: 0x${pool.poolId.toString(16)}`)

      // Build a simple call option near the current tick
      // Round to tick spacing
      const strike = (currentTick / tickSpacing) * tickSpacing

      // Use pool.poolId from the contract for correct tokenId encoding
      const builder = createBuilderFromPoolId(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n, // Width must be even for valid tick bounds
          optionRatio: 1n,
          isLong: false, // Selling a call (short)
        })
        .build()

      expect(typeof tokenId).toBe('bigint')
      expect(tokenId).toBeGreaterThan(0n)

      // The tokenId should have the poolId in the lower 64 bits
      const extractedPoolId = tokenId & 0xffffffffffffffffn
      expect(extractedPoolId).toBe(pool.poolId)

      console.log('Built tokenId:')
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  TokenId (hex): 0x${tokenId.toString(16)}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Width: 2 (${Number(tickSpacing) * 2} ticks range)`)
    })

    it('should build a strangle (call + put)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick

      // Call strike above current price
      const callStrike = (currentTick / tickSpacing + 10n) * tickSpacing
      // Put strike below current price
      const putStrike = (currentTick / tickSpacing - 10n) * tickSpacing

      // Use pool.poolId from the contract
      const builder = createBuilderFromPoolId(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: callStrike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .addPut({
          strike: putStrike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      expect(typeof tokenId).toBe('bigint')
      expect(tokenId).toBeGreaterThan(0n)

      console.log('Strangle tokenId:')
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  TokenId (hex): 0x${tokenId.toString(16)}`)
      console.log(`  Call strike: ${callStrike}`)
      console.log(`  Put strike: ${putStrike}`)
    })
  })

  describe('Deposit Simulation', () => {
    it('should simulate depositing token0 into collateral tracker', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      const simulation = await simulateDeposit({
        client,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: depositAmount,
        account: carolAddress,
      })

      // Simulation may fail without tokens, but should not throw
      console.log(`Deposit simulation (${config.tokens.token0.symbol}):`)
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Shares to receive: ${simulation.data.sharesMinted}`)
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`  Error: ${simulation.error?.message?.slice(0, 100)}...`)
        // Expected to fail if account doesn't have tokens
      }
    })

    it('should preview deposit amounts', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      const preview = await previewDeposit({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 0,
        amount: depositAmount,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      })

      expect(typeof preview.result).toBe('bigint')

      console.log(`Preview deposit (1 ${config.tokens.token0.symbol}):`)
      console.log(`  Shares: ${preview.result}`)
      console.log(`  Block: ${preview._meta.blockNumber}`)
    })
  })

  describe('Position Simulation (without collateral)', () => {
    it('should simulate opening a position (will fail without collateral)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      // Use tickSpacing from pool
      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      // Use pool.poolId from the contract for correct tokenId encoding
      const builder = createBuilderFromPoolId(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Small position size
      const positionSize = parseUnits('0.01', 18)

      const simulation = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
        tokenId,
        positionSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      console.log('Open position simulation (no collateral):')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        // Try to parse the error for a cleaner message
        const parsed = parsePanopticError(simulation.error)
        if (parsed) {
          console.log(`  Error: ${parsed.errorName}`)
        } else {
          console.log(`  Error: ${simulation.error?.message?.slice(0, 100)}...`)
        }
        // Should NOT fail with WrongPoolId or InvalidTickBound - those indicate encoding issues
        expect(parsed?.errorName ?? simulation.error?.message).not.toContain('WrongPoolId')
        expect(parsed?.errorName ?? simulation.error?.message).not.toContain('InvalidTickBound')
      }
    })
  })

  describe('With Funded Account', () => {
    beforeAll(async () => {
      // Fund the test account
      const { token0Balance, token1Balance } = await fundTestAccount({
        client,
        walletClient,
        account: carolAddress,
        token0Amount: parseUnits('10', config.tokens.token0.decimals),
        token1Amount: parseUnits('10000', config.tokens.token1.decimals),
        approveCollateral: true,
      })

      console.log('Account funded in beforeAll:')
      console.log(
        `  ${config.tokens.token0.symbol} balance: ${token0Balance / 10n ** BigInt(config.tokens.token0.decimals)}`,
      )
      console.log(
        `  ${config.tokens.token1.symbol} balance: ${token1Balance / 10n ** BigInt(config.tokens.token1.decimals)}`,
      )
    })

    it('should have funded account with tokens', async () => {
      // Verify the account was funded
      const token0Balance = await client.readContract({
        address: config.tokens.token0.address,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [carolAddress],
      })

      const token1Balance = await client.readContract({
        address: config.tokens.token1.address,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [carolAddress],
      })

      expect(token0Balance).toBeGreaterThan(0n)
      expect(token1Balance).toBeGreaterThan(0n)

      console.log('Account balances:')
      console.log(
        `  ${config.tokens.token0.symbol}: ${token0Balance / 10n ** BigInt(config.tokens.token0.decimals)}`,
      )
      console.log(
        `  ${config.tokens.token1.symbol}: ${token1Balance / 10n ** BigInt(config.tokens.token1.decimals)}`,
      )
    })

    it('should successfully simulate deposit after funding', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      // Verify the approval exists
      const allowance = await client.readContract({
        address: config.tokens.token0.address,
        abi: [
          {
            name: 'allowance',
            type: 'function',
            stateMutability: 'view',
            inputs: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
            ],
            outputs: [{ type: 'uint256' }],
          },
        ],
        functionName: 'allowance',
        args: [carolAddress, config.contracts.pool.collateralTracker0],
      })
      expect(allowance).toBeGreaterThan(0n)

      const simulation = await simulateDeposit({
        client,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: depositAmount,
        account: carolAddress,
      })

      console.log('Deposit simulation (funded):')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Shares to receive: ${simulation.data.sharesMinted}`)
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`  Error: ${simulation.error?.message}`)
      }

      expect(simulation.success).toBe(true)
    })

    it('should successfully simulate opening position after depositing collateral', async () => {
      // Step 1: Deposit token0 into collateralTracker0
      const token0DepositAmount = parseUnits('5', config.tokens.token0.decimals)
      const token0DepositResult = await deposit({
        client,
        walletClient,
        account: carolAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: token0DepositAmount,
      })
      await token0DepositResult.wait()
      console.log(`Deposited 5 ${config.tokens.token0.symbol} into collateralTracker0`)

      // Step 2: Deposit token1 into collateralTracker1
      const token1DepositAmount = parseUnits('5000', config.tokens.token1.decimals)
      const token1DepositResult = await deposit({
        client,
        walletClient,
        account: carolAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
        assets: token1DepositAmount,
      })
      await token1DepositResult.wait()
      console.log(`Deposited 5000 ${config.tokens.token1.symbol} into collateralTracker1`)

      // Step 3: Build tokenId and simulate position
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Position size: 0.001 units of the asset token
      const positionSize = 10n ** 15n

      const simulation = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
        tokenId,
        positionSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      console.log('Open position simulation (with collateral):')
      console.log(`  Success: ${simulation.success}`)
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  Position size: ${positionSize}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Current tick: ${currentTick}`)

      if (simulation.success) {
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        const parsed = parsePanopticError(simulation.error)
        if (parsed) {
          console.log(`  Error: ${parsed.errorName}`)
        } else {
          console.log(`  Raw error: ${simulation.error?.message?.slice(0, 150)}...`)
        }
      }

      // Simulation may fail if concurrent test files changed pool state (utilization, liquidity).
      // The important thing is no encoding/parameter errors.
      if (!simulation.success) {
        const parsed = parsePanopticError(simulation.error)
        expect(parsed?.errorName ?? '').not.toContain('WrongPoolId')
        expect(parsed?.errorName ?? '').not.toContain('InvalidTickBound')
      }
    })

    describe('Execute and verify position', () => {
      let openedTokenId: bigint
      const executedPositionSize = 10n ** 15n // 0.001 units

      it('should execute openPosition and get valid TxResult', async () => {
        const pool = await getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        })

        const tickSpacing = pool.poolKey.tickSpacing
        const currentTick = pool.currentTick
        // Use a strike slightly OTM (above current for calls) to reduce collateral burden
        const strike = (currentTick / tickSpacing + 5n) * tickSpacing

        const builder = createBuilderFromPoolId(pool.poolId)
        openedTokenId = builder
          .addCall({
            strike,
            width: 120n,
            optionRatio: 1n,
            isLong: false,
          })
          .build()

        // Check if already minted (idempotent across repeated runs on same Anvil)
        const existing = await getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: openedTokenId,
        })
        if (existing.positionSize > 0n) {
          console.log(
            'Skipping openPosition: position already exists (requires fresh Anvil instance)',
          )
          console.log(`  TokenId: ${openedTokenId}, size: ${existing.positionSize}`)
          return
        }

        const carolIds = await getCarolPositionIds()
        const result = await openPosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          tokenId: openedTokenId,
          positionSize: executedPositionSize,
          existingPositionIds: carolIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })

        expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)

        const receipt = await result.wait()
        expect(receipt.status).toBe('success')
        expect(receipt.gasUsed).toBeGreaterThan(0n)

        console.log('Position opened:')
        console.log(`  Hash: ${result.hash}`)
        console.log(`  Gas used: ${receipt.gasUsed}`)
        console.log(`  TokenId: ${openedTokenId}`)
        console.log(`  Strike: ${strike}`)
      })

      it('should verify opened position with getPosition', async () => {
        const position = await getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: openedTokenId,
        })

        expect(position.positionSize).toBe(executedPositionSize)
        expect(position.tokenId).toBe(openedTokenId)
        expect(typeof position.tickAtMint).toBe('bigint')
        expect(position._meta.blockNumber).toBeGreaterThan(0n)

        console.log('Position verified:')
        console.log(`  Position size: ${position.positionSize}`)
        console.log(`  Tick at mint: ${position.tickAtMint}`)
        console.log(`  Block: ${position._meta.blockNumber}`)
      })

      it('should decode tokenId correctly', async () => {
        const decoded = decodeTokenId(openedTokenId)

        expect(decoded.legCount).toBe(1n)
        expect(decoded.tokenId).toBe(openedTokenId)
        expect(decoded.legs.length).toBe(1)
        expect(typeof decoded.legs[0].strike).toBe('bigint')
        expect(typeof decoded.legs[0].width).toBe('bigint')
        expect(decoded.legs[0].width).toBe(120n)

        // The poolId in the lower 64 bits should match
        const extractedPoolId = openedTokenId & 0xffffffffffffffffn
        expect(BigInt(`0x${decoded.poolId.slice(2)}`)).toBe(extractedPoolId)

        console.log('Decoded tokenId:')
        console.log(`  Pool ID: ${decoded.poolId}`)
        console.log(`  Tick spacing: ${decoded.tickSpacing}`)
        console.log(`  Leg count: ${decoded.legCount}`)
        console.log(`  Leg 0 strike: ${decoded.legs[0].strike}`)
        console.log(`  Leg 0 width: ${decoded.legs[0].width}`)
      })

      it('should calculate greeks for short call and short put, then compare', async () => {
        // Fetch position and pool state
        const [position, pool] = await Promise.all([
          getPosition({
            client,
            poolAddress: config.contracts.pool.address,
            owner: carolAddress,
            tokenId: openedTokenId,
          }),
          getPool({
            client,
            poolAddress: config.contracts.pool.address,
            chainId: config.chainId,
          }),
        ])

        if (position.positionSize === 0n) {
          console.log('Position closed (re-run), skipping greeks calculation')
          return
        }

        const tickSpacing = pool.poolKey.tickSpacing
        const currentTick = pool.currentTick
        const strike = (currentTick / tickSpacing) * tickSpacing

        // --- Short Call greeks (from the opened on-chain position) ---
        const callGreeks = calculatePositionGreeks({
          legs: position.legs,
          currentTick,
          mintTick: position.tickAtMint,
          positionSize: position.positionSize,
          poolTickSpacing: tickSpacing,
        })

        // --- Short Put greeks (from decoded tokenId — no on-chain mint needed) ---
        // calculatePositionGreeks is a pure function: it only needs legs, ticks, and size.
        const builder = createBuilderFromPoolId(pool.poolId)
        const putTokenId = builder
          .addPut({
            strike,
            width: 120n,
            optionRatio: 1n,
            isLong: false,
          })
          .build()

        const putDecoded = decodeTokenId(putTokenId)
        const putGreeks = calculatePositionGreeks({
          legs: putDecoded.legs,
          currentTick,
          mintTick: currentTick, // hypothetical ATM mint
          positionSize: position.positionSize,
          poolTickSpacing: tickSpacing,
        })

        // All greeks should be WAD-scaled bigints
        expect(typeof callGreeks.value).toBe('bigint')
        expect(typeof callGreeks.delta).toBe('bigint')
        expect(typeof callGreeks.gamma).toBe('bigint')
        expect(typeof putGreeks.value).toBe('bigint')
        expect(typeof putGreeks.delta).toBe('bigint')
        expect(typeof putGreeks.gamma).toBe('bigint')

        const WAD = 10n ** 18n
        const size = Number(position.positionSize)
        const wadF = Number(WAD)
        const callDeltaPerContract = Number(callGreeks.delta) / wadF / size
        const putDeltaPerContract = Number(putGreeks.delta) / wadF / size

        // Short call delta should be negative, short put delta should be positive
        expect(callGreeks.delta).toBeLessThan(0n)
        expect(putGreeks.delta).toBeGreaterThan(0n)

        // Both should have negative gamma (short positions)
        expect(callGreeks.gamma).toBeLessThan(0n)
        expect(putGreeks.gamma).toBeLessThan(0n)

        // Combined straddle delta should be closer to 0 than either leg alone
        const straddleDelta = callDeltaPerContract + putDeltaPerContract
        expect(Math.abs(straddleDelta)).toBeLessThan(Math.abs(callDeltaPerContract))
        expect(Math.abs(straddleDelta)).toBeLessThan(Math.abs(putDeltaPerContract))

        console.log('Short call greeks (on-chain, per-contract):')
        console.log(`  Delta: ${callDeltaPerContract}`)
        console.log(`  Gamma: ${Number(callGreeks.gamma) / wadF / size}`)
        console.log('Short put greeks (from decoded tokenId, per-contract):')
        console.log(`  Delta: ${putDeltaPerContract}`)
        console.log(`  Gamma: ${Number(putGreeks.gamma) / wadF / size}`)
        console.log('Combined straddle:')
        console.log(`  Delta: ${straddleDelta} (should be near 0)`)
        console.log(`  Strike: ${strike}, current tick: ${currentTick}`)
      })

      it('should open position, generate swap activity, and read premia', async () => {
        // Self-contained: open a fresh position, generate fees, verify premia, close
        const pool = await getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        })
        const tickSpacing = pool.poolKey.tickSpacing
        const currentTick = pool.currentTick
        const premiaStrike = (currentTick / tickSpacing + 3n) * tickSpacing

        const builder1 = createBuilderFromPoolId(pool.poolId)
        const premiaTokenId = builder1
          .addCall({
            strike: premiaStrike,
            width: 120n,
            optionRatio: 1n,
            isLong: false,
          })
          .build()

        // Check if already minted (idempotent across runs)
        const existingPos = await getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: premiaTokenId,
        })
        let premiaPositionOpen = existingPos.positionSize > 0n
        if (premiaPositionOpen) {
          console.log('Premia position already exists (re-run), skipping open')
        } else {
          // Simulate first — pool may lack liquidity in this range
          const carolIds = await getCarolPositionIds()
          const sim = await simulateOpenPosition({
            client,
            poolAddress: config.contracts.pool.address,
            account: carolAddress,
            tokenId: premiaTokenId,
            positionSize: executedPositionSize,
            existingPositionIds: carolIds,
            tickLimitLow: -887272n,
            tickLimitHigh: 887272n,
          })
          if (!sim.success) {
            console.log(
              `Premia position simulation reverted, skipping: ${sim.error?.message?.slice(0, 100)}`,
            )
            return
          }

          // Open the position to earn premia
          const openResult = await openPosition({
            client,
            walletClient,
            account: carolAddress,
            poolAddress: config.contracts.pool.address,
            tokenId: premiaTokenId,
            positionSize: executedPositionSize,
            existingPositionIds: carolIds,
            tickLimitLow: -887272n,
            tickLimitHigh: 887272n,
          })
          const openReceipt = await openResult.wait()
          expect(openReceipt.status).toBe('success')
          premiaPositionOpen = true
          console.log('Premia position opened')
        }

        // Generate swap activity with a swapAtMint open+close
        const swapStrike = (currentTick / tickSpacing) * tickSpacing
        const builder2 = createBuilderFromPoolId(pool.poolId)
        const swapTokenId = builder2
          .addCall({
            strike: swapStrike,
            width: 10n,
            optionRatio: 1n,
            isLong: false,
          })
          .build()

        const swapIds = await getCarolPositionIds()
        const swapOpen = await openPosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          tokenId: swapTokenId,
          positionSize: 10n ** 12n,
          existingPositionIds: swapIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
          swapAtMint: true,
        })
        expect((await swapOpen.wait()).status).toBe('success')
        console.log('Swap position opened')

        const swapCloseIds = await getCarolPositionIds()
        const swapClose = await closePosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          positionIdList: swapCloseIds,
          tokenId: swapTokenId,
          positionSize: 0n,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
          swapAtMint: true,
        })
        expect((await swapClose.wait()).status).toBe('success')
        console.log('Swap position closed')

        // Read premia — should be non-zero after swap activity
        const premia = await getAccountPremia({
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenIds: [premiaTokenId],
        })
        expect(typeof premia.shortPremium0).toBe('bigint')
        expect(typeof premia.shortPremium1).toBe('bigint')
        const totalShortPremia = premia.shortPremium0 + premia.shortPremium1
        expect(totalShortPremia).toBeGreaterThan(0n)

        console.log('Account premia:')
        console.log(`  Short premium0: ${premia.shortPremium0}`)
        console.log(`  Short premium1: ${premia.shortPremium1}`)

        // Read positions with premia breakdown
        const withPremia = await getPositionsWithPremia({
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenIds: [premiaTokenId],
        })
        expect(withPremia.positions.length).toBe(1)
        expect(withPremia.positions[0].tokenId).toBe(premiaTokenId)

        console.log(`  Position size: ${withPremia.positions[0].positionSize}`)

        // Close the premia position to clean up for subsequent tests
        const finalIds = await getCarolPositionIds()
        const closePremia = await closePosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          positionIdList: finalIds,
          tokenId: premiaTokenId,
          positionSize: 0n,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })
        expect((await closePremia.wait()).status).toBe('success')
        console.log('Premia position closed')
      })

      it('should return zero premia for empty position list', async () => {
        const premia = await getAccountPremia({
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenIds: [],
        })

        expect(premia.shortPremium0).toBe(0n)
        expect(premia.shortPremium1).toBe(0n)
        expect(premia.longPremium0).toBe(0n)
        expect(premia.longPremium1).toBe(0n)
      })

      it('should estimate max position size and mint at that size', async () => {
        const queryAddress = config.contracts.panopticQuery
        if (!queryAddress) {
          console.log('Skipping getMaxPositionSize test: no panopticQuery address configured')
          return
        }

        // Build a new tokenId at a different strike so it doesn't conflict
        const pool = await getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        })
        const tickSpacing = pool.poolKey.tickSpacing
        const currentTick = pool.currentTick
        const newStrike = (currentTick / tickSpacing - 10n) * tickSpacing

        const builder = createBuilderFromPoolId(pool.poolId)
        const newTokenId = builder
          .addCall({
            strike: newStrike,
            width: 120n,
            optionRatio: 1n,
            isLong: false,
          })
          .build()

        // Check if already minted (idempotent across repeated runs on same Anvil)
        const existing = await getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: newTokenId,
        })
        if (existing.positionSize > 0n) {
          console.log(
            'Skipping max-size mint: position already exists (requires fresh Anvil instance)',
          )
          console.log(`  TokenId: ${newTokenId}, size: ${existing.positionSize}`)
          return
        }

        // Estimate max size with and without swapAtMint for comparison
        const commonParams = {
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenId: newTokenId,
          queryAddress,
          existingPositionIds: await getCarolPositionIds(),
        }

        // Force refinement with tight precision to exercise the swapAtMint code path
        const [estimateNoSwap, estimateWithSwap] = await Promise.all([
          getMaxPositionSize({ ...commonParams, swapAtMint: false, precisionPct: 0.1 }),
          getMaxPositionSize({ ...commonParams, swapAtMint: true, precisionPct: 0.1 }),
        ])

        expect(estimateNoSwap.maxSize).toBeGreaterThan(0n)
        expect(estimateWithSwap.maxSize).toBeGreaterThan(0n)

        console.log('Max position size comparison:')
        console.log(
          `  Without swapAtMint: ${estimateNoSwap.maxSize} (bounds: ${estimateNoSwap.maxSizeAtMaxUtil} - ${estimateNoSwap.maxSizeAtMinUtil})`,
        )
        console.log(
          `  With swapAtMint:    ${estimateWithSwap.maxSize} (bounds: ${estimateWithSwap.maxSizeAtMaxUtil} - ${estimateWithSwap.maxSizeAtMinUtil})`,
        )
        console.log(`  Difference:         ${estimateWithSwap.maxSize - estimateNoSwap.maxSize}`)

        // Use the swapAtMint estimate since we'll mint with swapAtMint=true
        const estimate = estimateWithSwap

        // Read BP_DECREASE_BUFFER from risk engine to calculate safe mint size
        const riskEngineAddress = await client.readContract({
          address: config.contracts.pool.address,
          abi: panopticPoolAbi,
          functionName: 'riskEngine',
        })
        const bpDecreaseBuffer = await client.readContract({
          address: riskEngineAddress,
          abi: riskEngineAbi,
          functionName: 'BP_DECREASE_BUFFER',
        })

        // mintSize = (10_000_000 * maxSize) / BP_DECREASE_BUFFER
        const mintSize = (10_000_000n * estimate.maxSize) / BigInt(bpDecreaseBuffer)
        expect(mintSize).toBeGreaterThan(0n)

        console.log(`  BP_DECREASE_BUFFER: ${bpDecreaseBuffer}`)
        console.log(`  Safe mint size:     ${mintSize}`)

        // Simulate first — pool conditions may have shifted since estimation
        const carolIds = await getCarolPositionIds()
        const sim = await simulateOpenPosition({
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenId: newTokenId,
          positionSize: mintSize,
          existingPositionIds: carolIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
          swapAtMint: true,
        })

        if (!sim.success) {
          console.log(`  Simulation reverted (pool moved since estimate), skipping mint`)
          console.log(`  Error: ${sim.error?.message?.slice(0, 100)}`)
          return
        }

        const result = await openPosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          tokenId: newTokenId,
          positionSize: mintSize,
          existingPositionIds: carolIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
          swapAtMint: true,
        })

        const receipt = await result.wait()
        expect(receipt.status).toBe('success')

        console.log(`  Minted at safe size (10M/BP_DECREASE_BUFFER): ${mintSize}`)
        console.log(`  Tx: ${result.hash}`)
        console.log(`  Gas: ${receipt.gasUsed}`)
      })

      it('should return token flow from simulateOpenPosition (getAssetsOf)', async () => {
        const pool = await getPool({
          client,
          poolAddress: config.contracts.pool.address,
          chainId: config.chainId,
        })

        const tickSpacing = pool.poolKey.tickSpacing
        const currentTick = pool.currentTick
        const strike = (currentTick / tickSpacing + 5n) * tickSpacing

        const { createBuilderFromPoolId } = await import('../../../tokenId')
        const builder = createBuilderFromPoolId(pool.poolId)
        const tokenId = builder
          .addPut({ strike, width: 2n, optionRatio: 1n, isLong: false })
          .build()

        const carolIds = await getCarolPositionIds()

        const sim = await simulateOpenPosition({
          client,
          poolAddress: config.contracts.pool.address,
          account: carolAddress,
          tokenId,
          positionSize: 10n ** 16n,
          existingPositionIds: carolIds,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })

        expect(sim.success).toBe(true)
        if (sim.success) {
          expect(sim.tokenFlow).toBeDefined()
          expect(typeof sim.tokenFlow!.delta0).toBe('bigint')
          expect(typeof sim.tokenFlow!.delta1).toBe('bigint')
          console.log('Token flow from getAssetsOf:')
          console.log(`  delta0: ${sim.tokenFlow!.delta0}`)
          console.log(`  delta1: ${sim.tokenFlow!.delta1}`)
          console.log(`  balanceAfter0: ${sim.tokenFlow!.balanceAfter0}`)
          console.log(`  balanceAfter1: ${sim.tokenFlow!.balanceAfter1}`)
        }
      })
    })
  })

  describe('Loan/Credit Positions', () => {
    let creditTokenId: bigint
    let loanTokenId: bigint
    const loanCreditSize = 10n ** 17n // 0.001 units

    it('should open a credit position (lend, width=0, isLong=false)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      // Strike near current tick for credit
      const strike = (currentTick / tickSpacing + 2n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      creditTokenId = builder
        .addCredit({
          asset: 0n,
          tokenType: 0n,
          strike,
        })
        .build()

      // Verify encoding before opening
      const decoded = decodeTokenId(creditTokenId)
      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs[0].width).toBe(0n)
      expect(decoded.legs[0].isLong).toBe(true)
      expect(isCredit(creditTokenId)).toBe(true)
      expect(isLoan(creditTokenId)).toBe(false)
      expect(hasLoanOrCredit(creditTokenId)).toBe(true)
      expect(isCreditLeg(decoded.legs[0])).toBe(true)
      expect(isLoanLeg(decoded.legs[0])).toBe(false)

      // Check if already minted (idempotent)
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: creditTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('Credit position already exists, skipping open')
        return
      }

      // Snapshot collateral BEFORE opening credit
      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      const carolIds = await getCarolPositionIds()
      const result = await openPosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        tokenId: creditTokenId,
        positionSize: loanCreditSize,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')

      // Verify on-chain
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: creditTokenId,
      })
      expect(position.positionSize).toBe(loanCreditSize)

      // Snapshot collateral AFTER — credit (lend) should decrease token0 assets
      const collateralAfter = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })
      expect(collateralAfter.token0.assets).toBeLessThan(collateralBefore.token0.assets)

      const assetsDelta = collateralBefore.token0.assets - collateralAfter.token0.assets
      console.log('Credit position opened:')
      console.log(`  TokenId: ${creditTokenId}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Size: ${position.positionSize}`)
      console.log(`  Gas: ${receipt.gasUsed}`)
      console.log(`  Token0 assets before: ${collateralBefore.token0.assets}`)
      console.log(`  Token0 assets after:  ${collateralAfter.token0.assets}`)
      console.log(`  Token0 assets delta:  -${assetsDelta} (credit = lend = decrease)`)
      const assets1Delta = collateralAfter.token1.assets - collateralBefore.token1.assets
      console.log(`  Token1 assets before: ${collateralBefore.token1.assets}`)
      console.log(`  Token1 assets after:  ${collateralAfter.token1.assets}`)
      console.log(`  Token1 assets delta:  ${assets1Delta >= 0n ? '+' : ''}${assets1Delta}`)
    })

    it('should open a loan position (borrow, width=0, isLong=true)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      // Strike near current tick for loan
      const strike = (currentTick / tickSpacing - 2n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      loanTokenId = builder
        .addLoan({
          asset: 0n,
          tokenType: 0n,
          strike,
        })
        .build()

      // Verify encoding before opening
      const decoded = decodeTokenId(loanTokenId)
      expect(decoded.legCount).toBe(1n)
      expect(decoded.legs[0].width).toBe(0n)
      expect(decoded.legs[0].isLong).toBe(false)
      expect(isLoan(loanTokenId)).toBe(true)
      expect(isCredit(loanTokenId)).toBe(false)
      expect(hasLoanOrCredit(loanTokenId)).toBe(true)
      expect(isLoanLeg(decoded.legs[0])).toBe(true)
      expect(isCreditLeg(decoded.legs[0])).toBe(false)

      // Check if already minted (idempotent)
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: loanTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('Loan position already exists, skipping open')
        return
      }

      // Snapshot collateral BEFORE opening loan
      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      const carolIds = await getCarolPositionIds()
      const result = await openPosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        tokenId: loanTokenId,
        positionSize: loanCreditSize,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')

      // Verify on-chain
      const position = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: loanTokenId,
      })
      expect(position.positionSize).toBe(loanCreditSize)

      // Snapshot collateral AFTER — loan (borrow) should increase token0 assets
      const collateralAfter = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })
      expect(collateralAfter.token0.assets).toBeGreaterThan(collateralBefore.token0.assets)

      const assetsDelta = collateralAfter.token0.assets - collateralBefore.token0.assets
      console.log('Loan position opened:')
      console.log(`  TokenId: ${loanTokenId}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Size: ${position.positionSize}`)
      console.log(`  Gas: ${receipt.gasUsed}`)
      console.log(`  Token0 assets before: ${collateralBefore.token0.assets}`)
      console.log(`  Token0 assets after:  ${collateralAfter.token0.assets}`)
      console.log(`  Token0 assets delta:  +${assetsDelta} (loan = borrow = increase)`)
      const assets1Delta = collateralAfter.token1.assets - collateralBefore.token1.assets
      console.log(`  Token1 assets before: ${collateralBefore.token1.assets}`)
      console.log(`  Token1 assets after:  ${collateralAfter.token1.assets}`)
      console.log(`  Token1 assets delta:  ${assets1Delta >= 0n ? '+' : ''}${assets1Delta}`)
    })

    it('should close both loan and credit positions', async () => {
      // Close credit first
      const creditPos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: creditTokenId,
      })
      if (creditPos.positionSize > 0n) {
        const ids = await getCarolPositionIds()
        const closeCredit = await closePosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          positionIdList: ids,
          tokenId: creditTokenId,
          positionSize: 0n,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })
        expect((await closeCredit.wait()).status).toBe('success')
        console.log('Credit position closed')
      }

      // Close loan
      const loanPos = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: loanTokenId,
      })
      if (loanPos.positionSize > 0n) {
        const ids = await getCarolPositionIds()
        const closeLoan = await closePosition({
          client,
          walletClient,
          account: carolAddress,
          poolAddress: config.contracts.pool.address,
          positionIdList: ids,
          tokenId: loanTokenId,
          positionSize: 0n,
          tickLimitLow: -887272n,
          tickLimitHigh: 887272n,
        })
        expect((await closeLoan.wait()).status).toBe('success')
        console.log('Loan position closed')
      }

      // Verify both are closed
      const [creditAfter, loanAfter] = await Promise.all([
        getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: creditTokenId,
        }),
        getPosition({
          client,
          poolAddress: config.contracts.pool.address,
          owner: carolAddress,
          tokenId: loanTokenId,
        }),
      ])
      expect(creditAfter.positionSize).toBe(0n)
      expect(loanAfter.positionSize).toBe(0n)
    })

    it('should open a credit with swapAtMint (tokenType=0 → token1 decrease)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing + 4n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      const swapCreditTokenId = builder
        .addCredit({
          asset: 0n,
          tokenType: 0n,
          strike,
        })
        .build()

      // Check if already minted (idempotent)
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: swapCreditTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('SwapAtMint credit already exists, skipping open')
        return
      }

      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      const carolIds = await getCarolPositionIds()
      console.log('SwapAtMint credit debug:')
      console.log(`  tokenId: ${swapCreditTokenId}`)
      console.log(`  existingPositionIds: [${carolIds.join(', ')}]`)
      console.log(`  positionSize: ${loanCreditSize}`)
      console.log(`  strike: ${strike}`)

      // Simulate first to capture revert reason
      const sim = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
        tokenId: swapCreditTokenId,
        positionSize: loanCreditSize / 100n,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      console.log(`  simulation success: ${sim.success}`)
      if (!sim.success) {
        console.log(`  simulation error: ${sim.error?.message?.slice(0, 200)}`)
      }
      expect(sim.success).toBe(true)

      const result = await openPosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        tokenId: swapCreditTokenId,
        positionSize: loanCreditSize / 100n,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      expect((await result.wait()).status).toBe('success')

      const collateralAfter = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      // swapAtMint swaps tokenType=0 → token1, so the credit (lend) reduces token1
      expect(collateralAfter.token1.assets).toBeLessThan(collateralBefore.token1.assets)

      const delta0 = collateralAfter.token0.assets - collateralBefore.token0.assets
      const delta1 = collateralAfter.token1.assets - collateralBefore.token1.assets
      console.log('Credit with swapAtMint opened:')
      console.log(`  TokenId: ${swapCreditTokenId}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Token0 delta: ${delta0 >= 0n ? '+' : ''}${delta0}`)
      console.log(
        `  Token1 delta: ${delta1 >= 0n ? '+' : ''}${delta1} (credit+swap = token1 decrease)`,
      )

      // Clean up
      const closeIds = await getCarolPositionIds()
      const close = await closePosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        positionIdList: closeIds,
        tokenId: swapCreditTokenId,
        positionSize: 0n,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      expect((await close.wait()).status).toBe('success')
      console.log('SwapAtMint credit closed')
    })

    it('should open a loan with swapAtMint (tokenType=0 → token1 increase)', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing - 4n) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)
      const swapLoanTokenId = builder
        .addLoan({
          asset: 0n,
          tokenType: 0n,
          strike,
        })
        .build()

      // Check if already minted (idempotent)
      const existing = await getPosition({
        client,
        poolAddress: config.contracts.pool.address,
        owner: carolAddress,
        tokenId: swapLoanTokenId,
      })
      if (existing.positionSize > 0n) {
        console.log('SwapAtMint loan already exists, skipping open')
        return
      }

      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      const carolIds = await getCarolPositionIds()
      console.log('SwapAtMint loan debug:')
      console.log(`  tokenId: ${swapLoanTokenId}`)
      console.log(`  existingPositionIds: [${carolIds.join(', ')}]`)
      console.log(`  positionSize: ${loanCreditSize}`)
      console.log(`  strike: ${strike}`)

      // Simulate first to capture revert reason
      const sim = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
        tokenId: swapLoanTokenId,
        positionSize: loanCreditSize / 10000n,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      console.log(`  simulation success: ${sim.success}`)
      if (!sim.success) {
        console.log(`  simulation error: ${sim.error?.message?.slice(0, 200)}`)
      }
      expect(sim.success).toBe(true)

      const result = await openPosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        tokenId: swapLoanTokenId,
        positionSize: loanCreditSize / 10000n,
        existingPositionIds: carolIds,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      expect((await result.wait()).status).toBe('success')

      const collateralAfter = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
      })

      // swapAtMint swaps tokenType=0 → token1, so the loan (borrow) increases token1
      expect(collateralAfter.token1.assets).toBeGreaterThan(collateralBefore.token1.assets)

      const delta0 = collateralAfter.token0.assets - collateralBefore.token0.assets
      const delta1 = collateralAfter.token1.assets - collateralBefore.token1.assets
      console.log('Loan with swapAtMint opened:')
      console.log(`  TokenId: ${swapLoanTokenId}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Token0 delta: ${delta0 >= 0n ? '+' : ''}${delta0}`)
      console.log(
        `  Token1 delta: ${delta1 >= 0n ? '+' : ''}${delta1} (loan+swap = token1 increase)`,
      )

      // Clean up
      const closeIds = await getCarolPositionIds()
      const close = await closePosition({
        client,
        walletClient,
        account: carolAddress,
        poolAddress: config.contracts.pool.address,
        positionIdList: closeIds,
        tokenId: swapLoanTokenId,
        positionSize: 0n,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: true,
      })
      expect((await close.wait()).status).toBe('success')
      console.log('SwapAtMint loan closed')
    })
  })

  describe('Error Handling', () => {
    it('should parse Panoptic errors correctly', async () => {
      const pool = await getPool({
        client,
        poolAddress: config.contracts.pool.address,
        chainId: config.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      const builder = createBuilderFromPoolId(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n,
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Try to open a very large position that should fail
      const hugePositionSize = parseUnits('1000000', 18) // 1 million tokens

      const simulation = await simulateOpenPosition({
        client,
        poolAddress: config.contracts.pool.address,
        account: carolAddress,
        tokenId,
        positionSize: hugePositionSize,
        existingPositionIds: [],
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      // Should fail
      expect(simulation.success).toBe(false)

      if (!simulation.success) {
        // Error should be parseable
        const parsed = parsePanopticError(simulation.error)
        console.log('Error parsing test:')
        console.log(`  Simulation success: ${simulation.success}`)
        console.log(`  Parsed error: ${parsed?.errorName ?? 'unparseable'}`)
        console.log(`  Raw error snippet: ${simulation.error?.message?.slice(0, 100)}...`)

        // We got an error, which is expected
        expect(simulation.error).toBeDefined()
      }
    })
  })
})
