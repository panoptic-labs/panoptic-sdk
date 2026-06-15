import {
  BASE_CHAIN_ID,
  getEthUsdcMarket,
  MAINNET_CHAIN_ID,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
} from '../chainDeployments'

const SEPOLIA_DEPLOYMENT = requireChainDeployment(SEPOLIA_CHAIN_ID)
const BASE_DEPLOYMENT = requireChainDeployment(BASE_CHAIN_ID)
const MAINNET_DEPLOYMENT = requireChainDeployment(MAINNET_CHAIN_ID)

export const MAX_PRICE_DEVIATION = 100 as const
export const DEFAULT_TRIGGER_TICK = 150 as const

export const SEPOLIA_DEFAULT_POOL_INFOS = [
  {
    maxPriceDeviation: MAX_PRICE_DEVIATION,
    pool: SEPOLIA_DEPLOYMENT.panoptic.pool.panopticPool,
    token0: getEthUsdcMarket(SEPOLIA_DEPLOYMENT).currency0,
    token1: getEthUsdcMarket(SEPOLIA_DEPLOYMENT).currency1,
  },
] as const

export const SEPOLIA_VAULT_ADDRESSES = SEPOLIA_DEPLOYMENT.hypovault.vaults

export const BASE_DEFAULT_POOL_INFOS = [
  {
    maxPriceDeviation: MAX_PRICE_DEVIATION,
    pool: BASE_DEPLOYMENT.panoptic.pool.panopticPool,
    token0: getEthUsdcMarket(BASE_DEPLOYMENT).currency0,
    token1: getEthUsdcMarket(BASE_DEPLOYMENT).currency1,
  },
] as const

export const BASE_VAULT_ADDRESSES = BASE_DEPLOYMENT.hypovault.vaults

export const MAINNET_DEFAULT_POOL_INFOS = [
  {
    maxPriceDeviation: MAX_PRICE_DEVIATION,
    pool: MAINNET_DEPLOYMENT.panoptic.pool.panopticPool,
    token0: getEthUsdcMarket(MAINNET_DEPLOYMENT).currency0,
    token1: getEthUsdcMarket(MAINNET_DEPLOYMENT).currency1,
  },
] as const

export const MAINNET_VAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
export { MAINNET_CHAIN_ID }
