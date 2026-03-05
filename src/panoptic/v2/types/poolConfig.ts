/**
 * Pool version configuration types for V3 and V4 Uniswap pools.
 * @module v2/types/poolConfig
 */

import type { Address } from 'viem'

/** V3 pool configuration. */
export interface V3PoolConfig {
  version: 'v3'
  /** Uniswap V3 pool contract address */
  poolAddress: Address
}

/** V4 pool configuration. */
export interface V4PoolConfig {
  version: 'v4'
  /** StateView contract address */
  stateViewAddress: Address
  /** V4 pool ID (bytes32) */
  poolId: `0x${string}`
}

/** Discriminated union of V3 and V4 pool configurations. */
export type PoolVersionConfig = V3PoolConfig | V4PoolConfig
