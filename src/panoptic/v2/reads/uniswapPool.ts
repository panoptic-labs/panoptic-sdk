/**
 * Direct Uniswap V3 pool read — no Panoptic deployment required.
 *
 * @module v2/reads/uniswapPool
 */

import type { Address, Hex, PublicClient } from 'viem'
import { encodeAbiParameters, keccak256, zeroAddress } from 'viem'

import { panopticQueryAbi } from '../abis/panopticQuery'
import { stateViewAbi } from '../abis/stateView'
import { uniswapV3PoolAbi } from '../abis/uniswapV3Pool'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticValidationError } from '../errors'
import type { BlockMeta } from '../types'

const erc20MetaAbi = [
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

export interface UniswapV3PoolToken {
  address: Address
  symbol: string
  name: string
  decimals: number
}

export interface UniswapV3PoolInfo {
  poolAddress: Address
  token0: UniswapV3PoolToken
  token1: UniswapV3PoolToken
  /** Fee tier in hundredths of a bip (e.g. 500 = 0.05%) */
  fee: number
  tickSpacing: number
  currentTick: number
  sqrtPriceX96: bigint
  liquidity: bigint
  _meta: BlockMeta
}

export interface GetUniswapV3PoolInfoParams {
  client: PublicClient
  poolAddress: Address
}

/**
 * Fetch core data for a Uniswap V3 pool directly from chain.
 *
 * Does NOT require a Panoptic deployment — works for any V3 pool address.
 */
export async function getUniswapV3PoolInfo(
  params: GetUniswapV3PoolInfoParams,
): Promise<UniswapV3PoolInfo> {
  const { client, poolAddress } = params

  // Pin every read to the same block so pool state + token metadata are
  // self-consistent. Pool reads run first because token0/token1 are needed to
  // address the ERC20 metadata calls; the second multicall is pinned to the
  // same block as the first.
  const _meta = await getBlockMeta({ client })

  const [slot0, fee, tickSpacing, token0Addr, token1Addr, liquidity] = await client.multicall({
    allowFailure: false,
    blockNumber: _meta.blockNumber,
    contracts: [
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'slot0' },
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'fee' },
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'tickSpacing' },
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'token0' },
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'token1' },
      { address: poolAddress, abi: uniswapV3PoolAbi, functionName: 'liquidity' },
    ],
  })

  const [t0Symbol, t0Name, t0Decimals, t1Symbol, t1Name, t1Decimals] = await client.multicall({
    allowFailure: false,
    blockNumber: _meta.blockNumber,
    contracts: [
      { address: token0Addr, abi: erc20MetaAbi, functionName: 'symbol' },
      { address: token0Addr, abi: erc20MetaAbi, functionName: 'name' },
      { address: token0Addr, abi: erc20MetaAbi, functionName: 'decimals' },
      { address: token1Addr, abi: erc20MetaAbi, functionName: 'symbol' },
      { address: token1Addr, abi: erc20MetaAbi, functionName: 'name' },
      { address: token1Addr, abi: erc20MetaAbi, functionName: 'decimals' },
    ],
  })

  return {
    poolAddress,
    token0: {
      address: token0Addr,
      symbol: t0Symbol,
      name: t0Name,
      decimals: Number(t0Decimals),
    },
    token1: {
      address: token1Addr,
      symbol: t1Symbol,
      name: t1Name,
      decimals: Number(t1Decimals),
    },
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    currentTick: Number(slot0[1]),
    sqrtPriceX96: slot0[0],
    liquidity,
    _meta,
  }
}

export interface UniswapV3Liquidities {
  ticks: bigint[]
  liquidityNets: bigint[]
  _meta: BlockMeta
}

export interface GetUniswapV3PoolLiquiditiesParams {
  client: PublicClient
  /** Uniswap V3 pool address */
  poolAddress: Address
  /** PanopticQuery address — must expose the public `getTickNetsV3` overload */
  queryAddress: Address
  /** Center tick of the range to scan */
  startTick: number
  /** Number of ticks on each side of startTick to scan */
  nTicks: bigint
}

/** Absolute Uniswap V3/V4 tick bounds. */
const TICK_MIN = -887272
const TICK_MAX = 887272

