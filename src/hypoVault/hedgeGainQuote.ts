import type { Address, Hex, PublicClient } from 'viem'
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi } from 'viem'

import { panopticPoolV2Abi } from '../generated'
import { uniswapV3PoolAbi } from '../panoptic/v2/abis/uniswapV3Pool'
import { tickToSqrtPriceX96 } from '../panoptic/v2/formatters/tick'
import { getLegTokenInventory } from '../panoptic/v2/greeks/legLiquidity'
import { type PoolMetadata, getPoolMetadata } from '../panoptic/v2/reads/pool'
import { getPositionValueCurve } from '../panoptic/v2/reads/positionValueCurve'
import { simulateWithTokenFlow } from '../panoptic/v2/simulations/tokenFlow'
import { getOpenPositionIds } from '../panoptic/v2/sync/getTrackedPositionIds'
import { decodeTokenId } from '../panoptic/v2/tokenId/decode'
import { getChainDeployment } from './chainDeployments'
import { type FrozenHedgeBook, estimateProtectedHedgeGain } from './hedgeGain'

const MASK128 = (1n << 128n) - 1n
const Q192 = 1n << 192n
const ceilDiv = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor
const max = (a: bigint, b: bigint) => (a > b ? a : b)
const min = (a: bigint, b: bigint) => (a < b ? a : b)
const assetsAbi = [
  {
    type: 'function',
    name: 'getAssetsOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
] as const

function fullPositions(data: Hex, ids: readonly bigint[]) {
  const [shortPremium, longPremium, balances] = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    data,
  })
  if (balances.length !== ids.length) throw new Error('Incomplete hedge position balances')
  const positions = ids.map((tokenId, index) => {
    const packed = balances[index]
    if (packed === undefined || (packed & MASK128) === 0n)
      throw new Error('Missing active hedge position')
    return { tokenId, positionSize: packed & MASK128 }
  })
  return {
    positions,
    premium: [
      (shortPremium & MASK128) - (longPremium & MASK128),
      (shortPremium >> 128n) - (longPremium >> 128n),
    ] as const,
  }
}

export async function readVaultHedgeBook({
  client,
  poolAddress,
  account,
  queryAddress,
  numeraire,
  fromBlock,
  blockNumber,
  metadata: prefetchedMetadata,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  queryAddress: Address
  numeraire: Address
  fromBlock?: bigint
  blockNumber?: bigint
  metadata?: PoolMetadata
}) {
  const block = await client.getBlock({ blockNumber })
  const metadata = prefetchedMetadata ?? (await getPoolMetadata({ client, poolAddress }))
  const gasAsset = getChainDeployment(client.chain?.id ?? 0)?.sfpmSwap?.weth
  const tokens = [metadata.token0Asset, metadata.token1Asset]
  const quoteIndex = tokens.findIndex((token) => token.toLowerCase() === numeraire.toLowerCase())
  const gasIndex = tokens.findIndex((token) => token.toLowerCase() === gasAsset?.toLowerCase())
  if (metadata.isV4 || (quoteIndex !== 0 && quoteIndex !== 1) || (gasIndex !== 0 && gasIndex !== 1))
    throw new Error('Protected hedge fees require a supported native-gas v3 pair')
  const numeraireIndex = quoteIndex === 0 ? 0n : 1n
  const gasAssetIndex: 0n | 1n = gasIndex === 0 ? 0n : 1n
  if (numeraireIndex === gasAssetIndex)
    throw new Error('Hedge numeraire must differ from gas asset')
  if ((gasIndex === 0 ? metadata.token0Decimals : metadata.token1Decimals) !== 18n)
    throw new Error('Native gas conversion requires an eighteen-decimal wrapped asset')
  const ids = await getOpenPositionIds({
    client,
    chainId: BigInt(client.chain?.id ?? 0),
    poolAddress,
    account,
    fromBlock,
    toBlock: block.number,
  })
  if (ids === null || ids.length === 0 || new Set(ids).size !== ids.length)
    throw new Error('Missing complete option book')
  const fullCall = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, true, ids],
  })
  const [results, nativeBalance] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          args: [account, true, ids],
        },
        {
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'numberOfLegs',
          args: [account],
        },
        { address: poolAddress, abi: assetsAbi, functionName: 'getAssetsOf', args: [account] },
        {
          address: metadata.underlyingPoolId as Address,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
        },
        {
          address: metadata.token0Asset,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        },
        {
          address: metadata.token1Asset,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        },
      ],
      blockNumber: block.number,
      allowFailure: false,
    }),
    client.getBalance({ address: account, blockNumber: block.number }),
  ])
  const [full, legCount, collateral, spot, wallet0, wallet1] = results
  const positions = ids.map((tokenId, index) => ({
    tokenId,
    positionSize: (full[2][index] ?? 0n) & MASK128,
  }))
  if (
    full[2].length !== ids.length ||
    positions.some((position) => position.positionSize === 0n) ||
    positions.reduce(
      (count, position) => count + BigInt(decodeTokenId(position.tokenId).legs.length),
      0n,
    ) !== legCount
  )
    throw new Error('Incomplete hedge book leg count')
  const premium = [
    (full[0] & MASK128) - (full[1] & MASK128),
    (full[0] >> 128n) - (full[1] >> 128n),
  ] as const
  const wallet = [
    wallet0 + (gasIndex === 0 ? nativeBalance : 0n),
    wallet1 + (gasIndex === 1 ? nativeBalance : 0n),
  ] as const
  const curve = await getPositionValueCurve({ client, queryAddress, positions })
  const book: FrozenHedgeBook = {
    curve,
    balances: [collateral[0] + wallet[0] + premium[0], collateral[1] + wallet[1] + premium[1]],
    sqrtPriceX96: spot[0],
    numeraireIndex,
  }
  return {
    book,
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    metadata,
    account,
    poolAddress,
    queryAddress,
    positions,
    collateral,
    wallet,
    nativeBalance,
    fullCall,
    gasAssetIndex,
  }
}

