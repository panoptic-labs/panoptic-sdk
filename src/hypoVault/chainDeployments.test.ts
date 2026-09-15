import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  getChainDeployment,
  getEthUsdcMarket,
  isSupportedChain,
  MAINNET_PANOPTIC_V2_ADDRESSES,
  requireChainDeployment,
  ROBINHOOD_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_HYPOVAULT_ADDRESSES,
  SEPOLIA_PANOPTIC_V2_ADDRESSES,
} from './chainDeployments'

describe('chainDeployments', () => {
  it('resolves Robinhood without advertising an undeployed market', () => {
    const deployment = requireChainDeployment(ROBINHOOD_CHAIN_ID)

    expect(isSupportedChain(ROBINHOOD_CHAIN_ID)).toBe(true)
    expect(deployment.panoptic.v2.panopticQuery).toBe('0x0000000000000e1aE9c66C1c3B0A547D23389C93')
    expect(deployment.panoptic.pool.panopticPool).toBe(zeroAddress)
    expect(deployment.hypovault.vaults.usdcPlpVault).toBe(zeroAddress)
    expect(deployment.hypovault.core).toEqual({
      hypoVaultImplementation: '0xF16714665955DBd0361D997eFc50fe391D96E8D0',
      factory: '0xd5049B2647de57141dE7F65E5124707B99A452A3',
      accountant: '0x9e345d862c41010F87D8E5A279e8D320D2831D36',
      rolesAuthority: '0xb952D345c413Ddb7850173422bAe4968e0330598',
      collateralTrackerDecoderAndSanitizer: '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6',
    })
    expect(deployment.subgraphs.hypovault).toContain('/hypovault-subgraph-robinhood/prod/gn')
    expect(deployment.riskEngines).toContain(deployment.panoptic.v2.riskEngine)
    expect(deployment.panoptic.v2).toEqual(MAINNET_PANOPTIC_V2_ADDRESSES)
    expect(() => getEthUsdcMarket(deployment)).toThrow('Missing ETH/USDC market for chainId 4663')
  })

  it('contains required Sepolia deployment fields', () => {
    const deployment = requireChainDeployment(SEPOLIA_CHAIN_ID)

    expect(deployment.hypovault.vaults.usdcPlpVault).toBe(SEPOLIA_HYPOVAULT_ADDRESSES.usdcPlpVault)
    expect(deployment.panoptic.v2.panopticQuery).toBe(SEPOLIA_PANOPTIC_V2_ADDRESSES.panopticQuery)
    expect(deployment.subgraphs.hypovault).toContain('/hypovault-subgraph-sepolia/prod/gn')
    expect(deployment.subgraphs.panoptic).toContain('/panoptic-subgraph-sepolia/v2_prod/gn')
    expect(getEthUsdcMarket(deployment).poolId.startsWith('0x')).toBe(true)
  })

  it('returns undefined for unsupported chains via getChainDeployment', () => {
    expect(getChainDeployment(999999)).toBeUndefined()
  })

  it('throws for unsupported chains via requireChainDeployment', () => {
    expect(() => requireChainDeployment(999999)).toThrow(
      'Unsupported chain deployment for chainId 999999',
    )
  })

  it('reports support status by chain id', () => {
    expect(isSupportedChain(SEPOLIA_CHAIN_ID)).toBe(true)
    expect(isSupportedChain(999999)).toBe(false)
  })
})
