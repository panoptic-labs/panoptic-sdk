import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/abis/panoptic_v2_abis.ts',
  contracts: [],
  plugins: [
    foundry({
      project: '../panoptic-v2-core/',
      forge: { build: false },
      include: [
        'PanopticFactoryV4.sol/**',
        'SemiFungiblePositionManagerV3.sol/**',
        'SemiFungiblePositionManagerV4.sol/**',
        'CollateralTracker.sol/**',
        'PanopticPool.sol/**',
        'RiskEngine.sol/**',
      ],
    }),
    foundry({
      project: '../panoptic-helper/',
      forge: { build: false },
      include: ['PanopticQuery.sol/**'],
    }),
  ],
})
