/**
 * Resolve / ensure a Uniswap v3 pool is registered on the SFPM.
 * @module v2/sfpmSwap/init
 */
import type { Address, PublicClient, WalletClient } from 'viem'
import { getAddress, zeroAddress } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { PanopticError, WrongUniswapPoolError } from '../errors'
import { DEFAULT_VEGOID } from '../tokenId'

export interface FetchSfpmV3PoolIdParams {
  client: PublicClient
  sfpmAddress: Address
  token0: Address
  token1: Address
  /** Uniswap fee tier (e.g. 500 for 0.05%). */
  fee: number
  /** Vegoid; defaults to the SDK {@link DEFAULT_VEGOID}. Must match the market's other pools. */
  vegoid?: number
}

/**
 * Resolve the `uint64` SFPM poolId for a Uniswap v3 pool, initializing it if needed.
 *
 * `initializeAMMPool` is permissionless and idempotent and **returns the poolId**
 * whether or not the pool was already registered, so a `simulateContract` call is
 * enough to learn the id without sending a transaction. Always resolve the id this
 * way rather than encoding it offline — the SFPM can collision-increment ids.
 */
export async function fetchSfpmV3PoolId(params: FetchSfpmV3PoolIdParams): Promise<bigint> {
  const { client, sfpmAddress, token0, token1, fee } = params
  const vegoid = params.vegoid ?? Number(DEFAULT_VEGOID)
  const { result } = await client.simulateContract({
    address: sfpmAddress,
    abi: sfpmV3Abi,
    functionName: 'initializeAMMPool',
    args: [token0, token1, fee, vegoid],
  })
  return BigInt(result)
}

export interface EnsureSfpmV3PoolInitializedParams extends FetchSfpmV3PoolIdParams {
  wallet: WalletClient
  /** Expected underlying Uniswap v3 pool; if provided, the resolved id is verified against it. */
  expectedPool?: Address
}

export interface EnsureSfpmV3PoolInitializedResult {
  poolId: bigint
  /** True if an `initializeAMMPool` transaction was sent (pool was not yet registered). */
  initialized: boolean
}

/**
 * Ensure a Uniswap v3 pool is registered on the SFPM, sending `initializeAMMPool`
 * only if it is not already registered. Returns the resolved poolId.
 *
 * When `expectedPool` is given, the resolved id is checked to map back to it via
 * `getUniswapV3PoolFromId` — guards against a wrong token/fee triple.
 */
export async function ensureSfpmV3PoolInitialized(
  params: EnsureSfpmV3PoolInitializedParams,
): Promise<EnsureSfpmV3PoolInitializedResult> {
  const { client, wallet, sfpmAddress, token0, token1, fee, expectedPool } = params
  const vegoid = params.vegoid ?? Number(DEFAULT_VEGOID)

  const poolId = await fetchSfpmV3PoolId({ client, sfpmAddress, token0, token1, fee, vegoid })

  const registered = await client.readContract({
    address: sfpmAddress,
    abi: sfpmV3Abi,
    functionName: 'getUniswapV3PoolFromId',
    args: [poolId],
  })

  let initialized = false
  let resolved = registered
  if (getAddress(registered) === zeroAddress) {
    const account = wallet.account
    if (account === undefined) throw new PanopticError('wallet client has no account')
    const hash = await wallet.writeContract({
      account,
      chain: wallet.chain ?? null,
      address: sfpmAddress,
      abi: sfpmV3Abi,
      functionName: 'initializeAMMPool',
      args: [token0, token1, fee, vegoid],
    })
    await client.waitForTransactionReceipt({ hash })
    initialized = true
    // Re-read only after we sent initializeAMMPool; an already-registered pool
    // reuses the first read.
    resolved = await client.readContract({
      address: sfpmAddress,
      abi: sfpmV3Abi,
      functionName: 'getUniswapV3PoolFromId',
      args: [poolId],
    })
  }

  if (expectedPool !== undefined && getAddress(resolved) !== getAddress(expectedPool)) {
    throw new WrongUniswapPoolError(
      new PanopticError(`SFPM poolId ${poolId} resolves to ${resolved}, expected ${expectedPool}`),
    )
  }

  return { poolId, initialized }
}
