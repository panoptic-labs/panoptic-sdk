import { describe, expect, it } from 'vitest'

import { MAINNET_CHAIN_ID } from '../chainDeployments'
import { getVaultPoolInfos } from '../utils/vaultManagerInput'
import { getHypoVaultConfigForVault } from './vaultToConfig'

const MAINNET_PRODUCTION_WETH_VAULT = '0xd4e2c720a760049cc4151bcf61e3a9348db9cd92'
const MAINNET_PRODUCTION_USDC_VAULT = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18'
const MAINNET_LEGACY_WETH_VAULT = '0x779a2aa634A004b3a3f3b322083744869BBC6D66'
const MAINNET_LEGACY_USDC_VAULT = '0x963Fe9c93bc353602656ee4051A75114bA74d6c5'
const MAINNET_SPCX_USDC_PANOPTIC_POOL = '0x0f34e6fCda264349Db10d445BD95f529cbe88090'

describe('getHypoVaultConfigForVault', () => {
  it('resolves mainnet production and legacy HypoVault manager configs', () => {
    const productionWethConfig = getHypoVaultConfigForVault(
      MAINNET_PRODUCTION_WETH_VAULT,
      MAINNET_CHAIN_ID,
    )
    const legacyWethConfig = getHypoVaultConfigForVault(MAINNET_LEGACY_WETH_VAULT, MAINNET_CHAIN_ID)
    const productionUsdcConfig = getHypoVaultConfigForVault(
      MAINNET_PRODUCTION_USDC_VAULT,
      MAINNET_CHAIN_ID,
    )
    const legacyUsdcConfig = getHypoVaultConfigForVault(MAINNET_LEGACY_USDC_VAULT, MAINNET_CHAIN_ID)

    expect(productionWethConfig?.addresses?.hypoVault?.toLowerCase()).toBe(
      MAINNET_PRODUCTION_WETH_VAULT.toLowerCase(),
    )
    expect(legacyWethConfig?.addresses?.hypoVault?.toLowerCase()).toBe(
      MAINNET_LEGACY_WETH_VAULT.toLowerCase(),
    )
    expect(legacyWethConfig?.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0xcc80f113298DdF9D399323D5288aE5Eeaed20D44',
    )
    expect(productionUsdcConfig?.addresses?.hypoVault?.toLowerCase()).toBe(
      MAINNET_PRODUCTION_USDC_VAULT.toLowerCase(),
    )
    expect(legacyUsdcConfig?.addresses?.hypoVault?.toLowerCase()).toBe(
      MAINNET_LEGACY_USDC_VAULT.toLowerCase(),
    )
    expect(legacyUsdcConfig?.addresses?.hypoVaultManagerWithMerkleVerification).toBe(
      '0xf42EED8F0d3326ad59fc1f5d4c4009B5F6B4D87c',
    )
  })

  it('resolves mainnet production and legacy HypoVault pool infos', () => {
    expect(getVaultPoolInfos(MAINNET_PRODUCTION_WETH_VAULT, MAINNET_CHAIN_ID)).toHaveLength(1)
    expect(getVaultPoolInfos(MAINNET_LEGACY_WETH_VAULT, MAINNET_CHAIN_ID)).toHaveLength(1)
    const productionUsdcPoolInfos = getVaultPoolInfos(
      MAINNET_PRODUCTION_USDC_VAULT,
      MAINNET_CHAIN_ID,
    )
    expect(productionUsdcPoolInfos).toHaveLength(2)
    expect(productionUsdcPoolInfos.map((poolInfo) => poolInfo.pool.toLowerCase())).toContain(
      MAINNET_SPCX_USDC_PANOPTIC_POOL.toLowerCase(),
    )
    expect(getVaultPoolInfos(MAINNET_LEGACY_USDC_VAULT, MAINNET_CHAIN_ID)).toHaveLength(1)
  })
})
