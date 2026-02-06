import type { HypoVaultManagerConfig } from './schema'

export const UsdcPlpVaultSepoliaDevConfig: HypoVaultManagerConfig = {
  manageCycleIntervalMs: 10000,
  vaultCapInUnderlying: 100000000000n, // 100,000 USDC
  chainId: 11155111,
  hypoVaultAddress: '0x91760623ce2BBE50001e18F0973Ffe37c0C6b948',
  addresses: {
    wethUsdc500bpsV4Collateral0: '0x244Bf88435Be52e8dFb642a718ef4b6d0A1166BF',
    wethUsdc500bpsV4PanopticPool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
    hypoVaultManagerWithMerkleVerification: '0x7dd0055110306e9D648C56996020425826605cd3',
    hypoVault: '0x91760623ce2BBE50001e18F0973Ffe37c0C6b948',
    underlyingToken: '0xFFFeD8254566B7F800f6D8CDb843ec75AE49B07A',
  },
}
