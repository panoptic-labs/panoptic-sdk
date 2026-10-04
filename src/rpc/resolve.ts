import { type RpcProviderName, isRpcProviderName, RPC_PROVIDER_PRESETS } from './providers'

export type RpcEnv = Readonly<Record<string, string | undefined>>

export type RpcEndpoint = {
  /** Preset name, or `'url'` for an explicit URL entry. */
  source: RpcProviderName | 'url'
  url: string
  /** Credentials that must accompany every request to `url`, and only to `url`. */
  headers: Record<string, string>
}

export type ResolveRpcEndpointsOptions = {
  /** Service-specific URL variables honoured when `RPC_URL_<chainId>` is unset, in order. */
  legacyUrlEnv?: readonly string[]
  /** Presets tried, in order, when no URL is configured. Overridden by `RPC_PROVIDERS`. */
  defaultProviders?: readonly RpcProviderName[]
}

export const DEFAULT_RPC_PROVIDERS: readonly RpcProviderName[] = ['alchemy', 'uniblock']

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function parseHeaders(value: string | undefined, envName: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of splitHeaderPairs(value)) {
    const separator = pair.indexOf(':')
    const name = pair.slice(0, separator).trim()
    if (separator <= 0 || name === '') {
      throw new Error(`${envName} must be "Name: value" pairs separated by ";"`)
    }
    headers[name] = pair.slice(separator + 1).trim()
  }
  return headers
}

function splitHeaderPairs(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function presetApiKey(name: RpcProviderName, chainId: number, env: RpcEnv) {
  for (const envName of RPC_PROVIDER_PRESETS[name].apiKeyEnv(chainId)) {
    const key = present(env[envName])
    if (key !== undefined) return key
  }
  return undefined
}

function presetEndpoint(
  name: RpcProviderName,
  chainId: number,
  env: RpcEnv,
): RpcEndpoint | undefined {
  const apiKey = presetApiKey(name, chainId, env)
  if (apiKey === undefined) return undefined
  const endpoint = RPC_PROVIDER_PRESETS[name].endpoint(chainId, apiKey)
  return endpoint && { source: name, url: endpoint.url, headers: endpoint.headers ?? {} }
}

function explicitEndpoints(chainId: number, env: RpcEnv): RpcEndpoint[] {
  const listEnv = `RPC_URL_${chainId}`
  return splitList(env[listEnv]).map((entry, index) => {
    if (isHttpUrl(entry)) {
      const headersEnv = `RPC_HEADERS_${chainId}_${index}`
      return { source: 'url', url: entry, headers: parseHeaders(env[headersEnv], headersEnv) }
    }
    if (!isRpcProviderName(entry)) {
      throw new Error(`${listEnv} entry "${entry}" is neither an http(s) URL nor a known provider`)
    }
    const endpoint = presetEndpoint(entry, chainId, env)
    if (endpoint === undefined) {
      const keyEnv = RPC_PROVIDER_PRESETS[entry].apiKeyEnv(chainId).join(' or ')
      throw new Error(
        `${listEnv} lists "${entry}", which needs ${keyEnv} and must serve chain ${chainId}`,
      )
    }
    return endpoint
  })
}

function legacyEndpoints(env: RpcEnv, legacyUrlEnv: readonly string[]): RpcEndpoint[] {
  return legacyUrlEnv.flatMap((envName) =>
    splitList(env[envName]).map((url): RpcEndpoint => ({ source: 'url', url, headers: {} })),
  )
}

function firstPresetEndpoint(
  chainId: number,
  env: RpcEnv,
  providers: readonly string[],
): RpcEndpoint | undefined {
  for (const name of providers) {
    if (!isRpcProviderName(name)) {
      throw new Error(`RPC_PROVIDERS entry "${name}" is not a known provider`)
    }
    const endpoint = presetEndpoint(name, chainId, env)
    if (endpoint !== undefined) return endpoint
  }
  return undefined
}

function dedupe(endpoints: RpcEndpoint[]): RpcEndpoint[] {
  const seen = new Set<string>()
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.url}\n${JSON.stringify(endpoint.headers)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Ordered RPC endpoints for `chainId` (primary first, the rest failover):
 *
 * 1. `RPC_URL_<chainId>` — comma-separated URLs and/or preset names; entry `n`
 *    gets headers from `RPC_HEADERS_<chainId>_<n>` ("Name: value;Name: value").
 * 2. Otherwise the service's legacy URL variables (`legacyUrlEnv`).
 * 3. Otherwise the first preset in `RPC_PROVIDERS` (or `defaultProviders`)
 *    that has an API key and serves the chain.
 *
 * Blank values count as unset. Throws when nothing resolves.
 */
export function resolveRpcEndpoints(
  chainId: number,
  env: RpcEnv,
  options: ResolveRpcEndpointsOptions = {},
): RpcEndpoint[] {
  const explicit = explicitEndpoints(chainId, env)
  if (explicit.length > 0) return dedupe(explicit)

  const legacyUrlEnv = options.legacyUrlEnv ?? []
  const legacy = legacyEndpoints(env, legacyUrlEnv)
  if (legacy.length > 0) return dedupe(legacy)

  const providers = present(env.RPC_PROVIDERS)
    ? splitList(env.RPC_PROVIDERS)
    : (options.defaultProviders ?? DEFAULT_RPC_PROVIDERS)
  const preset = firstPresetEndpoint(chainId, env, providers)
  if (preset !== undefined) return [preset]

  const keyEnv = [
    ...new Set(
      providers.flatMap((name) =>
        isRpcProviderName(name) ? RPC_PROVIDER_PRESETS[name].apiKeyEnv(chainId) : [],
      ),
    ),
  ]
  throw new Error(
    `No RPC configured for chain ${chainId}: set ${[`RPC_URL_${chainId}`, ...legacyUrlEnv, ...keyEnv].join(', ')}`,
  )
}
