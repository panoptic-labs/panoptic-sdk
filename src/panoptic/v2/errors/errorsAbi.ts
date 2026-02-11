/**
 * Custom error ABI definitions for Panoptic v2 contracts.
 *
 * Contains all custom errors from Errors.sol with their signatures.
 * Used for decoding contract revert data.
 *
 * @module v2/errors/errorsAbi
 */

/**
 * All custom errors from Panoptic Errors.sol
 *
 * Selector computation: keccak256(errorSignature)[:4]
 */
export const panopticErrorsAbi = [
  // AccountInsolvent(uint256 solvent, uint256 numberOfTicks) - 0x3218b99e
  {
    type: 'error',
    name: 'AccountInsolvent',
    inputs: [
      { name: 'solvent', type: 'uint256' },
      { name: 'numberOfTicks', type: 'uint256' },
    ],
  },

  // CastingError() - 0x93daf810
  {
    type: 'error',
    name: 'CastingError',
    inputs: [],
  },

  // BelowMinimumRedemption() - 0x2aef283e
  {
    type: 'error',
    name: 'BelowMinimumRedemption',
    inputs: [],
  },

  // ChunkHasZeroLiquidity() - 0x64a18bfa
  {
    type: 'error',
    name: 'ChunkHasZeroLiquidity',
    inputs: [],
  },

  // AlreadyInitialized() - 0x0dc149f0
  {
    type: 'error',
    name: 'AlreadyInitialized',
    inputs: [],
  },

  // DepositTooLarge() - 0xf3036c6e
  {
    type: 'error',
    name: 'DepositTooLarge',
    inputs: [],
  },

  // DuplicateTokenId() - 0x744b5fb5
  {
    type: 'error',
    name: 'DuplicateTokenId',
    inputs: [],
  },

  // EffectiveLiquidityAboveThreshold() - 0xb21f44b1
  {
    type: 'error',
    name: 'EffectiveLiquidityAboveThreshold',
    inputs: [],
  },

  // ExceedsMaximumRedemption() - 0x45eb47f9
  {
    type: 'error',
    name: 'ExceedsMaximumRedemption',
    inputs: [],
  },

  // InputListFail() - 0x9e1e7504
  {
    type: 'error',
    name: 'InputListFail',
    inputs: [],
  },

  // InvalidTick() - 0x4d0d02a6
  {
    type: 'error',
    name: 'InvalidTick',
    inputs: [],
  },

  // LiquidityTooHigh() - 0x6c91bc63
  {
    type: 'error',
    name: 'LiquidityTooHigh',
    inputs: [],
  },

  // InsufficientCreditLiquidity() - 0xd87fb8e5
  {
    type: 'error',
    name: 'InsufficientCreditLiquidity',
    inputs: [],
  },

  // InvalidBuilderCode() - 0x4b8b8ff9
  {
    type: 'error',
    name: 'InvalidBuilderCode',
    inputs: [],
  },

  // InvalidTokenIdParameter(uint256 parameterType) - 0x3cfb2764
  {
    type: 'error',
    name: 'InvalidTokenIdParameter',
    inputs: [{ name: 'parameterType', type: 'uint256' }],
  },

  // InvalidUniswapCallback() - 0xd988f608
  {
    type: 'error',
    name: 'InvalidUniswapCallback',
    inputs: [],
  },

  // LengthMismatch() - 0xff633a38
  {
    type: 'error',
    name: 'LengthMismatch',
    inputs: [],
  },

  // NetLiquidityZero() - 0x18a52143
  {
    type: 'error',
    name: 'NetLiquidityZero',
    inputs: [],
  },

  // NoLegsExercisable() - 0x2ce255b0
  {
    type: 'error',
    name: 'NoLegsExercisable',
    inputs: [],
  },

  // NotALongLeg() - 0x7f0b6b9c
  {
    type: 'error',
    name: 'NotALongLeg',
    inputs: [],
  },

  // NotBuilder() - 0x15ad5773
  {
    type: 'error',
    name: 'NotBuilder',
    inputs: [],
  },

  // NotEnoughLiquidityInChunk() - 0x4ffe6c2d
  {
    type: 'error',
    name: 'NotEnoughLiquidityInChunk',
    inputs: [],
  },

  // NotEnoughTokens(address tokenAddress, uint256 assetsRequested, uint256 assetBalance) - 0x4c5c7d56
  {
    type: 'error',
    name: 'NotEnoughTokens',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'assetsRequested', type: 'uint256' },
      { name: 'assetBalance', type: 'uint256' },
    ],
  },

  // NotGuardian() - 0xc6c37d89
  {
    type: 'error',
    name: 'NotGuardian',
    inputs: [],
  },

  // NotMarginCalled() - 0xb0a49d1c
  {
    type: 'error',
    name: 'NotMarginCalled',
    inputs: [],
  },

  // NotPanopticPool() - 0x4c1c778d
  {
    type: 'error',
    name: 'NotPanopticPool',
    inputs: [],
  },

  // PoolNotInitialized() - 0x20b22a6a
  {
    type: 'error',
    name: 'PoolNotInitialized',
    inputs: [],
  },

  // PositionCountNotZero() - 0xa10d6e3b
  {
    type: 'error',
    name: 'PositionCountNotZero',
    inputs: [],
  },

  // PositionNotOwned() - 0x67f6e0b0
  {
    type: 'error',
    name: 'PositionNotOwned',
    inputs: [],
  },

  // PositionTooLarge() - 0x61a3f549
  {
    type: 'error',
    name: 'PositionTooLarge',
    inputs: [],
  },

  // PriceBoundFail(int24 currentTick) - 0x79a0f63e
  {
    type: 'error',
    name: 'PriceBoundFail',
    inputs: [{ name: 'currentTick', type: 'int24' }],
  },

  // PriceImpactTooLarge() - 0x2aba45d8
  {
    type: 'error',
    name: 'PriceImpactTooLarge',
    inputs: [],
  },

  // StaleOracle() - 0x17308f56
  {
    type: 'error',
    name: 'StaleOracle',
    inputs: [],
  },

  // TooManyLegsOpen() - 0x1c03e9d0
  {
    type: 'error',
    name: 'TooManyLegsOpen',
    inputs: [],
  },

  // TransferFailed(address token, address from, uint256 amount, uint256 balance) - 0x4e487b71
  {
    type: 'error',
    name: 'TransferFailed',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'balance', type: 'uint256' },
    ],
  },

  // InvalidTickBound() - 0x1577d966
  {
    type: 'error',
    name: 'InvalidTickBound',
    inputs: [],
  },

  // UnauthorizedUniswapCallback() - 0xec19dc87
  {
    type: 'error',
    name: 'UnauthorizedUniswapCallback',
    inputs: [],
  },

  // UnderOverFlow() - 0xf5c787f1
  {
    type: 'error',
    name: 'UnderOverFlow',
    inputs: [],
  },

  // Reentrancy() - 0xab143c06
  {
    type: 'error',
    name: 'Reentrancy',
    inputs: [],
  },

  // WrongPoolId() - 0x8a3c9c0b
  {
    type: 'error',
    name: 'WrongPoolId',
    inputs: [],
  },

  // WrongUniswapPool() - 0x68d1bc36
  {
    type: 'error',
    name: 'WrongUniswapPool',
    inputs: [],
  },

  // ZeroAddress() - 0xd92e233d
  {
    type: 'error',
    name: 'ZeroAddress',
    inputs: [],
  },

  // ZeroCollateralRequirement() - 0xe24c9f94
  {
    type: 'error',
    name: 'ZeroCollateralRequirement',
    inputs: [],
  },

  // TokenIdHasZeroLegs() - 0x11ec0e81
  {
    type: 'error',
    name: 'TokenIdHasZeroLegs',
    inputs: [],
  },
] as const
