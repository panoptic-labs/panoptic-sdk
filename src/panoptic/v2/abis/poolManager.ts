/**
 * Uniswap v4 PoolManager event ABI (subset for event watching).
 * @module abis/poolManager
 */

export const poolManagerAbi = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'PoolId', type: 'bytes32', indexed: true },
      { name: 'sender', internalType: 'address', type: 'address', indexed: true },
      { name: 'tickLower', internalType: 'int24', type: 'int24', indexed: false },
      { name: 'tickUpper', internalType: 'int24', type: 'int24', indexed: false },
      { name: 'liquidityDelta', internalType: 'int256', type: 'int256', indexed: false },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32', indexed: false },
    ],
    name: 'ModifyLiquidity',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'PoolId', type: 'bytes32', indexed: true },
      { name: 'sender', internalType: 'address', type: 'address', indexed: true },
      { name: 'amount0', internalType: 'int128', type: 'int128', indexed: false },
      { name: 'amount1', internalType: 'int128', type: 'int128', indexed: false },
      { name: 'sqrtPriceX96', internalType: 'uint160', type: 'uint160', indexed: false },
      { name: 'liquidity', internalType: 'uint128', type: 'uint128', indexed: false },
      { name: 'tick', internalType: 'int24', type: 'int24', indexed: false },
      { name: 'fee', internalType: 'uint24', type: 'uint24', indexed: false },
    ],
    name: 'Swap',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'PoolId', type: 'bytes32', indexed: true },
      { name: 'sender', internalType: 'address', type: 'address', indexed: true },
      { name: 'amount0', internalType: 'uint256', type: 'uint256', indexed: false },
      { name: 'amount1', internalType: 'uint256', type: 'uint256', indexed: false },
    ],
    name: 'Donate',
  },
] as const
