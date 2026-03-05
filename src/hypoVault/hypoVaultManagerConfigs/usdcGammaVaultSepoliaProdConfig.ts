import type { HypoVaultManagerConfig } from './schema'

export const UsdcGammaVaultSepoliaProdConfig: HypoVaultManagerConfig = {
  deployment: 'prod',
  manageCycleIntervalMs: 86400000,
  vaultCapInUnderlying: 1000000000n, // 1,000 USDC
  chainId: 11155111,
  hypoVaultAddress: '0xAed1bBE846605B9913F43C9c884399e3085C33f5',
  addresses: {
    ethUsdc500bpsV4Collateral1: '0xe2BD879109f84313AC986B2390110F5A240a9fa9',
    ethUsdc500bpsV4PanopticPool: '0x5D44F6574B8dE88ffa2CCAEba0B07aD3C204571E',
    hypoVaultManagerWithMerkleVerification: '0x5214b3ee7c7913454a7f53cd9dC813D05D0043Ed',
    hypoVault: '0xAed1bBE846605B9913F43C9c884399e3085C33f5',
    underlyingToken: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
  },
}
