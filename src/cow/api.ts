/**
 * Minimal fetch wrapper for the CoW order-book REST API.
 * @module cow/api
 */

import { COW_API_URLS } from './addresses'
import { CowApiError, CowOrderTooSmallError, CowUnsupportedChainError } from './errors'

/** Resolve the order-book base URL for a chain (override wins). */
export function resolveCowApiUrl(chainId: bigint, apiUrl?: string): string {
  const url = apiUrl ?? COW_API_URLS[Number(chainId)]
  if (!url) throw new CowUnsupportedChainError(chainId)
  return url
}

/** Shape of order-book error payloads. */
interface CowApiErrorBody {
  errorType?: string
  description?: string
}

/**
 * Call the order book and parse JSON, mapping non-2xx responses to
 * {@link CowApiError} (dust orders to {@link CowOrderTooSmallError}).
 */
export async function cowApiRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  // Normalize headers so a Headers instance / tuple array passed by the caller
  // is preserved (a spread would drop those), only defaulting Content-Type.
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}/api/v1${path}`, { ...init, headers })

  if (!response.ok) {
    let body: CowApiErrorBody = {}
    try {
      body = (await response.json()) as CowApiErrorBody
    } catch {
      // Non-JSON error body — fall through with the status text.
    }
    const errorType = body.errorType ?? 'UnknownError'
    const message = body.description ?? `CoW API request failed (${response.status})`
    if (errorType === 'SellAmountDoesNotCoverFee') {
      throw new CowOrderTooSmallError(message, response.status)
    }
    throw new CowApiError(errorType, message, response.status)
  }

  // Tolerate empty / non-JSON success bodies (e.g. DELETE /orders for a
  // cancellation, which callers type as void): return undefined rather than
  // throwing inside response.json().
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (text === '') return undefined as T
  return JSON.parse(text) as T
}
