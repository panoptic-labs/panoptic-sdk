import type { HypoVaultManagerConfig } from './schema'

export const UsdcPlpVaultSepoliaDevConfig: HypoVaultManagerConfig = {
  deployment: 'dev',
  manageCycleIntervalMs: 10000,
  vaultCapInUnderlying: 1000000000n, // 1,000 USDC
  chainId: 11155111,
  hypoVaultAddress: '0xC4Bcfe746fdAB946Ac79244c5Fd5E4f3c08c9F87',
  addresses: {
    ethUsdc500bpsV4Collateral1: '0xe2BD879109f84313AC986B2390110F5A240a9fa9',
    ethUsdc500bpsV4PanopticPool: '0x5D44F6574B8dE88ffa2CCAEba0B07aD3C204571E',
    hypoVaultManagerWithMerkleVerification: '0x2FDaAeb3401DC87c2A8082Bf42c7ea05856c200b',
    hypoVault: '0xC4Bcfe746fdAB946Ac79244c5Fd5E4f3c08c9F87',
    underlyingToken: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
  },
}
