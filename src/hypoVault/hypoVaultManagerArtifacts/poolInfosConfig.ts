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
export const WSPCXX_USDC_MAX_PRICE_DEVIATION = 10000 as const
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

export const MAINNET_USDC_PLP_POOL_INFOS = [
  ...MAINNET_DEFAULT_POOL_INFOS,
  {
    maxPriceDeviation: WSPCXX_USDC_MAX_PRICE_DEVIATION,
    pool: '0x0f34e6fCda264349Db10d445BD95f529cbe88090',
    token0: '0x8e2eeD8b8B5E13Ea7BF38e50d7821d2C57309072',
    token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
] as const

export const MAINNET_LEGACY_DEFAULT_POOL_INFOS = [
  {
    maxPriceDeviation: MAX_PRICE_DEVIATION,
    pool: '0x000000007588B488d180899cDEa2080a886D2441',
    token0: getEthUsdcMarket(MAINNET_DEPLOYMENT).currency0,
    token1: getEthUsdcMarket(MAINNET_DEPLOYMENT).currency1,
  },
] as const

export const MAINNET_VAULT_ADDRESSES = MAINNET_DEPLOYMENT.hypovault.vaults
export const MAINNET_LEGACY_VAULT_ADDRESSES = {
  wethPlpVault: '0x779a2aa634A004b3a3f3b322083744869BBC6D66',
  usdcPlpVault: '0x963Fe9c93bc353602656ee4051A75114bA74d6c5',
} as const
export { MAINNET_CHAIN_ID }
