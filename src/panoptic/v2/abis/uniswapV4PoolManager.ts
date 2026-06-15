/**
 * Minimal Uniswap V4 PoolManager ABI — only the Initialize event,
 * used to resolve a PoolKey from a poolId hash via getLogs.
 */
export const uniswapV4PoolManagerAbi = [
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { indexed: true, internalType: 'PoolId', name: 'id', type: 'bytes32' },
      { indexed: true, internalType: 'Currency', name: 'currency0', type: 'address' },
      { indexed: true, internalType: 'Currency', name: 'currency1', type: 'address' },
      { indexed: false, internalType: 'uint24', name: 'fee', type: 'uint24' },
      { indexed: false, internalType: 'int24', name: 'tickSpacing', type: 'int24' },
      { indexed: false, internalType: 'contract IHooks', name: 'hooks', type: 'address' },
      { indexed: false, internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, internalType: 'int24', name: 'tick', type: 'int24' },
    ],
    anonymous: false,
  },
] as const
