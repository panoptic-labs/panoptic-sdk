/**
 * Custom error ABI definitions for Panoptic v2 contracts.
 *
 * Contains all custom errors from Errors.sol with their signatures.
 * Used for decoding contract revert data.
 *
 * Selectors sourced from `forge selectors list` output.
 *
 * @module v2/errors/errorsAbi
 */

/**
 * All custom errors from Panoptic Errors.sol
 *
 * Selector computation: keccak256(errorSignature)[:4]
 */
export const panopticErrorsAbi = [
  // AccountInsolvent(uint256 solvent, uint256 numberOfTicks) - 0xcdef092d
  {
    type: 'error',
    name: 'AccountInsolvent',
    inputs: [
      { name: 'solvent', type: 'uint256' },
      { name: 'numberOfTicks', type: 'uint256' },
    ],
  },

  // AlreadyInitialized() - 0x0dc149f0
  {
    type: 'error',
    name: 'AlreadyInitialized',
    inputs: [],
  },

  // BelowMinimumRedemption() - 0x13185bd7
  {
    type: 'error',
    name: 'BelowMinimumRedemption',
    inputs: [],
  },

  // CastingError() - 0xb6680045
  {
    type: 'error',
    name: 'CastingError',
    inputs: [],
  },

  // ChunkHasZeroLiquidity() - 0x126ae3af
  {
    type: 'error',
    name: 'ChunkHasZeroLiquidity',
    inputs: [],
  },

  // CreateFail() - 0xebfef188
  {
    type: 'error',
    name: 'CreateFail',
    inputs: [],
  },

  // DepositTooLarge() - 0xc56d46d3
  {
    type: 'error',
    name: 'DepositTooLarge',
    inputs: [],
  },

  // DuplicateTokenId() - 0x2bd1a05a
  {
    type: 'error',
    name: 'DuplicateTokenId',
    inputs: [],
  },

  // EffectiveLiquidityAboveThreshold() - 0x3a8795c2
  {
    type: 'error',
    name: 'EffectiveLiquidityAboveThreshold',
    inputs: [],
  },

  // ExceedsMaximumRedemption() - 0x20adf2ea
  {
    type: 'error',
    name: 'ExceedsMaximumRedemption',
    inputs: [],
  },

  // InputListFail() - 0x99e877ce
  {
    type: 'error',
    name: 'InputListFail',
    inputs: [],
  },

  // InsufficientCreditLiquidity() - 0x7a70c281
  {
    type: 'error',
    name: 'InsufficientCreditLiquidity',
    inputs: [],
  },

  // InvalidBuilderCode() - 0x15b3fb46
  {
    type: 'error',
    name: 'InvalidBuilderCode',
    inputs: [],
  },

  // InvalidTick() - 0xce8ef7fc
  {
    type: 'error',
    name: 'InvalidTick',
    inputs: [],
  },

  // InvalidTickBound() - 0x1577d966
  {
    type: 'error',
    name: 'InvalidTickBound',
    inputs: [],
  },

  // InvalidTokenIdParameter(uint256 parameterType) - 0x93db0263
  {
    type: 'error',
    name: 'InvalidTokenIdParameter',
    inputs: [{ name: 'parameterType', type: 'uint256' }],
  },

  // InvalidUniswapCallback() - 0x3a94c705
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

  // LiquidityTooHigh() - 0xa500e7ea
  {
    type: 'error',
    name: 'LiquidityTooHigh',
    inputs: [],
  },

  // NetLiquidityZero() - 0x73582ea0
  {
    type: 'error',
    name: 'NetLiquidityZero',
    inputs: [],
  },

  // NoLegsExercisable() - 0x7721f7da
  {
    type: 'error',
    name: 'NoLegsExercisable',
    inputs: [],
  },

  // NotALongLeg() - 0xb7d44f76
  {
    type: 'error',
    name: 'NotALongLeg',
    inputs: [],
  },

  // NotBuilder() - 0x0404714e
  {
    type: 'error',
    name: 'NotBuilder',
    inputs: [],
  },

  // NotEnoughLiquidityInChunk() - 0xc56d518e
  {
    type: 'error',
    name: 'NotEnoughLiquidityInChunk',
    inputs: [],
  },

  // NotEnoughTokens(address tokenAddress, uint256 assetsRequested, uint256 assetBalance) - 0x71c3730b
  {
    type: 'error',
    name: 'NotEnoughTokens',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'assetsRequested', type: 'uint256' },
      { name: 'assetBalance', type: 'uint256' },
    ],
  },

  // NotGuardian() - 0xef6d0f02
  {
    type: 'error',
    name: 'NotGuardian',
    inputs: [],
  },

  // NotMarginCalled() - 0x2a23f1ad
  {
    type: 'error',
    name: 'NotMarginCalled',
    inputs: [],
  },

  // NotPanopticPool() - 0x2dd1912a
  {
    type: 'error',
    name: 'NotPanopticPool',
    inputs: [],
  },

  // PoolNotInitialized() - 0x486aa307
  {
    type: 'error',
    name: 'PoolNotInitialized',
    inputs: [],
  },

  // PositionCountNotZero() - 0x2501f81e
  {
    type: 'error',
    name: 'PositionCountNotZero',
    inputs: [],
  },

  // PositionNotOwned() - 0x00bd51c8
  {
    type: 'error',
    name: 'PositionNotOwned',
    inputs: [],
  },

  // PositionTooLarge() - 0x543a6e10
  {
    type: 'error',
    name: 'PositionTooLarge',
    inputs: [],
  },

  // PriceBoundFail(int24 currentTick) - 0x618ea40c
  {
    type: 'error',
    name: 'PriceBoundFail',
    inputs: [{ name: 'currentTick', type: 'int24' }],
  },

  // PriceImpactTooLarge() - 0xcbe5b9a6
  {
    type: 'error',
    name: 'PriceImpactTooLarge',
    inputs: [],
  },

  // Reentrancy() - 0xab143c06
  {
    type: 'error',
    name: 'Reentrancy',
    inputs: [],
  },

  // StaleOracle() - 0x88cce429
  {
    type: 'error',
    name: 'StaleOracle',
    inputs: [],
  },

  // TokenIdHasZeroLegs() - 0x9cd92fb2
  {
    type: 'error',
    name: 'TokenIdHasZeroLegs',
    inputs: [],
  },

  // TooManyLegsOpen() - 0x0ed7e777
  {
    type: 'error',
    name: 'TooManyLegsOpen',
    inputs: [],
  },

  // TransferFailed(address token, address from, uint256 amount, uint256 balance) - 0x81f20f86
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

  // UnauthorizedUniswapCallback() - 0x3e30718a
  {
    type: 'error',
    name: 'UnauthorizedUniswapCallback',
    inputs: [],
  },

  // UnderOverFlow() - 0xd2190174
  {
    type: 'error',
    name: 'UnderOverFlow',
    inputs: [],
  },

  // WrongPoolId() - 0xcfa4bfa2
  {
    type: 'error',
    name: 'WrongPoolId',
    inputs: [],
  },

  // WrongUniswapPool() - 0x768778de
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

  // ZeroCollateralRequirement() - 0x5b8edb4a
  {
    type: 'error',
    name: 'ZeroCollateralRequirement',
    inputs: [],
  },
] as const