export type VaultHedgeBookSnapshot = Awaited<ReturnType<typeof readVaultHedgeBook>>

export async function quoteProtectedVaultHedge({
  client,
  snapshot,
  dispatchData,
  anchor,
}: {
  client: PublicClient
  snapshot: VaultHedgeBookSnapshot
  dispatchData: Hex
  anchor?: { sqrtPriceX96: bigint; actualValue: bigint }
}) {
  const decoded = decodeFunctionData({ abi: panopticPoolV2Abi, data: dispatchData })
  if (decoded.functionName !== 'dispatch') throw new Error('Protected gain requires a dispatch')
  const [operations, finalIds, sizes, limits, usePremia] = decoded.args
  if (
    usePremia ||
    new Set(operations).size !== operations.length ||
    operations.length !== sizes.length ||
    sizes.length !== limits.length
  )
    throw new Error('Unsupported protected hedge dispatch')
  const existing = new Map(
    snapshot.positions.map((position) => [position.tokenId, position.positionSize]),
  )
  const expected = new Map(existing)
  const reserve: [bigint, bigint] = [0n, 0n]
  let lower = snapshot.book.sqrtPriceX96
  let upper = lower
  let direction: bigint | undefined
  let swapCount = 0
  for (const [index, tokenId] of operations.entries()) {
    const size = sizes[index]
    const limit = limits[index]
    const { legs, tickSpacing } = decodeTokenId(tokenId)
    const leg = legs[0]
    if (
      size === undefined ||
      limit === undefined ||
      legs.length !== 1 ||
      leg === undefined ||
      leg.width !== 0n ||
      leg.isLong
    )
      throw new Error('Only standalone loan hedges can authorize protected gain')
    const prior = existing.get(tokenId)
    if ((prior !== undefined && size !== 0n) || (prior === undefined && size === 0n))
      throw new Error('Unsupported hedge resize or missing burn')
    if (size === 0n) expected.delete(tokenId)
    else expected.set(tokenId, size)
    if (limit[0] <= limit[1]) continue
    const lo = tickToSqrtPriceX96(BigInt(limit[1]))
    const hi = tickToSqrtPriceX96(BigInt(limit[0]))
    if (snapshot.book.sqrtPriceX96 < lo || snapshot.book.sqrtPriceX96 > hi)
      throw new Error('Hedge execution bounds are stale')
    lower = min(lower, lo)
    upper = max(upper, hi)
    const borrowIndex = leg.tokenType === 0n ? 0n : 1n
    const counterIndex = borrowIndex === 0n ? 1n : 0n
    const outgoing = size === 0n ? counterIndex : borrowIndex
    if (direction !== undefined && direction !== outgoing)
      throw new Error('Opposing swaps require a separate execution bound')
    direction = outgoing
    // Loan principal uses the protocol's synthetic width of two.
    const principal =
      -getLegTokenInventory(
        { ...leg, width: 2n },
        borrowIndex === 0n ? 887272n : -887272n,
        size === 0n ? (prior ?? 0n) : size,
        tickSpacing,
        borrowIndex,
      ) + 2n
    const convert = (sqrt: bigint) =>
      borrowIndex === 0n
        ? ceilDiv(principal * sqrt ** 2n, Q192)
        : ceilDiv(principal * Q192, sqrt ** 2n)
    const current = convert(snapshot.book.sqrtPriceX96)
    const minimum = min(convert(lo), convert(hi))
    const maximum = max(convert(lo), convert(hi))
    const drift = size === 0n ? maximum - current : current - minimum
    reserve[Number(counterIndex)] +=
      drift + ceilDiv(maximum * snapshot.metadata.fee, 1_000_000n - snapshot.metadata.fee) + 2n
    swapCount++
  }
  if (
    swapCount === 0 ||
    finalIds.length !== expected.size ||
    new Set(finalIds).size !== finalIds.length ||
    finalIds.some((id) => !expected.has(id))
  )
    throw new Error('Incomplete final protected hedge book')
  const finalCall = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [snapshot.account, true, finalIds],
  })
  const result = await simulateWithTokenFlow({
    client,
    poolAddress: snapshot.poolAddress,
    user: snapshot.account,
    callData: dispatchData,
    blockNumber: snapshot.blockNumber,
    estimateGas: false,
    preCallData: [snapshot.fullCall],
    postCallData: [finalCall],
  })
  const flow = result.tokenFlow
  const pre = result.preCallResults?.[0]
  const post = result.postCallResults?.[0]
  if (!result.success || flow === undefined || pre === undefined || post === undefined)
    throw result.rawError ?? new Error(result.error ?? 'Missing exact hedge cashflow quote')
  if (
    flow.balanceBefore0 !== snapshot.collateral[0] ||
    flow.balanceBefore1 !== snapshot.collateral[1]
  )
    throw new Error('Hedge quote does not match its confirmed snapshot')
  const before = fullPositions(
    pre,
    snapshot.positions.map((position) => position.tokenId),
  )
  const after = fullPositions(post, finalIds)
  if (after.positions.some((position) => expected.get(position.tokenId) !== position.positionSize))
    throw new Error('Hedge quote changed an unexpected position')
  const afterBook: FrozenHedgeBook = {
    ...snapshot.book,
    curve: await getPositionValueCurve({
      client,
      queryAddress: snapshot.queryAddress,
      positions: after.positions,
    }),
    balances: [
      flow.balanceAfter0 + snapshot.wallet[0] + after.premium[0] - reserve[0],
      flow.balanceAfter1 + snapshot.wallet[1] + after.premium[1] - reserve[1],
    ],
  }
  const beforeBook: FrozenHedgeBook = {
    ...snapshot.book,
    balances: [
      flow.balanceBefore0 + snapshot.wallet[0] + before.premium[0],
      flow.balanceBefore1 + snapshot.wallet[1] + before.premium[1],
    ],
  }
  const decimals =
    snapshot.book.numeraireIndex === 0n
      ? snapshot.metadata.token0Decimals
      : snapshot.metadata.token1Decimals
  const roundingReserve = 10n ** (decimals > 2n ? decimals - 2n : 0n)
  return {
    ...estimateProtectedHedgeGain({
      before: beforeBook,
      after: afterBook,
      anchor,
      roundingReserve,
    }),
    sqrtPriceLowerX96: lower,
    sqrtPriceUpperX96: upper,
    executionReserve: reserve,
  }
}

