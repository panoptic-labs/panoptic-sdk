import { type HttpTransportConfig, type Transport, fallback, http } from 'viem'

import type { RpcEndpoint } from './resolve'

export type RpcHttpConfig = Omit<HttpTransportConfig, 'fetchOptions'>

/** viem HTTP transport for one endpoint, carrying its credential headers. */
export function rpcHttp(endpoint: RpcEndpoint, config: RpcHttpConfig = {}) {
  return http(endpoint.url, { ...config, fetchOptions: { headers: endpoint.headers } })
}

export type RpcTransportOptions = RpcHttpConfig & {
  /**
   * Fail over to later endpoints. Disable for clients that submit
   * transactions: a tx broadcast through one provider and retried through
   * another surfaces as "already known" / "nonce too low" although it was sent.
   */
  failover?: boolean
}

/**
 * Transport over resolved endpoints: plain HTTP for one endpoint, otherwise an
 * unranked viem `fallback` in configured order.
 */
export function rpcTransport(
  endpoints: readonly RpcEndpoint[],
  { failover = true, ...config }: RpcTransportOptions = {},
): Transport {
  const [primary, ...rest] = endpoints
  if (primary === undefined) throw new Error('rpcTransport needs at least one endpoint')
  if (!failover || rest.length === 0) return rpcHttp(primary, config)
  return fallback(
    endpoints.map((endpoint) => rpcHttp(endpoint, config)),
    { rank: false },
  )
}

/** anvil fork arguments for the primary endpoint (`--fork-header` only when it needs one). */
export function rpcForkArgs(endpoints: readonly RpcEndpoint[]): {
  forkUrl: string
  forkHeader?: string
} {
  const [primary] = endpoints
  if (primary === undefined) throw new Error('rpcForkArgs needs at least one endpoint')
  const headers = Object.entries(primary.headers)
  if (headers.length === 0) return { forkUrl: primary.url }
  if (headers.length > 1) throw new Error('anvil --fork-header supports one header per fork')
  const [[name, value]] = headers
  return { forkUrl: primary.url, forkHeader: `${name}: ${value}` }
}

/**
 * Value for a Ponder chain's `rpc`. Header-free endpoints stay plain URLs so
 * Ponder keeps its own load balancing; credential headers need a transport.
 */
export function ponderRpc(endpoints: readonly RpcEndpoint[]): string | string[] | Transport {
  if (endpoints.some((endpoint) => Object.keys(endpoint.headers).length > 0)) {
    return rpcTransport(endpoints)
  }
  const urls = endpoints.map((endpoint) => endpoint.url)
  return urls.length === 1 ? urls[0] : urls
}
