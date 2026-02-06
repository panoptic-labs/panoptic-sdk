import type { HypoVaultManagerConfig } from './schema'

export const WethPlpVaultSepoliaProdConfig: HypoVaultManagerConfig = {
  manageCycleIntervalMs: 86400000,
  vaultCapInUnderlying: 100000000000000000000n,
  chainId: 11155111,
  hypoVaultAddress: '0x69a3Dd63BCB02E89a70630294EDCe0e78377B876',
  addresses: {
    wethUsdc500bpsV4Collateral0: '0x4f29B472bebbFcEEc250a4A5BC33312F00025600',
    wethUsdc500bpsV4PanopticPool: '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78',
    hypoVaultManagerWithMerkleVerification: '0xcCaB9842150F19552B137f4dA28DeEB6101542cF',
    hypoVault: '0x69a3Dd63BCB02E89a70630294EDCe0e78377B876',
    underlyingToken: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  },
}