export async function getVaultHedgeAccountActivity({
  client,
  snapshot,
  fromBlock,
}: {
  client: PublicClient
  snapshot: VaultHedgeBookSnapshot
  fromBlock: bigint
}) {
  const addresses = [
    snapshot.metadata.collateralToken0Address,
    snapshot.metadata.collateralToken1Address,
    snapshot.metadata.token0Asset,
    snapshot.metadata.token1Asset,
  ]
  const [mints, burns, incoming, outgoing] = await Promise.all([
    client.getContractEvents({
      address: snapshot.poolAddress,
      abi: panopticPoolV2Abi,
      eventName: 'OptionMinted',
      args: { recipient: snapshot.account },
      fromBlock,
      toBlock: snapshot.blockNumber,
    }),
    client.getContractEvents({
      address: snapshot.poolAddress,
      abi: panopticPoolV2Abi,
      eventName: 'OptionBurnt',
      args: { recipient: snapshot.account },
      fromBlock,
      toBlock: snapshot.blockNumber,
    }),
    client.getContractEvents({
      address: addresses,
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { to: snapshot.account },
      fromBlock,
      toBlock: snapshot.blockNumber,
    }),
    client.getContractEvents({
      address: addresses,
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: snapshot.account },
      fromBlock,
      toBlock: snapshot.blockNumber,
    }),
  ])
  return [
    ...mints,
    ...burns,
    ...incoming.filter((log) => (log.args.value ?? 0n) > 0n),
    ...outgoing.filter((log) => (log.args.value ?? 0n) > 0n),
  ].reduce<bigint | undefined>(
    (latest, log) =>
      log.blockNumber !== null && (latest === undefined || log.blockNumber > latest)
        ? log.blockNumber
        : latest,
    undefined,
  )
}

export async function valueVaultHedgeGas({
  client,
  snapshot,
  blockNumber,
  gasCost,
}: {
  client: PublicClient
  snapshot: VaultHedgeBookSnapshot
  blockNumber: bigint
  gasCost: bigint
}) {
  const spot = await client.readContract({
    address: snapshot.metadata.underlyingPoolId as Address,
    abi: uniswapV3PoolAbi,
    functionName: 'slot0',
    blockNumber,
  })
  return snapshot.gasAssetIndex === 0n
    ? ceilDiv(gasCost * spot[0] ** 2n, Q192)
    : ceilDiv(gasCost * Q192, spot[0] ** 2n)
}
