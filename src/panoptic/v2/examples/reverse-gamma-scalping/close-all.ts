/**
 * Close all open positions for the reverse gamma scalping bot account.
 *
 * Uses getOpenPositionIds (recoverSnapshot from last dispatch tx) to find
 * open positions in ~2 RPC calls, then closes them.
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/close-all.ts
 */

import { parsePanopticError } from '../../errors'
import { formatTokenAmount } from '../../formatters/amount'
import { getAccountCollateral } from '../../reads/account'
import { simulateClosePosition } from '../../simulations/simulateClosePosition'
import { getOpenPositionIds } from '../../sync'
import { decodeTokenId } from '../../tokenId'
import { closePosition } from '../../writes/position'
import { CHAIN_ID, createClients, loadEnv } from './config'

async function main() {
  const env = loadEnv()
  const { client, walletClient, account } = createClients(env)

  console.log(`Account: ${account.address}`)

  const startCollateral = await getAccountCollateral({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
  })
  console.log(
    `Collateral before: ETH=${formatTokenAmount(startCollateral.token0.assets, 18n, 6n)} ` +
      `USDC=${formatTokenAmount(startCollateral.token1.assets, 6n, 2n)}`,
  )

  // Get open positions from last dispatch tx (fast — ~2 RPC calls)
  const openIds = await getOpenPositionIds({
    client,
    chainId: CHAIN_ID,
    poolAddress: env.poolAddress,
    account: account.address,
  })

  if (openIds.length === 0) {
    console.log('\nNo open positions. Nothing to close.')
    return
  }

  // Classify positions: loans (hedges) close first with swapAtMint
  const positions = openIds.map((tokenId) => {
    const decoded = decodeTokenId(tokenId)
    const isLoan = decoded.legs.some((leg) => leg.width === 0n)
    return { tokenId, isLoan }
  })

  // Close loans first, then options
  const sorted = [...positions].sort((a, b) => (a.isLoan === b.isLoan ? 0 : a.isLoan ? -1 : 1))

  console.log(`\nClosing ${sorted.length} position(s)...`)

  const remainingIds = [...openIds]

  for (const { tokenId, isLoan } of sorted) {
    console.log(`  Closing tokenId=${tokenId} (swapAtMint=${isLoan})...`)

    const sim = await simulateClosePosition({
      client,
      poolAddress: env.poolAddress,
      account: account.address,
      positionIdList: remainingIds,
      tokenId,
      positionSize: 0n,
      tickLimitLow: -887272n,
      tickLimitHigh: 887272n,
      swapAtMint: isLoan,
    })

    if (!sim.success) {
      const parsed = parsePanopticError(sim.error)
      console.error(
        `  Simulation failed: ${parsed?.errorName ?? sim.error?.message ?? 'unknown'}. Skipping.`,
      )
      continue
    }

    const receipt = await (
      await closePosition({
        client,
        walletClient,
        account: account.address,
        poolAddress: env.poolAddress,
        positionIdList: remainingIds,
        tokenId,
        positionSize: 0n,
        tickLimitLow: -887272n,
        tickLimitHigh: 887272n,
        swapAtMint: isLoan,
      })
    ).wait()

    console.log(`  Closed (tx: ${receipt.hash}, status: ${receipt.status})`)

    const idx = remainingIds.indexOf(tokenId)
    if (idx !== -1) remainingIds.splice(idx, 1)
  }

  const endCollateral = await getAccountCollateral({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
  })
  const pnl0 = endCollateral.token0.assets - startCollateral.token0.assets
  const pnl1 = endCollateral.token1.assets - startCollateral.token1.assets
  console.log(
    `\nCollateral after: ETH=${formatTokenAmount(endCollateral.token0.assets, 18n, 6n)} ` +
      `USDC=${formatTokenAmount(endCollateral.token1.assets, 6n, 2n)}`,
  )
  console.log(
    `PnL: ETH=${formatTokenAmount(pnl0, 18n, 6n)} USDC=${formatTokenAmount(pnl1, 6n, 2n)}`,
  )
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Close failed:', err)
  process.exit(1)
})
