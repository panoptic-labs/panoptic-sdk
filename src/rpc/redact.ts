const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>)]+/giu
// Unquoted authentication values can contain commas and quotes, so mask through the line boundary.
const CREDENTIAL_HEADER_PATTERN =
  /\b(x-api-key|authorization|proxy-authorization)(["']?\s*[:=]\s*)(?:(["'])(?:\\.|(?!\3)[^\\\r\n])*\3|[^\r\n]+)/giu

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const port = url.port ? `:${url.port}` : ''
    return `${url.protocol}//${url.hostname}${port}/<redacted>`
  } catch {
    return '<redacted-url>'
  }
}

/**
 * Strip RPC credentials from text before it is logged or shown. Providers
 * embed keys in the URL path or query, so every URL keeps only its origin;
 * credential header values are masked too.
 */
export function redactRpcSecrets(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(CREDENTIAL_HEADER_PATTERN, '$1$2$3<redacted>$3')
    .replace(URL_PATTERN, redactUrl)
}
