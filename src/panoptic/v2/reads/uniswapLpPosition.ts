/**
 * Direct Uniswap V3/V4 LP position reads — no Panoptic deployment required.
 *
 * Fetches a position's liquidity, tick range and uncollected fees:
 * - V3: `NonfungiblePositionManager.positions` + a `collect` simulation
 *   (exact fees, including tokensOwed and unaccrued feeGrowth).
 * - V4: `StateView.getPositionInfo` + `getFeeGrowthInside` and the
 *   feeGrowthInside delta math from v4-core's `Position.calculatePositionFeesAccrued`.
 *
 * @module v2/reads/uniswapLpPosition
 */

import type { Address, Hex, PublicClient } from 'viem'
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, toHex } from 'viem'

import { StateViewAbi } from '../../../abis/StateView'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'

// The root NonFungiblePositionManagerAbi flattens collect's CollectParams
// struct into scalar inputs, which yields a different function selector than
// the deployed contract's `collect((uint256,address,uint128,uint128))` — so a
// correct minimal ABI is defined here.
const nfpmAbi = [
  {
    type: 'function',
    name: 'positions',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'collect',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'amount0Max', type: 'uint128' },
          { name: 'amount1Max', type: 'uint128' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
] as const

const MAX_UINT128 = 2n ** 128n - 1n
const MAX_UINT256 = 2n ** 256n - 1n
const Q128 = 2n ** 128n

/** Liquidity, range and uncollected fees for a single LP position. */
export interface UniswapLpPositionState {
  liquidity: bigint
  tickLower: number
  tickUpper: number
  /** Uncollected fees in token0, inclusive of tokensOwed (V3). */
  fees0: bigint
  /** Uncollected fees in token1, inclusive of tokensOwed (V3). */
  fees1: bigint
  /** Block metadata the reads were pinned to. */
  _meta: BlockMeta
}

/**
 * Whether an error thrown by a viem contract call is an on-chain revert (as
 * opposed to a transport/RPC failure such as a timeout or rate limit).
 */
function isContractRevert(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (err) =>
        err instanceof ContractFunctionRevertedError || err instanceof ExecutionRevertedError,
    ) != null
  )
}

export interface UniswapV3LpPositionState extends UniswapLpPositionState {
  token0: Address
  token1: Address
  /** Fee tier in hundredths of a bip (e.g. 500 = 0.05%). */
  fee: number
}

export interface GetUniswapV3LpPositionStateParams {
  client: PublicClient
  /** NonfungiblePositionManager address. */
  nfpmAddress: Address
  /** ERC721 tokenId of the position. */
  tokenId: bigint
  /** Current owner of the position NFT (used as `account` for the collect simulation). */
  owner: Address
  /** Optional historical block to pin the position read to. */
  blockNumber?: bigint
}

/**
 * Fetch a Uniswap V3 LP position's state and uncollected fees.
 *
 * Fees come from simulating `collect` with max amounts as the owner — one
 * eth_call returning the exact claimable amounts (tokensOwed + fee growth
 * since the last poke). The simulation is best-effort: if it reverts (e.g.
 * an empty position), fees fall back to 0.
 */
export async function getUniswapV3LpPositionState(
  params: GetUniswapV3LpPositionStateParams,
): Promise<UniswapV3LpPositionState> {
  const { client, nfpmAddress, tokenId, owner, blockNumber } = params

  // Pin both reads to the same block so position state and fees are
  // self-consistent with the returned _meta. The collect simulation cannot be
  // folded into a Multicall3 batch: it must run with msg.sender = owner.
  const _meta = await getBlockMeta({ client, blockNumber })

  const position = await client.readContract({
    address: nfpmAddress,
    abi: nfpmAbi,
    functionName: 'positions',
    args: [tokenId],
    blockNumber: _meta.blockNumber,
  })
  const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = position

  let fees0 = 0n
  let fees1 = 0n
  try {
    const { result } = await client.simulateContract({
      address: nfpmAddress,
      abi: nfpmAbi,
      functionName: 'collect',
      args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      account: owner,
      blockNumber: _meta.blockNumber,
    })
    ;[fees0, fees1] = result
  } catch (error) {
    // collect reverts for some empty positions — report zero fees. Transport
    // and RPC failures propagate so callers don't mistake them for no fees.
    if (!isContractRevert(error)) throw error
  }

  return {
    token0,
    token1,
    fee: Number(fee),
    tickLower: Number(tickLower),
    tickUpper: Number(tickUpper),
    liquidity,
    fees0,
    fees1,
    _meta,
  }
}

/**
 * Uncollected fees from a feeGrowthInside delta, mirroring v4-core's
 * `Position.calculatePositionFeesAccrued`: the subtraction wraps around
 * uint256 (feeGrowthInside can legitimately underflow in-protocol).
 */
export function feesFromFeeGrowthDelta(
  feeGrowthInsideCurrentX128: bigint,
  feeGrowthInsideLastX128: bigint,
  liquidity: bigint,
): bigint {
  const delta = (feeGrowthInsideCurrentX128 - feeGrowthInsideLastX128) & MAX_UINT256
  return (delta * liquidity) / Q128
}

export interface GetUniswapV4LpPositionStateParams {
  client: PublicClient
  /** StateView address. */
  stateViewAddress: Address
  /** Uniswap v4 PositionManager (posm) address — the position owner inside PoolManager. */
  positionManagerAddress: Address
  /** The bytes32 poolId hash. */
  poolId: Hex
  /** ERC721 tokenId of the position (posm salt = bytes32(tokenId)). */
  tokenId: bigint
  tickLower: number
  tickUpper: number
  /** Optional historical block to pin the position read to. */
  blockNumber?: bigint
}

/**
 * Fetch a Uniswap V4 LP position's state and uncollected fees via StateView.
 *
 * The position inside PoolManager is keyed by (positionManager, tickLower,
 * tickUpper, salt) where posm uses `bytes32(tokenId)` as the salt. Fees on
 * pools with fee-taking hooks may be approximate.
 */
export async function getUniswapV4LpPositionState(
  params: GetUniswapV4LpPositionStateParams,
): Promise<UniswapLpPositionState> {
  const {
    client,
    stateViewAddress,
    positionManagerAddress,
    poolId,
    tokenId,
    tickLower,
    tickUpper,
    blockNumber,
  } = params

  const salt = toHex(tokenId, { size: 32 })

  // Pin both StateView reads to the same block as the returned _meta.
  const _meta = await getBlockMeta({ client, blockNumber })

  const [positionInfo, feeGrowthInside] = await client.multicall({
    allowFailure: false,
    blockNumber: _meta.blockNumber,
    contracts: [
      {
        address: stateViewAddress,
        abi: StateViewAbi,
        functionName: 'getPositionInfo',
        args: [poolId, positionManagerAddress, tickLower, tickUpper, salt],
      },
      {
        address: stateViewAddress,
        abi: StateViewAbi,
        functionName: 'getFeeGrowthInside',
        args: [poolId, tickLower, tickUpper],
      },
    ],
  })

  const [liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128] = positionInfo
  const [feeGrowthInside0X128, feeGrowthInside1X128] = feeGrowthInside

  return {
    liquidity,
    tickLower,
    tickUpper,
    fees0: feesFromFeeGrowthDelta(feeGrowthInside0X128, feeGrowthInside0LastX128, liquidity),
    fees1: feesFromFeeGrowthDelta(feeGrowthInside1X128, feeGrowthInside1LastX128, liquidity),
    _meta,
  }
}
