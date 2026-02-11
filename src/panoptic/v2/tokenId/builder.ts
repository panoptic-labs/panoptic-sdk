/**
 * TokenId builder for the Panoptic v2 SDK.
 * @module v2/tokenId/builder
 */

import type { Address, Hex } from 'viem'

import { InvalidTokenIdParameterError } from '../errors'
import { LEG_LIMITS, TOKEN_ID_BITS } from './constants'
import { type EncodeLegParams, addLegToTokenId, encodePoolId, encodeV4PoolId } from './encoding'

/**
 * Leg configuration for the builder.
 */
export interface LegConfig {
  /** Asset index (0 or 1) */
  asset: bigint
  /** Option ratio (1-127) */
  optionRatio: bigint
  /** Whether this is a long position */
  isLong: boolean
  /** Token type (0 or 1) */
  tokenType: bigint
  /** Risk partner leg index (defaults to self) */
  riskPartner?: bigint
  /** Strike tick (center of the range) */
  strike: bigint
  /** Width in tick spacing units (0 for loans/credits) */
  width: bigint
}

/**
 * Loan/credit leg configuration.
 * Uses width=0 encoding to signal the loan/credit branch.
 */
export interface LoanCreditConfig {
  /** Asset index (0 or 1) */
  asset: bigint
  /** Token type (0 or 1) - which token to borrow/lend */
  tokenType: bigint
  /** Strike tick (price point for the loan/credit) */
  strike: bigint
  /** Option ratio (1-127, defaults to 1) */
  optionRatio?: bigint
  /** Risk partner leg index (defaults to self) */
  riskPartner?: bigint
}

/**
 * TokenId builder interface.
 * Provides a fluent API for constructing TokenIds.
 */
export interface TokenIdBuilder {
  /**
   * Add a leg to the TokenId.
   * @param config - The leg configuration
   * @returns The builder for chaining
   * @throws InvalidTokenIdParameterError if leg parameters are invalid
   */
  addLeg: (config: LegConfig) => TokenIdBuilder

  /**
   * Add a call leg. A call is when tokenType === asset.
   * @param config - Partial leg config (tokenType set automatically based on asset, asset defaults to 0)
   * @returns The builder for chaining
   */
  addCall: (config: Omit<LegConfig, 'tokenType' | 'asset'> & { asset?: bigint }) => TokenIdBuilder

  /**
   * Add a put leg. A put is when tokenType !== asset.
   * @param config - Partial leg config (tokenType set automatically based on asset, asset defaults to 0)
   * @returns The builder for chaining
   */
  addPut: (config: Omit<LegConfig, 'tokenType' | 'asset'> & { asset?: bigint }) => TokenIdBuilder

  /**
   * Add a loan leg (borrow liquidity). Uses width=0 with isLong=false.
   *
   * A loan borrows liquidity from the pool at a specific strike price.
   * The borrower receives the token and owes interest (streaming premium).
   *
   * @param config - Loan configuration (tokenType, strike, optionRatio)
   * @returns The builder for chaining
   */
  addLoan: (config: LoanCreditConfig) => TokenIdBuilder

  /**
   * Add a credit leg (lend liquidity). Uses width=0 with isLong=true.
   *
   * A credit lends liquidity to the pool at a specific strike price.
   * The lender deposits the token and earns interest (streaming premium).
   *
   * @param config - Credit configuration (tokenType, strike, optionRatio)
   * @returns The builder for chaining
   */
  addCredit: (config: LoanCreditConfig) => TokenIdBuilder

  /**
   * Build the final TokenId.
   * @returns The constructed TokenId
   * @throws InvalidTokenIdParameterError if the TokenId has no legs
   */
  build: () => bigint

  /**
   * Get the current number of legs.
   * @returns The leg count
   */
  legCount: () => bigint

  /**
   * Reset the builder to start fresh with just the pool ID.
   * @returns The builder for chaining
   */
  reset: () => TokenIdBuilder
}

/**
 * Create a TokenId builder for a Uniswap V3 pool.
 *
 * @param poolAddress - The Uniswap V3 pool address
 * @param tickSpacing - The tick spacing of the pool
 * @param vegoid - Optional vegoid value (defaults to 4)
 * @returns A TokenId builder instance
 *
 * @example
 * ```typescript
 * const tokenId = createTokenIdBuilder(poolAddress, 60n)
 *   .addCall({ strike: 100n, width: 10n, optionRatio: 1n, isLong: false })
 *   .addPut({ strike: -100n, width: 10n, optionRatio: 1n, isLong: false })
 *   .build()
 * ```
 */
export function createTokenIdBuilder(
  poolAddress: Address,
  tickSpacing: bigint,
  vegoid?: bigint,
): TokenIdBuilder {
  const poolId = encodePoolId(poolAddress, tickSpacing, vegoid)
  return createBuilderFromPoolId(poolId)
}

