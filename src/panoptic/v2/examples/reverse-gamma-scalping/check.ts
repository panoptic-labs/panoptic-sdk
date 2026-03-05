/**
 * Check open positions and collateral for the reverse gamma scalping bot account.
 *
 * Usage:
 *   pnpm --filter @panoptic-eng/sdk exec tsx src/panoptic/v2/examples/reverse-gamma-scalping/check.ts
 */

import { formatTokenAmount } from '../../formatters/amount'
import { formatBps } from '../../formatters/percentage'
import { tickToPriceDecimalScaled } from '../../formatters/tick'
import { calculatePositionGreeks } from '../../greeks'
import { getAccountCollateral } from '../../reads/account'
import { getMarginBuffer } from '../../reads/margin'
import { getPool } from '../../reads/pool'
import { getPosition } from '../../reads/position'
import { createMemoryStorage } from '../../storage'
import { getTrackedPositionIds, syncPositions } from '../../sync'
import { decodeTokenId } from '../../tokenId'
import { CHAIN_ID, createClients, loadEnv } from './config'

const Q192 = 1n << 192n

async function main() {
  const env = loadEnv()
  if (!env.queryAddress) throw new Error('QUERY_ADDRESS required')
  const { client, account } = createClients(env)
  const accountAddress = account.address

  console.log(`Account: ${accountAddress}`)
  console.log(`Pool:    ${env.poolAddress}`)
  console.log(`Query:   ${env.queryAddress}`)
  console.log()

  // Pool state
  const pool = await getPool({ client, poolAddress: env.poolAddress, chainId: CHAIN_ID })
  const price = tickToPriceDecimalScaled(pool.currentTick, 18n, 6n, 2n)
  console.log(`Pool price: ${price} (tick: ${pool.currentTick})`)
  console.log(
    `Pool utilization: ETH ${formatBps(pool.collateralTracker0.utilization, 2n)}  USDC ${formatBps(pool.collateralTracker1.utilization, 2n)}\n`,
  )

  // Collateral tracker data (from pool — handles native ETH correctly)
  const ct0 = pool.collateralTracker0
  const ct1 = pool.collateralTracker1

  // WAD rates → bps for formatBps (1e18 = 100% → 10000 bps, so divide by 1e14)
  const wadToBps = (wad: bigint) => wad / 10n ** 14n

  console.log(`Collateral Tracker 0 (${ct0.symbol}):`)
  console.log(`  depositedAssets: ${formatTokenAmount(ct0.totalAssets, ct0.decimals, 6n)}`)
  console.log(`  insideAMM:       ${formatTokenAmount(ct0.insideAMM, ct0.decimals, 6n)}`)
  console.log(`  creditedShares:  ${ct0.creditedShares}`)
  console.log(`  totalShares:     ${ct0.totalShares}`)
  console.log(`  utilization:     ${formatBps(ct0.utilization, 2n)}`)
  console.log(`  borrowRate:      ${formatBps(wadToBps(ct0.borrowRate), 2n)}/yr`)
  console.log(`  supplyRate:      ${formatBps(wadToBps(ct0.supplyRate), 2n)}/yr`)

  console.log(`Collateral Tracker 1 (${ct1.symbol}):`)
  console.log(`  depositedAssets: ${formatTokenAmount(ct1.totalAssets, ct1.decimals, 2n)}`)
  console.log(`  insideAMM:       ${formatTokenAmount(ct1.insideAMM, ct1.decimals, 2n)}`)
  console.log(`  creditedShares:  ${ct1.creditedShares}`)
  console.log(`  totalShares:     ${ct1.totalShares}`)
  console.log(`  utilization:     ${formatBps(ct1.utilization, 2n)}`)
  console.log(`  borrowRate:      ${formatBps(wadToBps(ct1.borrowRate), 2n)}/yr`)
  console.log(`  supplyRate:      ${formatBps(wadToBps(ct1.supplyRate), 2n)}/yr`)
  console.log()

  // Account collateral
  const collateral = await getAccountCollateral({
    client,
    poolAddress: env.poolAddress,
    account: accountAddress,
  })
  console.log('Account Collateral:')
  console.log(
    `  ETH  — assets: ${formatTokenAmount(collateral.token0.assets, 18n, 6n)}  shares: ${collateral.token0.shares}  available: ${formatTokenAmount(collateral.token0.availableAssets, 18n, 6n)}`,
  )
  console.log(
    `  USDC — assets: ${formatTokenAmount(collateral.token1.assets, 6n, 2n)}  shares: ${collateral.token1.shares}  available: ${formatTokenAmount(collateral.token1.availableAssets, 6n, 2n)}`,
  )
  console.log(`  Open legs: ${collateral.legCount}`)
  console.log()

  // Sync and check positions
  const storage = createMemoryStorage()
  await syncPositions({
    client,
    chainId: CHAIN_ID,
    poolAddress: env.poolAddress,
    account: accountAddress,
    storage,
  })
  const ids = await getTrackedPositionIds({
    chainId: CHAIN_ID,
    poolAddress: env.poolAddress,
    account: accountAddress,
    storage,
  })

  console.log(`Tracked position IDs: ${ids.length}`)
  const openIds: bigint[] = []
  let portfolioDelta = 0n
  let portfolioGamma = 0n
  let portfolioValue = 0n
  for (const id of ids) {
    const pos = await getPosition({
      client,
      poolAddress: env.poolAddress,
      owner: accountAddress,
      tokenId: id,
    })
    if (pos.positionSize > 0n) {
      openIds.push(id)
      const decoded = decodeTokenId(id)
      const greeks = calculatePositionGreeks({
        legs: pos.legs,
        currentTick: pool.currentTick,
        mintTick: pos.tickAtMint,
        positionSize: pos.positionSize,
        poolTickSpacing: pool.poolKey.tickSpacing,
      })
      portfolioDelta += greeks.delta
      portfolioGamma += greeks.gamma
      portfolioValue += greeks.value

      console.log(`\n  OPEN position: tokenId=${id}`)
      console.log(`    legs: ${decoded.legCount}, size: ${pos.positionSize}`)
      console.log(`    delta: ${formatTokenAmount(greeks.delta, 18n, 8n)}`)
      console.log(`    gamma: ${formatTokenAmount(greeks.gamma, 6n, 4n)}`)
      console.log(`    value: ${formatTokenAmount(greeks.value, 6n, 4n)}`)

      // Mint context
      console.log(
        `    blockAtMint: ${pos.blockNumberAtMint}  timestampAtMint: ${pos.timestampAtMint}  swapAtMint: ${pos.swapAtMint}`,
      )
      console.log(
        `    utilization at mint: ETH ${formatBps(pos.poolUtilization0AtMint, 2n)}  USDC ${formatBps(pos.poolUtilization1AtMint, 2n)}`,
      )

      // Per-leg chunk details
      for (const leg of pos.legs) {
        const widthTicks = leg.width * pool.poolKey.tickSpacing
        console.log(
          `    leg[${leg.index}]: ${leg.isLong ? 'long' : 'short'} tokenType=${leg.tokenType} ratio=${leg.optionRatio}` +
            `  strike=${leg.strike} width=${leg.width} (${widthTicks} ticks)` +
            `  range=[${leg.tickLower}, ${leg.tickUpper}]`,
        )
      }
    }
  }

  // Portfolio greeks summary
  if (openIds.length > 1) {
    console.log('\n--- Portfolio Greeks ---')
    console.log(`  Net delta: ${formatTokenAmount(portfolioDelta, 18n, 8n)}`)
    console.log(`  Net gamma: ${formatTokenAmount(portfolioGamma, 6n, 4n)}`)
    console.log(`  Net value: ${formatTokenAmount(portfolioValue, 6n, 4n)}`)
  }

  // Margin
  if (openIds.length > 0) {
    console.log('\n--- Margin ---')
    const margin = await getMarginBuffer({
      client,
      poolAddress: env.poolAddress,
      account: accountAddress,
      tokenIds: openIds,
      queryAddress: env.queryAddress,
    })
    // checkCollateral cross-converts both slots into one denomination:
    // tick < 0 → token0 (ETH), tick >= 0 → token1 (USDC)
    const denomToken = margin.denominatedInToken
    const denomDecimals = denomToken === 0 ? ct0.decimals : ct1.decimals
    const denomSymbol = denomToken === 0 ? ct0.symbol : ct1.symbol
    const denomPrecision = denomToken === 0 ? 6n : 2n

    // Convert native denomination to the other token for display
    const p = pool.sqrtPriceX96
    const toOther =
      denomToken === 0
        ? (amount: bigint) => (amount * p * p) / Q192 // token0 → token1
        : (amount: bigint) => (amount * Q192) / (p * p) // token1 → token0
    const otherDecimals = denomToken === 0 ? ct1.decimals : ct0.decimals
    const otherSymbol = denomToken === 0 ? ct1.symbol : ct0.symbol
    const otherPrecision = denomToken === 0 ? 2n : 6n

    // Combine both slots (same denomination) for totals
    const totalCurrent = margin.currentMargin0 + margin.currentMargin1
    const totalRequired = margin.requiredMargin0 + margin.requiredMargin1
    const totalBuffer = totalCurrent - totalRequired

    const fmtNative = (v: bigint) => formatTokenAmount(v, denomDecimals, denomPrecision)
    const fmtOther = (v: bigint) => formatTokenAmount(toOther(v), otherDecimals, otherPrecision)

    console.log(`  Denomination:    ${denomSymbol} (tick ${margin.currentTick})`)
    console.log(
      `  Current margin:  ${denomSymbol} ${fmtNative(totalCurrent)}  ${otherSymbol} ${fmtOther(totalCurrent)}`,
    )
    console.log(
      `  Required margin: ${denomSymbol} ${fmtNative(totalRequired)}  ${otherSymbol} ${fmtOther(totalRequired)}`,
    )
    console.log(
      `  Buffer:          ${denomSymbol} ${fmtNative(totalBuffer)}  ${otherSymbol} ${fmtOther(totalBuffer)}`,
    )
    const marginUtil = totalCurrent > 0n ? (totalRequired * 10000n) / totalCurrent : 0n
    console.log(`  Margin util:     ${formatBps(marginUtil, 2n)}`)
    console.log(`  Current tick:    ${margin.currentTick}`)
    const tickPctStr = (fromTick: bigint, toTick: bigint) => {
      const pct = (Math.pow(1.0001, Number(toTick - fromTick)) - 1) * 100
      if (Math.abs(pct) > 1000) return pct > 0 ? '>+1,000%' : '<-1,000%'
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
    }
    if (margin.lowerLiquidationTick !== null)
      console.log(
        `  Liq tick lower:  ${margin.lowerLiquidationTick} (${tickPctStr(margin.currentTick, margin.lowerLiquidationTick)})`,
      )
    if (margin.upperLiquidationTick !== null)
      console.log(
        `  Liq tick upper:  ${margin.upperLiquidationTick} (${tickPctStr(margin.currentTick, margin.upperLiquidationTick)})`,
      )
  }

  if (openIds.length === 0) {
    console.log('\nNo open positions. All clear.')
  } else {
    console.log(`\n${openIds.length} open position(s) found. Run the bot again or close manually.`)
  }
}

main().catch((err) => {
  console.error('Check failed:', err)
  process.exit(1)
})
