/**
 * Fork tests for basic example 04: Vault Operations
 *
 * These tests demonstrate ERC4626 vault operations (deposit, withdraw, preview,
 * convert) against a forked network.
 * By default, tests run against Sepolia. Set NETWORK=mainnet for mainnet testing.
 *
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL environment variable (or FORK_URL for mainnet)
 * 2. Start Anvil: anvil --fork-url $SEPOLIA_RPC_URL
 * 3. Run tests: pnpm vitest run src/panoptic/v2/examples/__tests__/basic/
 *
 * @module examples/__tests__/basic/04-vault-operations.fork.test
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

import { getAccountCollateral } from '../../../reads/account'
import {
  convertToAssets,
  convertToShares,
  previewDeposit,
  previewWithdraw,
} from '../../../reads/erc4626'
import { deposit, depositAndWait, withdraw } from '../../../writes/vault'
import {
  assertValidDeployments,
  fundTestAccount,
  getAnvilRpcUrl,
  getNetworkConfig,
} from '../network.config'

describe('Basic Example 04: Vault Operations (Fork Test)', () => {
  let client: PublicClient
  let walletClient: WalletClient
  let daveAddress: Address
  const config = getNetworkConfig()

  beforeAll(async () => {
    assertValidDeployments()

    // Use dave account to avoid nonce conflicts with other basic tests
    const account = privateKeyToAccount(config.testAccounts.dave)
    daveAddress = account.address

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

    // Fund dave with WETH and USDC, approve collateral trackers
    const { token0Balance, token1Balance } = await fundTestAccount({
      client,
      walletClient,
      account: daveAddress,
      token0Amount: parseUnits('10', config.tokens.token0.decimals),
      token1Amount: parseUnits('10000', config.tokens.token1.decimals),
      approveCollateral: true,
    })

    console.log('Dave funded:')
    console.log(
      `  ${config.tokens.token0.symbol}: ${token0Balance / 10n ** BigInt(config.tokens.token0.decimals)}`,
    )
    console.log(
      `  ${config.tokens.token1.symbol}: ${token1Balance / 10n ** BigInt(config.tokens.token1.decimals)}`,
    )
  })

  describe('ERC4626 Preview Functions', () => {
    it('should preview deposit for token0', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      const preview = await previewDeposit({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 0,
        amount: depositAmount,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      })

      expect(typeof preview.result).toBe('bigint')
      expect(preview.result).toBeGreaterThan(0n)
      expect(preview._meta.blockNumber).toBeGreaterThan(0n)

      console.log(`Preview deposit 1 ${config.tokens.token0.symbol}:`)
      console.log(`  Shares: ${preview.result}`)
      console.log(`  Block: ${preview._meta.blockNumber}`)
    })

    it('should preview deposit for token1', async () => {
      const depositAmount = parseUnits('1000', config.tokens.token1.decimals)

      const preview = await previewDeposit({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 1,
        amount: depositAmount,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
      })

      expect(typeof preview.result).toBe('bigint')
      expect(preview.result).toBeGreaterThan(0n)
      expect(preview._meta.blockNumber).toBeGreaterThan(0n)

      console.log(`Preview deposit 1000 ${config.tokens.token1.symbol}:`)
      console.log(`  Shares: ${preview.result}`)
    })

    it('should preview withdraw for token0', async () => {
      const withdrawAmount = parseUnits('1', config.tokens.token0.decimals)

      const preview = await previewWithdraw({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 0,
        amount: withdrawAmount,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      })

      // previewWithdraw returns the shares that must be burned
      expect(typeof preview.result).toBe('bigint')
      expect(preview.result).toBeGreaterThan(0n)
      expect(preview._meta.blockNumber).toBeGreaterThan(0n)

      console.log(`Preview withdraw 1 ${config.tokens.token0.symbol}:`)
      console.log(`  Shares to burn: ${preview.result}`)
    })

    it('should convert assets to shares and back', async () => {
      const assetAmount = parseUnits('1', config.tokens.token0.decimals)

      // Convert assets to shares
      const sharesResult = await convertToShares({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 0,
        amount: assetAmount,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      })

      expect(typeof sharesResult.result).toBe('bigint')
      expect(sharesResult.result).toBeGreaterThan(0n)

      // Convert shares back to assets
      const assetsResult = await convertToAssets({
        client,
        poolAddress: config.contracts.pool.address,
        tokenIndex: 0,
        amount: sharesResult.result,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
      })

      expect(typeof assetsResult.result).toBe('bigint')
      expect(assetsResult.result).toBeGreaterThan(0n)

      // Round-trip should be close to original (within ERC4626 rounding tolerance)
      const difference =
        assetAmount > assetsResult.result
          ? assetAmount - assetsResult.result
          : assetsResult.result - assetAmount

      // Allow up to 2 wei of rounding difference
      expect(difference).toBeLessThanOrEqual(2n)

      console.log('Round-trip conversion:')
      console.log(`  Original assets: ${assetAmount}`)
      console.log(`  -> Shares: ${sharesResult.result}`)
      console.log(`  -> Back to assets: ${assetsResult.result}`)
      console.log(`  Rounding difference: ${difference}`)
    })

    it('should have consistent preview and convert results', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      const [previewResult, convertResult] = await Promise.all([
        previewDeposit({
          client,
          poolAddress: config.contracts.pool.address,
          tokenIndex: 0,
          amount: depositAmount,
          collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        }),
        convertToShares({
          client,
          poolAddress: config.contracts.pool.address,
          tokenIndex: 0,
          amount: depositAmount,
          collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        }),
      ])

      // previewDeposit and convertToShares should return the same value
      // (on a non-utilized pool they are identical, on utilized pool they may differ slightly)
      const difference =
        previewResult.result > convertResult.result
          ? previewResult.result - convertResult.result
          : convertResult.result - previewResult.result

      // Should be very close (within 1 share for rounding)
      expect(difference).toBeLessThanOrEqual(1n)

      console.log('Preview vs Convert consistency:')
      console.log(`  previewDeposit: ${previewResult.result} shares`)
      console.log(`  convertToShares: ${convertResult.result} shares`)
      console.log(`  Difference: ${difference}`)
    })
  })

  describe('Deposit Execution', () => {
    it('should deposit WETH into collateralTracker0', async () => {
      const depositAmount = parseUnits('2', config.tokens.token0.decimals)

      const result = await deposit({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: depositAmount,
      })

      expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')
      expect(receipt.gasUsed).toBeGreaterThan(0n)

      console.log(`Deposited 2 ${config.tokens.token0.symbol}:`)
      console.log(`  Hash: ${result.hash}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
    })

    it('should reflect deposit in account collateral', async () => {
      const collateral = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })

      // After depositing 2 WETH, token0 assets should be > 0
      expect(collateral.token0.assets).toBeGreaterThan(0n)
      expect(collateral.token0.shares).toBeGreaterThan(0n)

      console.log('Collateral after deposit:')
      console.log(`  Token0 assets: ${collateral.token0.assets}`)
      console.log(`  Token0 shares: ${collateral.token0.shares}`)
    })

    it('should deposit USDC into collateralTracker1', async () => {
      const depositAmount = parseUnits('2000', config.tokens.token1.decimals)

      const result = await deposit({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
        assets: depositAmount,
      })

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')

      console.log(`Deposited 2000 ${config.tokens.token1.symbol}:`)
      console.log(`  Hash: ${result.hash}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
    })
  })

  describe('Withdraw Execution', () => {
    let assetsBeforeWithdraw: bigint

    it('should withdraw partial WETH from collateralTracker0', async () => {
      // Record collateral before withdrawal for relative comparison
      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })
      assetsBeforeWithdraw = collateralBefore.token0.assets

      const withdrawAmount = parseUnits('0.5', config.tokens.token0.decimals)

      const result = await withdraw({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: withdrawAmount,
      })

      expect(result.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      const receipt = await result.wait()
      expect(receipt.status).toBe('success')
      expect(receipt.gasUsed).toBeGreaterThan(0n)

      console.log(`Withdrew 0.5 ${config.tokens.token0.symbol}:`)
      console.log(`  Hash: ${result.hash}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
    })

    it('should reflect reduced collateral after withdrawal', async () => {
      const collateral = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })

      // Collateral should have decreased after withdrawal
      expect(collateral.token0.assets).toBeGreaterThan(0n)
      expect(collateral.token0.assets).toBeLessThan(assetsBeforeWithdraw)

      console.log('Collateral after withdrawal:')
      console.log(`  Token0 assets: ${collateral.token0.assets}`)
      console.log(`  Token0 shares: ${collateral.token0.shares}`)
      console.log(`  Before withdraw: ${assetsBeforeWithdraw}`)
    })
  })

  describe('depositAndWait convenience', () => {
    it('should use depositAndWait for single-call flow', async () => {
      const depositAmount = parseUnits('1', config.tokens.token0.decimals)

      const receipt = await depositAndWait({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker0,
        assets: depositAmount,
      })

      expect(receipt.status).toBe('success')
      expect(receipt.gasUsed).toBeGreaterThan(0n)
      expect(receipt.blockNumber).toBeGreaterThan(0n)

      console.log('depositAndWait result:')
      console.log(`  Status: ${receipt.status}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)
      console.log(`  Block: ${receipt.blockNumber}`)
    })
  })

  describe('Full deposit-withdraw cycle', () => {
    it('should complete deposit -> verify -> withdraw cycle for token1', async () => {
      // Record collateral before
      const collateralBefore = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })

      const token1AssetsBefore = collateralBefore.token1.assets

      // Deposit 500 USDC
      const depositAmount = parseUnits('500', config.tokens.token1.decimals)
      const depositResult = await deposit({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
        assets: depositAmount,
      })
      const depositReceipt = await depositResult.wait()
      expect(depositReceipt.status).toBe('success')

      // Verify collateral increased
      const collateralAfterDeposit = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })
      expect(collateralAfterDeposit.token1.assets).toBeGreaterThan(token1AssetsBefore)

      // Withdraw 500 USDC
      const withdrawResult = await withdraw({
        client,
        walletClient,
        account: daveAddress,
        collateralTrackerAddress: config.contracts.pool.collateralTracker1,
        assets: depositAmount,
      })
      const withdrawReceipt = await withdrawResult.wait()
      expect(withdrawReceipt.status).toBe('success')

      // Collateral should be back near the original level
      const collateralAfterWithdraw = await getAccountCollateral({
        client,
        poolAddress: config.contracts.pool.address,
        account: daveAddress,
      })

      // Allow small rounding difference (1-2 units)
      const difference =
        collateralAfterWithdraw.token1.assets > token1AssetsBefore
          ? collateralAfterWithdraw.token1.assets - token1AssetsBefore
          : token1AssetsBefore - collateralAfterWithdraw.token1.assets

      expect(difference).toBeLessThanOrEqual(2n)

      console.log('Full cycle for token1:')
      console.log(`  Before: ${token1AssetsBefore}`)
      console.log(`  After deposit: ${collateralAfterDeposit.token1.assets}`)
      console.log(`  After withdraw: ${collateralAfterWithdraw.token1.assets}`)
      console.log(`  Rounding difference: ${difference}`)
    })
  })
})
