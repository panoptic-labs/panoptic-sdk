export const PanopticVaultAccountantManagerInputAbi = [
  {
    type: 'tuple[]',
    components: [
      { name: 'poolPrice', type: 'int24' },
      { name: 'token0Price', type: 'int24' },
      { name: 'token1Price', type: 'int24' },
    ],
  },
  {
    type: 'tuple[]',
    components: [
      { name: 'pool', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'maxPriceDeviation', type: 'int24' },
    ],
  },
  { type: 'uint256[][]' }, // TokenId[][]
] as const
