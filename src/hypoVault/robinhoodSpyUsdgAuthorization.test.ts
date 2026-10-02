import { describe, expect, it } from 'vitest'

import {
  RobinhoodUSDGPLP5bpsStrategistLeaves,
  RobinhoodUSDGPLP30bpsStrategistLeaves,
} from './hypoVaultManagerArtifacts/RobinhoodUSDGPLPStrategistLeaves'
import {
  RobinhoodUSDGPLP5bpsVaultPoolInfos,
  RobinhoodUSDGPLP30bpsVaultPoolInfos,
} from './hypoVaultManagerArtifacts/RobinhoodUSDGPLPVaultPoolInfos'
import {
  hashRobinhoodSpyUsdgPoolInfos,
  resolveRobinhoodSpyUsdgAuthorizationState,
  ROBINHOOD_USDG_5BPS_POOL_HASH,
  ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
  ROBINHOOD_USDG_30BPS_POOL_HASH,
} from './robinhoodSpyUsdgAuthorization'

describe('Robinhood SPY/USDG authorization generations', () => {
  it('reproduces the deployed and prepared roots and accountant hashes', () => {
    expect(RobinhoodUSDGPLP30bpsStrategistLeaves.metadata.ManageRoot).toBe(
      ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
    )
    expect(hashRobinhoodSpyUsdgPoolInfos(RobinhoodUSDGPLP30bpsVaultPoolInfos.poolInfos)).toBe(
      ROBINHOOD_USDG_30BPS_POOL_HASH,
    )
    expect(hashRobinhoodSpyUsdgPoolInfos(RobinhoodUSDGPLP5bpsVaultPoolInfos.poolInfos)).toBe(
      ROBINHOOD_USDG_5BPS_POOL_HASH,
    )
    expect(RobinhoodUSDGPLP5bpsStrategistLeaves.metadata.ManageRoot).not.toBe(
      ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
    )
  })

  it.each([
    {
      version: '30bps',
      poolHash: ROBINHOOD_USDG_30BPS_POOL_HASH,
      manageRoot: ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
    },
    {
      version: '5bps',
      poolHash: ROBINHOOD_USDG_5BPS_POOL_HASH,
      manageRoot: RobinhoodUSDGPLP5bpsStrategistLeaves.metadata.ManageRoot,
    },
  ] as const)('recognizes the $version generation', ({ version, poolHash, manageRoot }) => {
    expect(
      resolveRobinhoodSpyUsdgAuthorizationState({ blockNumber: 1n, poolHash, manageRoot }).version,
    ).toBe(version)
  })

  it('rejects mixed and unknown states', () => {
    expect(() =>
      resolveRobinhoodSpyUsdgAuthorizationState({
        blockNumber: 1n,
        poolHash: ROBINHOOD_USDG_30BPS_POOL_HASH,
        manageRoot: RobinhoodUSDGPLP5bpsStrategistLeaves.metadata.ManageRoot,
      }),
    ).toThrow('Unsupported or inconsistent')
    expect(() =>
      resolveRobinhoodSpyUsdgAuthorizationState({
        blockNumber: 1n,
        poolHash: ROBINHOOD_USDG_5BPS_POOL_HASH,
        manageRoot: ROBINHOOD_USDG_30BPS_MANAGE_ROOT,
      }),
    ).toThrow('Unsupported or inconsistent')
  })
})