/**
 * Clamp `nTicks` so the scan range
 *   [scaled(startTick) − nTicks·tickSpacing, scaled(startTick) + nTicks·tickSpacing]
 * stays within [TICK_MIN, TICK_MAX]. Required because PanopticQuery's
 * getTickNetsV3/V4 revert with "Tick out of bounds" otherwise.
 */
function clampNTicks(startTick: number, tickSpacing: number, nTicks: bigint): bigint {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new PanopticValidationError(
      `clampNTicks: tickSpacing must be a positive integer, got ${tickSpacing}`,
    )
  }
  const scaled = Math.trunc(startTick / tickSpacing) * tickSpacing
  const maxUp = Math.floor((TICK_MAX - scaled) / tickSpacing)
  const maxDown = Math.floor((scaled - TICK_MIN) / tickSpacing)
  const safe = BigInt(Math.max(0, Math.min(maxUp, maxDown)))
  return nTicks < safe ? nTicks : safe
}

/**
 * Fetch cumulative liquidity distribution for a Uniswap V3 pool via
 * `PanopticQuery.getTickNetsV3`. Does NOT require a Panoptic market to exist
 * for the pool — only a deployed PanopticQuery on the chain.
 */
export async function getUniswapV3PoolLiquidities(
  params: GetUniswapV3PoolLiquiditiesParams,
): Promise<UniswapV3Liquidities> {
  const { client, poolAddress, queryAddress, startTick, nTicks } = params

  // We don't know tickSpacing here; PanopticQuery reads it from the pool.
  // For safety, clamp against the worst case (tickSpacing = 1).
  const safeN = clampNTicks(startTick, 1, nTicks)

  // Pin the read to a specific block so the returned ticks/liquidityNets
  // are consistent with the _meta we hand back.
  const _meta = await getBlockMeta({ client })
  const [ticks, liquidityNets] = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'getTickNetsV3',
    args: [poolAddress, startTick, safeN],
    blockNumber: _meta.blockNumber,
  })

  return {
    ticks: [...ticks],
    liquidityNets: [...liquidityNets],
    _meta,
  }
}

// ============================================================================
// V4
// ============================================================================

export interface UniswapV4PoolKey {
  currency0: Address
  currency1: Address
  /** Fee in hundredths of a bip (e.g. 500 = 0.05%) */
  fee: number
  tickSpacing: number
  hooks: Address
}

const POOL_KEY_ABI_PARAMS = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
] as const

/** Compute the v4 poolId from a PoolKey: `keccak256(abi.encode(poolKey))`. */
export function computeV4PoolId(poolKey: UniswapV4PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(POOL_KEY_ABI_PARAMS, [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
    ]),
  )
}

export interface ResolveUniswapV4PoolKeyParams {
  client: PublicClient
  /** Uniswap V4 PoolManager address */
  poolManager: Address
  /** The bytes32 poolId hash */
  poolId: Hex
  /** Lower bound block for the scan (defaults to 0n) */
  fromBlock?: bigint
  /**
   * Per-request block range. Many RPCs cap getLogs at 10k/50k blocks;
   * defaults to 9_500 to stay under common limits.
   */
  chunkSize?: bigint
  /**
   * Number of chunked getLogs requests fired in parallel per batch.
   * Higher = faster but more likely to trip RPC rate limits. Default 8.
   */
  concurrency?: number
}

/**
 * Resolve a V4 PoolKey from its poolId by scanning `Initialize` event logs
 * on the PoolManager, filtered on the indexed `id` topic.
 *
 * Walks backwards from the latest block in `chunkSize` increments to
 * accommodate RPCs that cap getLogs ranges. Chunks are fired in parallel
 * batches of `concurrency` to keep wall-clock time low; returns as soon as
 * any batch produces a match. Throws if no event is found or if the
 * recomputed poolId does not match the queried one.
 */
