/**
 * Setup script for the Reverse Gamma Scalping Bot
 *
 * Approves and deposits collateral for the target pool.
 * Fetches collateral tracker and token addresses from the pool contract
 * so no addresses need to be hardcoded.
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/setup.ts
 *
 * Optional env overrides:
 *   ETH_DEPOSIT  - ETH deposit amount in wei (default: 0.5 ETH)
 *   USDC_DEPOSIT - USDC deposit amount in smallest units (default: 1500 USDC)
 *
 * @module examples/reverse-gamma-scalping/setup
 */

import { parseAbi, parseUnits } from 'viem'

import { collateralTrackerAbi } from '../../../../generated'
import { formatTokenAmount } from '../../formatters/amount'
import { getAccountCollateral } from '../../reads/account'
import { getPool } from '../../reads/pool'
import { CHAIN_ID, createClients, loadEnv } from './config'

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
])

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv()
  const { client, walletClient, account } = createClients(env)

  console.log(`Account: ${account.address}`)

  // --- Fetch pool to resolve collateral tracker and token addresses ---
  const pool = await getPool({ client, poolAddress: env.poolAddress, chainId: CHAIN_ID })
  const ct0Address = pool.collateralTracker0.address
  const ct1Address = pool.collateralTracker1.address
  const token1Address = pool.collateralTracker1.token // e.g. USDC
  const ct0Decimals = pool.collateralTracker0.decimals
  const ct1Decimals = pool.collateralTracker1.decimals

  console.log(`Pool:    ${env.poolAddress}`)
  console.log(`CT0:     ${ct0Address} (${pool.collateralTracker0.symbol})`)
  console.log(`CT1:     ${ct1Address} (${pool.collateralTracker1.symbol})`)

  // Deposit amounts (configurable via env)
  const ethDeposit = process.env.ETH_DEPOSIT
    ? BigInt(process.env.ETH_DEPOSIT)
    : parseUnits('0.5', 18)
  const usdcDeposit = process.env.USDC_DEPOSIT
    ? BigInt(process.env.USDC_DEPOSIT)
    : parseUnits('1500', 6)

  // --- Check balances ---
  const [ethBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: token1Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ])
  console.log(`ETH balance:  ${formatTokenAmount(ethBalance, ct0Decimals, 4n)}`)
  console.log(`USDC balance: ${formatTokenAmount(usdcBalance, ct1Decimals, 2n)}`)

  // --- Step 1: Approve token1 (USDC) for CollateralTracker1 ---
  const usdcAllowance = await client.readContract({
    address: token1Address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, ct1Address],
  })

  if (usdcAllowance < usdcDeposit) {
    console.log(`Approving ${pool.collateralTracker1.symbol} for CollateralTracker1...`)
    const approveHash = await walletClient.writeContract({
      address: token1Address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ct1Address, 2n ** 256n - 1n], // max approval
      account,
      chain: walletClient.chain,
    })
    await client.waitForTransactionReceipt({ hash: approveHash })
    console.log(`  Approved (tx: ${approveHash})`)
  } else {
    console.log(`${pool.collateralTracker1.symbol} already approved for CollateralTracker1`)
  }

  // --- Step 2: Deposit native ETH into CollateralTracker0 ---
  if (ethDeposit > 0n) {
    console.log(`Depositing ${formatTokenAmount(ethDeposit, ct0Decimals, 4n)} ETH...`)
    const ethDepositHash = await walletClient.writeContract({
      address: ct0Address,
      abi: collateralTrackerAbi,
      functionName: 'deposit',
      args: [ethDeposit, account.address],
      value: ethDeposit, // native ETH sent as msg.value
      account,
      chain: walletClient.chain,
    })
    await client.waitForTransactionReceipt({ hash: ethDepositHash })
    console.log(`  Deposited (tx: ${ethDepositHash})`)
  }

  // --- Step 3: Deposit token1 (USDC) into CollateralTracker1 ---
  if (usdcDeposit > 0n) {
    console.log(
      `Depositing ${formatTokenAmount(usdcDeposit, ct1Decimals, 2n)} ${pool.collateralTracker1.symbol}...`,
    )
    const usdcDepositHash = await walletClient.writeContract({
      address: ct1Address,
      abi: collateralTrackerAbi,
      functionName: 'deposit',
      args: [usdcDeposit, account.address],
      account,
      chain: walletClient.chain,
    })
    await client.waitForTransactionReceipt({ hash: usdcDepositHash })
    console.log(`  Deposited (tx: ${usdcDepositHash})`)
  }

  // --- Verify ---
  const collateral = await getAccountCollateral({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
  })
  console.log('\nCollateral after deposits:')
  console.log(`  ETH:  ${formatTokenAmount(collateral.token0.assets, ct0Decimals, 6n)}`)
  console.log(`  USDC: ${formatTokenAmount(collateral.token1.assets, ct1Decimals, 2n)}`)
  console.log('\nSetup complete! You can now run the bot.')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
