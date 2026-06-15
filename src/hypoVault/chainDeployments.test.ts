import { describe, expect, it } from 'vitest'

import {
  getChainDeployment,
  getEthUsdcMarket,
  isSupportedChain,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_HYPOVAULT_ADDRESSES,
  SEPOLIA_PANOPTIC_V2_ADDRESSES,
} from './chainDeployments'

describe('chainDeployments', () => {
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
