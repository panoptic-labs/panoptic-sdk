/**
 * The only place that knows RPC vendor URL formats and credentials. Supporting
 * a new vendor means adding one preset here; services select it through env
 * (see `resolveRpcEndpoints`).
 */

export type RpcProviderPreset = {
  /** Env vars holding the API key for `chainId`, highest precedence first. */
  apiKeyEnv: (chainId: number) => readonly string[]
  /** Endpoint for `chainId`, or undefined when the vendor does not serve it. */
  endpoint: (
    chainId: number,
    apiKey: string,
  ) => { url: string; headers?: Record<string, string> } | undefined
}

const alchemyChains = {
  1: 'eth-mainnet',
  137: 'polygon-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  10: 'opt-mainnet',
  130: 'unichain-mainnet',
  4663: 'robinhood-mainnet',
  11155111: 'eth-sepolia',
} as const

export type AlchemyChainId = keyof typeof alchemyChains

function isAlchemyChainId(chainId: number): chainId is AlchemyChainId {
  return chainId in alchemyChains
}

const infuraChains: Record<number, string> = {
  1: 'mainnet',
  10: 'optimism-mainnet',
  137: 'polygon-mainnet',
  8453: 'base-mainnet',
  42161: 'arbitrum-mainnet',
  43114: 'avalanche-mainnet',
  11155111: 'sepolia',
}

export type RpcProviderName = 'alchemy' | 'infura' | 'uniblock'

export const RPC_PROVIDER_PRESETS: Readonly<Record<RpcProviderName, RpcProviderPreset>> = {
  alchemy: {
    apiKeyEnv: () => ['ALCHEMY_API_KEY'],
    endpoint: (chainId, apiKey) =>
      isAlchemyChainId(chainId)
        ? { url: `https://${alchemyChains[chainId]}.g.alchemy.com/v2/${apiKey}` }
        : undefined,
  },
  infura: {
    apiKeyEnv: () => ['INFURA_API_KEY'],
    endpoint: (chainId, apiKey) =>
      infuraChains[chainId]
        ? { url: `https://${infuraChains[chainId]}.infura.io/v3/${apiKey}` }
        : undefined,
  },
  uniblock: {
    apiKeyEnv: () => ['UNIBLOCK_API_KEY'],
    // Uniblock accepts the key only as a header, and serves keyless requests
    // from an anonymous tier — callers must never send it without one.
    endpoint: (chainId, apiKey) => ({
      url: `https://api.uniblock.dev/uni/v1/json-rpc?chainId=${chainId}`,
      headers: { 'x-api-key': apiKey },
    }),
  },
}

export function isRpcProviderName(name: string): name is RpcProviderName {
  return Object.prototype.hasOwnProperty.call(RPC_PROVIDER_PRESETS, name)
}

export function getAlchemyRpcUrl(chainId: AlchemyChainId, alchemyApiKey: string): string {
  if (alchemyChains[chainId]) {
    return `https://${alchemyChains[chainId]}.g.alchemy.com/v2/${alchemyApiKey}`
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }
}

export function getAlchemyWsRpcUrl(chainId: AlchemyChainId, alchemyApiKey: string): string {
  if (alchemyChains[chainId]) {
    return `wss://${alchemyChains[chainId]}.g.alchemy.com/v2/${alchemyApiKey}`
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }
}
