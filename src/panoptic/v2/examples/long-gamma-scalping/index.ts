/**
 * Long gamma scalping example.
 *
 * Atomically buys an ATM straddle and opens a swapAtMint loan to reduce delta exposure.
 * Dry-run by default; set EXECUTE=true to submit the batch.
 *
 * @module examples/long-gamma-scalping
 */

import {
  MAX_TICK,
  MIN_TICK,
  STANDARD_TICK_WIDTHS,
  createTokenIdBuilder,
  decodeTokenId,
  dispatchAndWait,
  formatTokenAmount,
  getDeltaHedgeParams,
  getPool,
  parsePanopticError,
  simulateDispatch,
  simulateOpenPosition,
  tickLimits,
} from '@panoptic-eng/sdk/v2'

import { CHAIN_ID, createClients, loadEnv } from './config'

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function buildAtmStraddle(params: { poolId: bigint; strike: bigint; width: bigint }) {
  return createTokenIdBuilder(params.poolId)
    .addCall({
      strike: params.strike,
      width: params.width,
      optionRatio: 1n,
      isLong: true,
    })
    .addPut({
      strike: params.strike,
      width: params.width,
      optionRatio: 1n,
      isLong: true,
    })
    .build()
}

function buildHedgeLoan(params: {
  poolId: bigint
  hedgeLeg: {
    asset: bigint
    tokenType: bigint
    strike: bigint
    optionRatio: bigint
  }
}) {
  return createTokenIdBuilder(params.poolId)
    .addLoan({
      asset: params.hedgeLeg.asset,
      tokenType: params.hedgeLeg.tokenType,
      strike: params.hedgeLeg.strike,
      optionRatio: params.hedgeLeg.optionRatio,
    })
    .build()
}

function estimatedSwapAtMintLoanDelta(params: {
  optionTokenId: bigint
  hedgeTokenType: bigint
  hedgePositionSize: bigint
}) {
  const primaryAsset = decodeTokenId(params.optionTokenId).legs[0].asset
  const numeraire = primaryAsset === 0n ? 1n : 0n
  const direction = params.hedgeTokenType === numeraire ? 1n : -1n

  return direction * params.hedgePositionSize
}

