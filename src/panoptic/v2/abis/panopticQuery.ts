/**
 * PanopticQuery contract ABI
 * Auto-generated from PanopticQuery.json
 * @module abis/panopticQuery
 */

export const panopticQueryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'SFPM_',
        type: 'address',
        internalType: 'contract ISemiFungiblePositionManager',
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'checkCollateral',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
    ],
    outputs: [
      { name: 'collateralBalances0', type: 'uint256[4]', internalType: 'uint256[4]' },
      { name: 'requiredCollaterals0', type: 'uint256[4]', internalType: 'uint256[4]' },
      { name: 'collateralBalances1', type: 'uint256[4]', internalType: 'uint256[4]' },
      { name: 'requiredCollaterals1', type: 'uint256[4]', internalType: 'uint256[4]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'checkCollateral',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
    ],
    outputs: [
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: '', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'checkCollateralListOutput',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
    ],
    outputs: [
      { name: '', type: 'uint256[2][]', internalType: 'uint256[2][]' },
      { name: '', type: 'int256[]', internalType: 'int256[]' },
      { name: '', type: 'int24[]', internalType: 'int24[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeMedianObservedPrice',
    inputs: [
      { name: 'univ3pool', type: 'address', internalType: 'contract IUniswapV3Pool' },
      { name: 'cardinality', type: 'uint256', internalType: 'uint256' },
      { name: 'period', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'medianTick', type: 'int24', internalType: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getChunkData',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
    ],
    outputs: [{ name: '', type: 'uint256[2][4][]', internalType: 'uint256[2][4][]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'scanChunks',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'tickLower', type: 'int24', internalType: 'int24' },
      { name: 'tickUpper', type: 'int24', internalType: 'int24' },
      { name: 'width', type: 'int24', internalType: 'int24' },
    ],
    outputs: [
      { name: 'strikes', type: 'int24[]', internalType: 'int24[]' },
      { name: 'netLiquidities', type: 'uint128[2][]', internalType: 'uint128[2][]' },
      { name: 'removedLiquidities', type: 'uint128[2][]', internalType: 'uint128[2][]' },
      { name: 'settledTokens', type: 'uint256[2][]', internalType: 'LeftRightUnsigned[2][]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLiquidationPrices',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
    ],
    outputs: [
      { name: 'liquidationPriceDown', type: 'int24', internalType: 'int24' },
      { name: 'liquidationPriceUp', type: 'int24', internalType: 'int24' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMaxPositionSizeBounds',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'existingPositionIds', type: 'uint256[]', internalType: 'TokenId[]' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'tokenId', type: 'uint256', internalType: 'TokenId' },
    ],
    outputs: [
      { name: 'maxSizeAtMinUtil', type: 'uint128', internalType: 'uint128' },
      { name: 'maxSizeAtMaxUtil', type: 'uint128', internalType: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNetLiquidationValue',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'includePendingPremium', type: 'bool', internalType: 'bool' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
    ],
    outputs: [
      { name: 'value0', type: 'int256', internalType: 'int256' },
      { name: 'value1', type: 'int256', internalType: 'int256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPortfolioValue',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
    ],
    outputs: [
      { name: 'value0', type: 'int256', internalType: 'int256' },
      { name: 'value1', type: 'int256', internalType: 'int256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRequiredBase',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'tokenId', type: 'uint256', internalType: 'TokenId' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTickNets',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'startTick', type: 'int24', internalType: 'int24' },
      { name: 'nTicks', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      { name: 'tickData', type: 'int256[]', internalType: 'int256[]' },
      { name: 'liquidityNets', type: 'int256[]', internalType: 'int256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAccountSolvent',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'positionIdList', type: 'uint256[]', internalType: 'TokenId[]' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'optimizeRiskPartners',
    inputs: [
      { name: 'pool', type: 'address', internalType: 'contract PanopticPool' },
      { name: 'atTick', type: 'int24', internalType: 'int24' },
      { name: 'tokenId', type: 'uint256', internalType: 'TokenId' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'TokenId' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'twapFilter',
    inputs: [
      { name: 'univ3pool', type: 'address', internalType: 'contract IUniswapV3Pool' },
      { name: 'twapWindow', type: 'uint32', internalType: 'uint32' },
    ],
    outputs: [{ name: '', type: 'int24', internalType: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'validateTokenId',
    inputs: [{ name: 'self', type: 'uint256', internalType: 'TokenId' }],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'error',
    name: 'CastingError',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidTick',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidTokenIdParameter',
    inputs: [{ name: 'parameterType', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'LiquidityTooHigh',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnderOverFlow',
    inputs: [],
  },
] as const