export async function resolveUniswapV4PoolKey(
  _params: ResolveUniswapV4PoolKeyParams,
): Promise<UniswapV4PoolKey> {
  // Disabled to save on RPC costs — the Initialize-event scan over the full
  // PoolManager history can issue dozens of eth_getLogs requests per
  // first-load resolution. Re-enable by uncommenting the body below.
  throw new PanopticValidationError(
    'resolveUniswapV4PoolKey is disabled. ' +
      'Resolve the V4 PoolKey via your indexer (e.g. Ponder) and pass it to getUniswapV4PoolInfo directly.',
  )

  /*
  const {
    client,
    poolManager,
    poolId,
    fromBlock = 0n,
    chunkSize = 9_500n,
    concurrency = 8,
  } = _params

  const latest = await client.getBlockNumber()

  // Pre-compute all chunk ranges, walking backwards.
  const ranges: Array<{ from: bigint; to: bigint }> = []
  let to = latest
  while (to >= fromBlock) {
    const from = to - chunkSize + 1n > fromBlock ? to - chunkSize + 1n : fromBlock
    ranges.push({ from, to })
    if (from === fromBlock) break
    to = from - 1n
  }

  let foundLogs: Awaited<ReturnType<PublicClient['getLogs']>> = []

  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = ranges.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map((r) =>
        client.getLogs({
          address: poolManager,
          event: uniswapV4PoolManagerAbi[0],
          args: { id: poolId },
          fromBlock: r.from,
          toBlock: r.to,
        }),
      ),
    )
    const hit = results.find((logs) => logs.length > 0)
    if (hit) {
      foundLogs = hit
      break
    }
  }

  if (foundLogs.length === 0) {
    throw new Error(`No Initialize event found for poolId ${poolId} on PoolManager ${poolManager}`)
  }

  const args = (foundLogs[0] as { args: Record<string, unknown> }).args as {
    id: Hex
    currency0: Address
    currency1: Address
    fee: number
    tickSpacing: number
    hooks: Address
  }

  const key: UniswapV4PoolKey = {
    currency0: args.currency0,
    currency1: args.currency1,
    fee: Number(args.fee),
    tickSpacing: Number(args.tickSpacing),
    hooks: args.hooks,
  }

  const recomputed = computeV4PoolId(key)
  if (recomputed.toLowerCase() !== poolId.toLowerCase()) {
    throw new Error(
      `Recomputed poolId ${recomputed} does not match queried ${poolId} — PoolKey encoding mismatch`,
    )
  }

  return key
  */
}

/**
 * Slot0 + liquidity for a V4 pool by poolId — does NOT require the PoolKey.
 * Used to render basic info (currentTick, sqrtPriceX96, liquidity) when the
 * PoolKey is unknown.
 */
export interface UniswapV4PoolBasicState {
  poolId: Hex
  sqrtPriceX96: bigint
  currentTick: number
  /** Dynamic LP fee from slot0 (NOT necessarily the static PoolKey.fee). */
  lpFee: number
  liquidity: bigint
  _meta: BlockMeta
}

export interface GetUniswapV4PoolBasicStateParams {
  client: PublicClient
  stateViewAddress: Address
  poolId: Hex
}

export async function getUniswapV4PoolBasicState(
  params: GetUniswapV4PoolBasicStateParams,
): Promise<UniswapV4PoolBasicState> {
  const { client, stateViewAddress, poolId } = params
  // Pin slot0 + liquidity to the same block as the returned _meta.
  const _meta = await getBlockMeta({ client })
  const [slot0, liquidity] = await client.multicall({
    allowFailure: false,
    blockNumber: _meta.blockNumber,
    contracts: [
      { address: stateViewAddress, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] },
      {
        address: stateViewAddress,
        abi: stateViewAbi,
        functionName: 'getLiquidity',
        args: [poolId],
      },
    ],
  })
  return {
    poolId,
    sqrtPriceX96: slot0[0],
    currentTick: Number(slot0[1]),
    lpFee: Number(slot0[3]),
    liquidity,
    _meta,
  }
}

export interface UniswapV4PoolInfo {
  poolId: Hex
  poolKey: UniswapV4PoolKey
  token0: UniswapV3PoolToken
  token1: UniswapV3PoolToken
  fee: number
  tickSpacing: number
  hooks: Address
  currentTick: number
  sqrtPriceX96: bigint
  liquidity: bigint
  _meta: BlockMeta
}