/**
 * Create a TokenId builder for a Uniswap V4 pool.
 *
 * @param poolIdHex - The V4 pool ID (bytes32 hex string)
 * @param tickSpacing - The tick spacing of the pool
 * @param vegoid - Optional vegoid value (defaults to 4)
 * @returns A TokenId builder instance
 */
export function createTokenIdBuilderV4(
  poolIdHex: Hex,
  tickSpacing: bigint,
  vegoid?: bigint,
): TokenIdBuilder {
  const poolId = encodeV4PoolId(poolIdHex, tickSpacing, vegoid)
  return createBuilderFromPoolId(poolId)
}

/**
 * Create a TokenId builder from an existing encoded pool ID.
 *
 * Use this when you already have the 64-bit poolId (e.g. from `getPool().poolId`).
 * This works for both V3 and V4 pools since it bypasses address-based encoding.
 *
 * @param poolId - The encoded 64-bit pool ID
 * @returns A TokenId builder instance
 */
export function createBuilderFromPoolId(poolId: bigint): TokenIdBuilder {
  let tokenId = poolId
  let currentLegIndex = 0n

  const validateLegConfig = (config: LegConfig, legIndex: bigint): void => {
    if (legIndex >= TOKEN_ID_BITS.MAX_LEGS) {
      throw new InvalidTokenIdParameterError(0n) // Too many legs
    }

    if (config.optionRatio < 1n || config.optionRatio > LEG_LIMITS.MAX_RATIO) {
      throw new InvalidTokenIdParameterError(1n) // Invalid option ratio
    }

    // width == 0 is valid for loans/credits, otherwise must be 1-4095
    if (config.width < 0n || config.width > LEG_LIMITS.MAX_WIDTH) {
      throw new InvalidTokenIdParameterError(2n) // Invalid width
    }

    if (config.strike < LEG_LIMITS.MIN_STRIKE || config.strike > LEG_LIMITS.MAX_STRIKE) {
      throw new InvalidTokenIdParameterError(3n) // Invalid strike
    }

    if (config.asset !== 0n && config.asset !== 1n) {
      throw new InvalidTokenIdParameterError(4n) // Invalid asset
    }

    if (config.tokenType !== 0n && config.tokenType !== 1n) {
      throw new InvalidTokenIdParameterError(5n) // Invalid tokenType
    }

    const riskPartner = config.riskPartner ?? legIndex
    if (riskPartner < 0n || riskPartner > 3n) {
      throw new InvalidTokenIdParameterError(6n) // Invalid risk partner
    }
  }

  const builder: TokenIdBuilder = {
    addLeg(config: LegConfig): TokenIdBuilder {
      validateLegConfig(config, currentLegIndex)

      const leg: EncodeLegParams = {
        index: currentLegIndex,
        asset: config.asset,
        optionRatio: config.optionRatio,
        isLong: config.isLong ? 1n : 0n,
        tokenType: config.tokenType,
        riskPartner: config.riskPartner ?? currentLegIndex,
        strike: config.strike,
        width: config.width,
      }

      tokenId = addLegToTokenId(tokenId, leg)
      currentLegIndex++

      return builder
    },

    addCall(config: Omit<LegConfig, 'tokenType' | 'asset'> & { asset?: bigint }): TokenIdBuilder {
      const asset = config.asset ?? 0n
      return builder.addLeg({
        ...config,
        tokenType: asset, // Call: tokenType === asset
        asset,
      })
    },

    addPut(config: Omit<LegConfig, 'tokenType' | 'asset'> & { asset?: bigint }): TokenIdBuilder {
      const asset = config.asset ?? 0n
      return builder.addLeg({
        ...config,
        tokenType: asset === 0n ? 1n : 0n, // Put: tokenType !== asset
        asset,
      })
    },

    addLoan(config: LoanCreditConfig): TokenIdBuilder {
      // Loan: width=0, isLong=false (borrowing liquidity)
      // asset is set to same as tokenType for loans
      return builder.addLeg({
        asset: config.asset,
        optionRatio: config.optionRatio ?? 1n,
        isLong: false,
        tokenType: config.tokenType,
        riskPartner: config.riskPartner,
        strike: config.strike,
        width: 0n, // width=0 signals loan/credit branch
      })
    },

    addCredit(config: LoanCreditConfig): TokenIdBuilder {
      // Credit: width=0, isLong=true (lending liquidity)
      // asset is set to same as tokenType for credits
      return builder.addLeg({
        asset: config.asset,
        optionRatio: config.optionRatio ?? 1n,
        isLong: true,
        tokenType: config.tokenType,
        riskPartner: config.riskPartner,
        strike: config.strike,
        width: 0n, // width=0 signals loan/credit branch
      })
    },

    build(): bigint {
      if (currentLegIndex === 0n) {
        throw new InvalidTokenIdParameterError(7n) // No legs
      }
      return tokenId
    },

    legCount(): bigint {
      return currentLegIndex
    },

    reset(): TokenIdBuilder {
      tokenId = poolId
      currentLegIndex = 0n
      return builder
    },
  }

  return builder
}
