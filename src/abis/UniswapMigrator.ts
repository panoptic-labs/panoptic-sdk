export const UniswapMigratorAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_NFPM',
        type: 'address',
        internalType: 'contract INonfungiblePositionManager',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'migrate',
    inputs: [
      { name: 'tokenIds', type: 'uint256[]', internalType: 'uint256[]' },
      { name: 'amountMins', type: 'uint256[2][]', internalType: 'uint256[2][]' },
      { name: 'ct0', type: 'address', internalType: 'contract CollateralTracker' },
      { name: 'ct1', type: 'address', internalType: 'contract CollateralTracker' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  { type: 'error', name: 'UnauthorizedMigration', inputs: [] },
] as const