async function main() {
  const env = loadEnv()
  const { client, walletClient, account } = createClients(env)

  console.log(`Account: ${account.address}`)
  console.log(`Pool:    ${env.poolAddress}`)
  console.log(`Mode:    ${env.execute ? 'execute' : 'dry-run'}`)
  console.log()

  const pool = await getPool({
    client,
    poolAddress: env.poolAddress,
    chainId: CHAIN_ID,
  })
  const strike = (pool.currentTick / pool.tickSpacing) * pool.tickSpacing
  const width = STANDARD_TICK_WIDTHS['1D'] / pool.tickSpacing
  const straddleTokenId = buildAtmStraddle({ poolId: pool.poolId, strike, width })

  console.log(`Current tick:   ${pool.currentTick}`)
  console.log(`Straddle strike: ${strike}`)
  console.log(`Straddle width:  ${width} (${STANDARD_TICK_WIDTHS['1D']} ticks)`)
  console.log(`Position size:   ${env.positionSize}`)
  console.log(`TokenId:         ${straddleTokenId}`)
  console.log()

  const straddleSimulation = await simulateOpenPosition({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
    existingPositionIds: env.existingPositionIds,
    tokenId: straddleTokenId,
    positionSize: env.positionSize,
    tickLimitLow: MIN_TICK,
    tickLimitHigh: MAX_TICK,
    chainId: CHAIN_ID,
  })

  if ('error' in straddleSimulation) {
    const parsed = parsePanopticError(straddleSimulation.error)
    console.error(
      'Long straddle simulation failed:',
      parsed?.errorName ?? straddleSimulation.error.message,
    )
    console.error('Check that the account has collateral and the pool has short-side liquidity.')
    process.exit(1)
  }

  console.log('Long straddle simulation succeeded')
  console.log(`  Gas estimate:     ${straddleSimulation.gasEstimate}`)
  console.log(`  Amount0 required: ${straddleSimulation.data.amount0Required}`)
  console.log(`  Amount1 required: ${straddleSimulation.data.amount1Required}`)
  console.log(`  Estimated gamma:  ${straddleSimulation.data.greeks.gamma}`)
  console.log(`  Estimated delta:  ${straddleSimulation.data.greeks.delta}`)
  console.log()

  const dryRunHedge = await getDeltaHedgeParams({
    client,
    poolAddress: env.poolAddress,
    chainId: CHAIN_ID,
    tokenId: straddleTokenId,
    positionSize: env.positionSize,
    targetDelta: 0n,
    mintTick: pool.currentTick,
  })

  console.log('Initial hedge plan')
  console.log(`  Type:        ${dryRunHedge.hedgeType}`)
  console.log(`  SwapAtMint:  ${dryRunHedge.swapAtMint}`)
  console.log(`  Token type:  ${dryRunHedge.hedgeLeg.tokenType}`)
  console.log(`  Amount:      ${dryRunHedge.hedgeAmount}`)
  console.log()

  const hedgeTokenId = buildHedgeLoan({
    poolId: pool.poolId,
    hedgeLeg: dryRunHedge.hedgeLeg,
  })
  const finalPositionIds = [...env.existingPositionIds, straddleTokenId, hedgeTokenId]
  const limits = tickLimits(pool.currentTick, env.slippageBps)
  const straddleLimits = [limits.low, limits.high, 0n] as const
  const hedgeLimits = [limits.high, limits.low, 0n] as const

  const batchSimulation = await simulateDispatch({
    client,
    poolAddress: env.poolAddress,
    account: account.address,
    positionIdList: [straddleTokenId, hedgeTokenId],
    finalPositionIdList: finalPositionIds,
    existingPositionIdList: env.existingPositionIds,
    positionSizes: [env.positionSize, dryRunHedge.hedgeAmount],
    tickAndSpreadLimits: [straddleLimits, hedgeLimits],
  })

  if ('error' in batchSimulation) {
    const parsed = parsePanopticError(batchSimulation.error)
    console.error(
      'Atomic straddle + hedge simulation failed:',
      parsed?.errorName ?? batchSimulation.error.message,
    )
    process.exit(1)
  }

  const hedgeDelta = estimatedSwapAtMintLoanDelta({
    optionTokenId: straddleTokenId,
    hedgeTokenType: dryRunHedge.hedgeLeg.tokenType,
    hedgePositionSize: dryRunHedge.hedgeAmount,
  })
  const combinedDelta = straddleSimulation.data.greeks.delta + hedgeDelta

  console.log('Atomic straddle + hedge simulation succeeded')
  console.log(`  Gas estimate:      ${batchSimulation.gasEstimate}`)
  console.log(`  Net amount0:       ${batchSimulation.data.netAmount0}`)
  console.log(`  Net amount1:       ${batchSimulation.data.netAmount1}`)
  console.log(`  Created positions: ${batchSimulation.data.positionsCreated.length}`)
  console.log()

  if (!env.execute) {
    console.log('Dry run complete. Set EXECUTE=true to atomically open the straddle and hedge.')
    return
  }

  console.log('Opening long straddle and delta hedge atomically...')
  const receipt = await dispatchAndWait({
    client,
    walletClient,
    account: account.address,
    poolAddress: env.poolAddress,
    positionIdList: [straddleTokenId, hedgeTokenId],
    finalPositionIdList: finalPositionIds,
    positionSizes: [env.positionSize, dryRunHedge.hedgeAmount],
    tickAndSpreadLimits: [straddleLimits, hedgeLimits],
  })
  console.log(`  Confirmed in block ${receipt.blockNumber}`)

  console.log()
  console.log('Delta summary')
  console.log(`  Straddle delta: ${straddleSimulation.data.greeks.delta}`)
  console.log(`  Hedge delta:    ${hedgeDelta}`)
  console.log(`  Combined delta: ${combinedDelta}`)
  console.log(`  Reduction:      ${abs(straddleSimulation.data.greeks.delta) - abs(combinedDelta)}`)
  console.log()
  console.log(`Straddle TokenId: ${straddleTokenId}`)
  console.log(`Hedge TokenId:    ${hedgeTokenId}`)
  console.log(`Hedge amount:     ${formatTokenAmount(dryRunHedge.hedgeAmount, 18n, 8n)}`)
}

main().catch((err) => {
  console.error('long-gamma-scalping failed:', err)
  process.exit(1)
})
