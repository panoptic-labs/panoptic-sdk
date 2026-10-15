import type { HttpTransportConfig } from 'viem'

/** Limits HTTP attempts, including retries, across clients sharing this fetch function. */
export function rateLimitedRpcFetch(
  requestsPerSecond: number,
  fetchFn: NonNullable<HttpTransportConfig['fetchFn']> = fetch,
): NonNullable<HttpTransportConfig['fetchFn']> {
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
    throw new Error('RPC requestsPerSecond must be positive and finite')
  }
  const intervalMs = Math.ceil(1_000 / requestsPerSecond)
  let nextStart = 0
  let tail = Promise.resolve()

  return (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const request = tail.then(async () => {
      signal?.throwIfAborted()
      const delay = nextStart - Date.now()
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
      signal?.throwIfAborted()
      nextStart = Date.now() + intervalMs
      return fetchFn(input, init)
    })
    tail = request.then(
      () => undefined,
      () => undefined,
    )
    return request
  }
}
