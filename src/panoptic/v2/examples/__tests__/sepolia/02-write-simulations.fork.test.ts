/**
 * Write simulation tests against Sepolia fork
 *
 * These tests verify that write operations can be simulated
 * against the deployed Panoptic v2 contracts on Sepolia.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/sepolia/
 *
 * @module examples/__tests__/sepolia/02-write-simulations.fork.test
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
import { sepolia } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'

import { parsePanopticError } from '../../../errors'
import { previewDeposit } from '../../../reads/erc4626'
import { getPool } from '../../../reads/pool'
import { simulateOpenPosition } from '../../../simulations/simulateOpenPosition'
import { simulateDeposit } from '../../../simulations/simulateVault'
import { deposit } from '../../../writes/vault'
import {
  createTokenIdBuilder,
  fundSepoliaTestAccount,
  getAnvilRpcUrl,
  SEPOLIA_ANVIL_CONFIG,
  SEPOLIA_CONTRACTS,
  SEPOLIA_TOKENS,
} from '../sepolia.config'

describe('Sepolia Fork: Write Simulations', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let aliceAddress: Address

  beforeAll(() => {
    const account = privateKeyToAccount(SEPOLIA_ANVIL_CONFIG.testAccounts.alice)
    aliceAddress = account.address

    client = createPublicClient({
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
    })

    walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(getAnvilRpcUrl()),
    })
  })

  describe('TokenId Builder', () => {
    it('should build a valid tokenId for the Sepolia pool', async () => {
      // Get pool data to know the current tick and poolId
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
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
      const builder = createTokenIdBuilder(pool.poolId)

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

      console.log('Built tokenId:')
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  TokenId (hex): 0x${tokenId.toString(16)}`)
      console.log(`  Strike: ${strike}`)
      console.log(`  Width: 2 (20 ticks range)`)
    })

    it('should build a strangle (call + put)', async () => {
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick

      // Call strike above current price
      const callStrike = (currentTick / tickSpacing + 10n) * tickSpacing
      // Put strike below current price
      const putStrike = (currentTick / tickSpacing - 10n) * tickSpacing

      // Use pool.poolId from the contract
      const builder = createTokenIdBuilder(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: callStrike,
          width: 2n, // Width must be even for valid tick bounds
          optionRatio: 1n,
          isLong: false,
        })
        .addPut({
          strike: putStrike,
          width: 2n, // Width must be even for valid tick bounds
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      expect(typeof tokenId).toBe('bigint')
      console.log('Strangle tokenId:')
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  TokenId (hex): 0x${tokenId.toString(16)}`)
      console.log(`  Call strike: ${callStrike}`)
      console.log(`  Put strike: ${putStrike}`)
    })
  })

  describe('simulateDeposit()', () => {
    it('should simulate depositing WETH into collateral tracker', async () => {
      const depositAmount = parseUnits('1', SEPOLIA_TOKENS.WETH.decimals) // 1 WETH

      const simulation = await simulateDeposit({
        client,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        assets: depositAmount,
        account: aliceAddress,
      })

      // Simulation should work (though execution would fail without tokens)
      console.log('Deposit simulation (WETH):')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Shares to receive: ${simulation.data.sharesMinted}`)
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`  Error: ${simulation.error?.message}`)
        // Expected to fail if account doesn't have WETH
      }
    })

    it('should preview deposit amounts', async () => {
      const depositAmount = parseUnits('1', SEPOLIA_TOKENS.WETH.decimals)

      const preview = await previewDeposit({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        tokenIndex: 0, // WETH is token0
        amount: depositAmount,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
      })

      expect(typeof preview.result).toBe('bigint')
      console.log('Preview deposit (1 WETH):')
      console.log(`  Shares: ${preview.result}`)
      console.log(`  Block: ${preview._meta.blockNumber}`)
    })
  })

  describe('simulateOpenPosition()', () => {
    it('should simulate opening a position (will fail without collateral)', async () => {
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
      })

      // Use tickSpacing from pool
      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      // Use pool.poolId from the contract for correct tokenId encoding
      const builder = createTokenIdBuilder(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n, // Width must be even so tick bounds are multiples of tickSpacing
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Position size corresponds to the token amount for the `asset` flag in tokenId
      // 0.01 * 10^18 = position moving 0.01 units of the asset token
      const positionSize = parseUnits('0.01', 18)

      const simulation = await simulateOpenPosition({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        account: aliceAddress,
        tokenId,
        positionSize,
        existingPositionIds: [], // No existing positions
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
      })

      console.log('Open position simulation:')
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
        // Expected to fail without collateral, but NOT with WrongPoolId or InvalidTickBound
        expect(parsed?.errorName ?? simulation.error?.message).not.toContain('WrongPoolId')
        expect(parsed?.errorName ?? simulation.error?.message).not.toContain('InvalidTickBound')
      }
    })
  })

  describe('With Funded Account', () => {
    // Fund the account BEFORE any tests in this block run
    beforeAll(async () => {
      // Fund the test account using Anvil's ETH
      // - Wraps ETH to WETH via WETH9.deposit()
      // - Mints USDC via testnet USDC.mint()
      // - Approves collateral trackers
      const { wethBalance, usdcBalance } = await fundSepoliaTestAccount({
        client,
        walletClient,
        account: aliceAddress,
        wethAmount: parseUnits('10', SEPOLIA_TOKENS.WETH.decimals), // 10 WETH
        usdcAmount: parseUnits('10000', SEPOLIA_TOKENS.USDC.decimals), // 10,000 USDC
        approveCollateral: true,
      })

      console.log('Account funded in beforeAll:')
      console.log(`  WETH balance: ${wethBalance / 10n ** 18n} WETH`)
      console.log(`  USDC balance: ${usdcBalance / 10n ** 6n} USDC`)
    })

    it('should fund account with WETH and USDC', async () => {
      // Verify the account was funded (checking balances)
      const wethBalance = await client.readContract({
        address: SEPOLIA_TOKENS.WETH.address,
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
        args: [aliceAddress],
      })

      const usdcBalance = await client.readContract({
        address: SEPOLIA_TOKENS.USDC.address,
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
        args: [aliceAddress],
      })

      expect(wethBalance).toBeGreaterThan(0n)
      expect(usdcBalance).toBeGreaterThan(0n)

      console.log('Account funded:')
      console.log(`  WETH balance: ${wethBalance / 10n ** 18n} WETH`)
      console.log(`  USDC balance: ${usdcBalance / 10n ** 6n} USDC`)
    })

    it('should successfully simulate deposit after funding', async () => {
      const depositAmount = parseUnits('1', SEPOLIA_TOKENS.WETH.decimals) // 1 WETH

      // First, verify the approval exists
      const allowance = await client.readContract({
        address: SEPOLIA_TOKENS.WETH.address,
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
        args: [aliceAddress, SEPOLIA_CONTRACTS.pool.collateralTracker0],
      })
      console.log(`WETH allowance for CollateralTracker0: ${allowance}`)
      expect(allowance).toBeGreaterThan(0n)

      // Check WETH balance
      const wethBalance = await client.readContract({
        address: SEPOLIA_TOKENS.WETH.address,
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
        args: [aliceAddress],
      })
      console.log(`WETH balance: ${wethBalance}`)
      expect(wethBalance).toBeGreaterThanOrEqual(depositAmount)

      const simulation = await simulateDeposit({
        client,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        assets: depositAmount,
        account: aliceAddress,
      })

      console.log('Deposit simulation (funded):')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Shares to receive: ${simulation.data.sharesMinted}`)
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`  Error: ${simulation.error?.message}`)
      }

      // Now it should succeed because account has WETH and approval
      expect(simulation.success).toBe(true)
    })

    it('should successfully simulate USDC deposit', async () => {
      const depositAmount = parseUnits('1000', SEPOLIA_TOKENS.USDC.decimals) // 1000 USDC

      // Verify the approval exists
      const allowance = await client.readContract({
        address: SEPOLIA_TOKENS.USDC.address,
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
        args: [aliceAddress, SEPOLIA_CONTRACTS.pool.collateralTracker1],
      })
      console.log(`USDC allowance for CollateralTracker1: ${allowance}`)
      expect(allowance).toBeGreaterThan(0n)

      // Check USDC balance
      const usdcBalance = await client.readContract({
        address: SEPOLIA_TOKENS.USDC.address,
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
        args: [aliceAddress],
      })
      console.log(`USDC balance: ${usdcBalance}`)
      expect(usdcBalance).toBeGreaterThanOrEqual(depositAmount)

      const simulation = await simulateDeposit({
        client,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker1,
        assets: depositAmount,
        account: aliceAddress,
      })

      console.log('USDC Deposit simulation:')
      console.log(`  Success: ${simulation.success}`)
      if (simulation.success) {
        console.log(`  Shares to receive: ${simulation.data.sharesMinted}`)
        console.log(`  Gas estimate: ${simulation.gasEstimate}`)
      } else {
        console.log(`  Error: ${simulation.error?.message}`)
      }

      expect(simulation.success).toBe(true)
    })

    it('should build tokenId with correct poolId from contract', async () => {
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      // Use pool.poolId directly - it's the 64-bit encoded value from the contract
      const builder = createTokenIdBuilder(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n, // Width must be even for valid tick bounds
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      console.log('TokenId with correct poolId:')
      console.log(`  PoolId from contract: 0x${pool.poolId.toString(16)}`)
      console.log(`  TokenId: ${tokenId}`)
      console.log(`  TokenId (hex): 0x${tokenId.toString(16)}`)
      console.log(`  Strike: ${strike}`)

      // The tokenId should have the poolId in the lower 64 bits
      const extractedPoolId = tokenId & 0xffffffffffffffffn
      expect(extractedPoolId).toBe(pool.poolId)
    })

    it('should successfully simulate opening position after depositing collateral', async () => {
      // Step 1: Deposit WETH into collateralTracker0
      const wethDepositAmount = parseUnits('5', SEPOLIA_TOKENS.WETH.decimals) // 5 WETH
      const wethDepositResult = await deposit({
        client,
        walletClient,
        account: aliceAddress,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker0,
        assets: wethDepositAmount,
      })
      await wethDepositResult.wait()
      console.log('Deposited 5 WETH into collateralTracker0')

      // Step 2: Deposit USDC into collateralTracker1
      const usdcDepositAmount = parseUnits('5000', SEPOLIA_TOKENS.USDC.decimals) // 5000 USDC
      const usdcDepositResult = await deposit({
        client,
        walletClient,
        account: aliceAddress,
        collateralTrackerAddress: SEPOLIA_CONTRACTS.pool.collateralTracker1,
        assets: usdcDepositAmount,
      })
      await usdcDepositResult.wait()
      console.log('Deposited 5000 USDC into collateralTracker1')

      // Step 3: Build tokenId and simulate position
      const pool = await getPool({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        chainId: SEPOLIA_ANVIL_CONFIG.chainId,
      })

      const tickSpacing = pool.poolKey.tickSpacing
      const currentTick = pool.currentTick
      const strike = (currentTick / tickSpacing) * tickSpacing

      // Use pool.poolId directly from the contract
      const builder = createTokenIdBuilder(pool.poolId)

      const tokenId = builder
        .addCall({
          strike: strike,
          width: 2n, // Width must be even for valid tick bounds
          optionRatio: 1n,
          isLong: false,
        })
        .build()

      // Position size corresponds to the token amount matching the `asset` flag in the tokenId
      // addCall() defaults to asset=0 (token0=WETH), so positionSize is in WETH units
      // 10^15 = 0.001 WETH (since WETH has 18 decimals)
      const positionSize = 10n ** 15n

      const simulation = await simulateOpenPosition({
        client,
        poolAddress: SEPOLIA_CONTRACTS.pool.address,
        account: aliceAddress,
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
        // Try to parse the error for a cleaner message
        const parsed = parsePanopticError(simulation.error)
        const errorMsg = simulation.error?.message ?? ''

        if (parsed) {
          console.log(`  Error: ${parsed.errorName}`)
        } else {
          console.log(`  Raw error: ${errorMsg.slice(0, 150)}...`)
        }
      }

      // With collateral deposited and appropriate position size, simulation should succeed
      expect(simulation.success).toBe(true)
    })
  })
})
