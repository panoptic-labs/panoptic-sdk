/* Make sure to populate PANOPTIC_V2_PATH in .env before running with a path on your local machine
to Panoptic V2 smart contract forge project.
Also make sure it's built first.
Then, you can generate ABIs for Panoptic V2 with: 
`pnpm --filter @panoptic-eng/sdk exec wagmi generate --config panoptic_v2_wagmi_config.ts`
*/
import { type Config, defineConfig, loadEnv } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig(() => {
  const env = loadEnv({
    mode: process.env.NODE_ENV,
    envDir: process.cwd(),
  })

  return {
    out: 'src/abis/panoptic_v2_abis.ts',
    contracts: [],
    plugins: [
      foundry({
        project: env.PANOPTIC_V2_PATH,
        forge: { build: false },
        include: [
          'PanopticFactoryV4.sol/**',
          'SemiFungiblePositionManagerV4.sol/**',
          'CollateralTracker.sol/**',
          'PanopticHelper.sol/**',
          'PanopticPool.sol/**',
          'RiskEngine.sol/**',
        ],
      }),
    ],
  }
}) as Config
