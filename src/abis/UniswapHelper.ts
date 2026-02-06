export const UniswapHelperAbi = [
  {
    inputs: [
      { internalType: 'contract IUniswapV3Factory', name: '_factory', type: 'address' },
      { internalType: 'contract INonfungiblePositionManager', name: '_NFPM', type: 'address' },
      { internalType: 'contract SemiFungiblePositionManager', name: '_SFPM', type: 'address' },
    ],
    stateMutability: 'payable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'getNfpmPositionsForAccount',
    outputs: [
      {
        components: [
          { internalType: 'uint96', name: 'nonce', type: 'uint96' },
          { internalType: 'address', name: 'operator', type: 'address' },
          { internalType: 'address', name: 'token0', type: 'address' },
          { internalType: 'address', name: 'token1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickLower', type: 'int24' },
          { internalType: 'int24', name: 'tickUpper', type: 'int24' },
          { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
          { internalType: 'uint256', name: 'feeGrowthInside0LastX128', type: 'uint256' },
          { internalType: 'uint256', name: 'feeGrowthInside1LastX128', type: 'uint256' },
          { internalType: 'uint128', name: 'tokensOwed0', type: 'uint128' },
          { internalType: 'uint128', name: 'tokensOwed1', type: 'uint128' },
          { internalType: 'string', name: 'tokenURI', type: 'string' },
        ],
        internalType: 'struct UniswapHelper.PositionWithTokenURI[]',
        name: 'positionsWithTokenURI',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'contract IUniswapV3Pool', name: 'univ3pool', type: 'address' }],
    name: 'getTickNets',
    outputs: [
      { internalType: 'int256[]', name: '', type: 'int256[]' },
      { internalType: 'int256[]', name: '', type: 'int256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'contract IUniswapV3Pool', name: 'univ3pool', type: 'address' },
      { internalType: 'int24', name: 'startTick', type: 'int24' },
      { internalType: 'uint256', name: 'nTicks', type: 'uint256' },
    ],
    name: 'getTickNets',
    outputs: [
      { internalType: 'int256[]', name: '', type: 'int256[]' },
      { internalType: 'int256[]', name: '', type: 'int256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'plotPnL',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    name: 'plotPoolLiquidity',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
