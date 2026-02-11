import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: '../../../panoptic-next-core-private-post-vuln/',
      include: [
        'PanopticPool.sol/PanopticPool.json',
        'RiskEngine.sol/RiskEngine.json',
        'CollateralTracker.sol/CollateralTracker.json',
        'PanopticFactoryV4.sol/PanopticFactory.json',
        'SemiFungiblePositionManagerV4.sol/SemiFungiblePositionManager.json',
      ],
      exclude: [
        'contracts/**',
        'SemiFungiblePositionManager.sol/**',
        'PanopticFactory.sol/**',
        '**.t.sol/**',
        'test_periphery/**',
      ],
    }),
    foundry({
      project: '../../../panoptic-helper/',
      include: ['PanopticQuery.sol/PanopticQuery.json'],
      exclude: ['src/**'],
    }),
  ],
})
