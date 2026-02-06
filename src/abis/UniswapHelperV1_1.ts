export const UniswapHelperV1_1Abi = [
  {
    inputs: [
      { internalType: 'contract IPoolManager', name: '_V4_POOLM', type: 'address' },
      { internalType: 'contract IPositionManager', name: '_V4_POSM', type: 'address' },
      { internalType: 'contract SemiFungiblePositionManager', name: '_SFPM', type: 'address' },
    ],
    stateMutability: 'payable',
    type: 'constructor',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'currency0', type: 'address' },
          { internalType: 'Currency', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'contract IHooks', name: 'hooks', type: 'address' },
        ],
        internalType: 'struct PoolKey',
        name: 'poolKey',
        type: 'tuple',
      },
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
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'currency0', type: 'address' },
          { internalType: 'Currency', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'contract IHooks', name: 'hooks', type: 'address' },
        ],
        internalType: 'struct PoolKey',
        name: 'poolKey',
        type: 'tuple',
      },
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
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'currency0', type: 'address' },
          { internalType: 'Currency', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'contract IHooks', name: 'hooks', type: 'address' },
        ],
        internalType: 'struct PoolKey',
        name: 'poolKey',
        type: 'tuple',
      },
    ],
    name: 'plotPoolLiquidity',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