export interface GetUniswapV4PoolInfoParams {
  client: PublicClient
  stateViewAddress: Address
  poolKey: UniswapV4PoolKey
}

/** Synthetic token metadata for native ETH (currency address `0x0`). */
const NATIVE_ETH_META = { symbol: 'ETH', name: 'Ether', decimals: 18 } as const

async function readErc20Meta(
  client: PublicClient,
  address: Address,
  blockNumber?: bigint,
): Promise<{ symbol: string; name: string; decimals: number }> {
  const [symbol, name, decimals] = await client.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address, abi: erc20MetaAbi, functionName: 'symbol' },
      { address, abi: erc20MetaAbi, functionName: 'name' },
      { address, abi: erc20MetaAbi, functionName: 'decimals' },
    ],
  })
  return { symbol, name, decimals: Number(decimals) }
}

/**
 * Fetch core data for a Uniswap V4 pool directly from chain.
 *
 * Does NOT require a Panoptic deployment — only StateView + (for non-native
 * currencies) ERC20s. Caller must supply a resolved PoolKey (see
 * `resolveUniswapV4PoolKey`).
 */
export async function getUniswapV4PoolInfo(
  params: GetUniswapV4PoolInfoParams,
): Promise<UniswapV4PoolInfo> {
  const { client, stateViewAddress, poolKey } = params
  const poolId = computeV4PoolId(poolKey)

  // Skip ERC20 metadata reads for native ETH (currency `0x0`) so the
  // multicall doesn't revert, and substitute synthetic metadata.
  const c0IsNative = poolKey.currency0 === zeroAddress
  const c1IsNative = poolKey.currency1 === zeroAddress

  const _meta = await getBlockMeta({ client })

  // State reads (slot0 + liquidity) batched in one multicall.
  const [slot0, liquidity] = await client.multicall({
    allowFailure: false,
    blockNumber: _meta.blockNumber,
    contracts: [
      { address: stateViewAddress, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] },
      {
        address: stateViewAddress,
        abi: stateViewAbi,
        functionName: 'getLiquidity',
        args: [poolId],
      },
    ],
  })

  // ERC20 metadata (skipped for native ETH) batched in a second multicall,
  // pinned to the same block as the state reads above for consistency.
  const token0Meta = c0IsNative
    ? { ...NATIVE_ETH_META }
    : await readErc20Meta(client, poolKey.currency0, _meta.blockNumber)
  const token1Meta = c1IsNative
    ? { ...NATIVE_ETH_META }
    : await readErc20Meta(client, poolKey.currency1, _meta.blockNumber)

  return {
    poolId,
    poolKey,
    token0: { address: poolKey.currency0, ...token0Meta },
    token1: { address: poolKey.currency1, ...token1Meta },
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
    currentTick: Number(slot0[1]),
    sqrtPriceX96: slot0[0],
    liquidity,
    _meta,
  }
}

export interface GetUniswapV4PoolLiquiditiesParams {
  client: PublicClient
  queryAddress: Address
  poolManager: Address
  poolId: Hex
  tickSpacing: number
  startTick: number
  nTicks: bigint
}

/**
 * Fetch cumulative liquidity distribution for a Uniswap V4 pool via
 * `PanopticQuery.getTickNetsV4`. Does NOT require a Panoptic market for the pool.
 */
export async function getUniswapV4PoolLiquidities(
  params: GetUniswapV4PoolLiquiditiesParams,
): Promise<UniswapV3Liquidities> {
  const { client, queryAddress, poolManager, poolId, tickSpacing, startTick, nTicks } = params

  const safeN = clampNTicks(startTick, tickSpacing, nTicks)

  // Pin to a specific block so the returned ticks/liquidityNets match _meta.
  const _meta = await getBlockMeta({ client })
  const [ticks, liquidityNets] = await client.readContract({
    address: queryAddress,
    abi: panopticQueryAbi,
    functionName: 'getTickNetsV4',
    args: [poolManager, poolId, tickSpacing, startTick, safeN],
    blockNumber: _meta.blockNumber,
  })

  return {
    ticks: [...ticks],
    liquidityNets: [...liquidityNets],
    _meta,
  }
}
