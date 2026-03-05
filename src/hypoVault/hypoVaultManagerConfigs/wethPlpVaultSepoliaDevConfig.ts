import type { HypoVaultManagerConfig } from './schema'

export const WethPlpVaultSepoliaDevConfig: HypoVaultManagerConfig = {
  deployment: 'dev',
  manageCycleIntervalMs: 10000,
  vaultCapInUnderlying: 1000000000000000000n, // 1 WETH
  chainId: 11155111,
  hypoVaultAddress: '0x225Bf020d280E98C3037fb3c5aa291De6F618834',
  addresses: {
    ethUsdc500bpsV4Collateral0: '0x4d2579A5F9BC32641D6AdbFC47C6dAceF30027F1',
    ethUsdc500bpsV4PanopticPool: '0x5D44F6574B8dE88ffa2CCAEba0B07aD3C204571E',
    hypoVaultManagerWithMerkleVerification: '0xe675A002d7f8C9476Ebf3706550b80221BA2AE5E',
    hypoVault: '0x225Bf020d280E98C3037fb3c5aa291De6F618834',
    underlyingToken: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  },
}
