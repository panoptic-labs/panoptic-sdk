import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: '../panoptic-v2-core/',
      forge: { build: false },
      include: [
        'PanopticPool.sol/PanopticPoolV2.json',
        'RiskEngine.sol/RiskEngine.json',
        'CollateralTracker.sol/CollateralTrackerV2.json',
        'PanopticFactoryV3.sol/PanopticFactoryV3.json',
        'PanopticFactoryV4.sol/PanopticFactoryV4.json',
        'SemiFungiblePositionManagerV3.sol/SemiFungiblePositionManagerV3.json',
        'SemiFungiblePositionManagerV4.sol/SemiFungiblePositionManagerV4.json',
      ],
      exclude: ['**.t.sol/**'],
    }),
    foundry({
      project: '../panoptic-helper/',
      forge: { build: false },
      include: ['PanopticQuery.sol/PanopticQuery.json'],
      exclude: ['src/**'],
    }),
  ],
})
