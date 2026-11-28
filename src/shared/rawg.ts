/**
 * RAWG key-check protocol shared by Settings → Metadata (main process) and
 * scripts/set-rawg-key.mjs.
 *
 * Only the wire contract lives here: the endpoint, the probe query and what
 * counts as an accepted key. The wording of a failure stays with each caller —
 * the Settings check shows user-facing copy and the script prints operator
 * detail with the HTTP status — and so does the transport, because the app
 * retries a rate limit or server error through fetchJson while the script
 * sends one request and reports the answer it got.
 */

export const RAWG_API_BASE = 'https://api.rawg.io/api'

/**
 * The request both key checks send: one game is enough to prove the key works.
 * The key travels only in the URL, never in a log line or a returned value.
 */
export function rawgKeyProbeUrl(key: string): URL {
  const url = new URL(`${RAWG_API_BASE}/games`)
  url.searchParams.set('key', key)
  url.searchParams.set('page_size', '1')
  return url
}

/**
 * A working key gets a JSON body with a results array. Checking the shape also
 * proves RAWG itself answered, rather than a captive portal or proxy page.
 */
export function rawgKeyAccepted(body: unknown): boolean {
  return Array.isArray((body as { results?: unknown } | null)?.results)
}
