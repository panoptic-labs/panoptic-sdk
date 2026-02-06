const alchemyChains = {
  1: 'eth-mainnet',
  137: 'polygon-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  10: 'opt-mainnet',
  130: 'unichain-mainnet',
  11155111: 'eth-sepolia',
} as const

export function getAlchemyRpcUrl(
  chainId: keyof typeof alchemyChains,
  alchemyApiKey: string,
): string {
  if (alchemyChains[chainId]) {
    return `https://${alchemyChains[chainId]}.g.alchemy.com/v2/${alchemyApiKey}`
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }
}

export function getAlchemyWsRpcUrl(
  chainId: keyof typeof alchemyChains,
  alchemyApiKey: string,
): string {
  if (alchemyChains[chainId]) {
    return `wss://${alchemyChains[chainId]}.g.alchemy.com/v2/${alchemyApiKey}`
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }
}
