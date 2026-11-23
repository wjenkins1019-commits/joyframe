import type { MetadataRefreshSummary } from '@shared/types'

export interface RefreshReport {
  message: string
  tone: 'success' | 'info' | 'error'
}

/**
 * Turn a bulk refresh summary into a toast that never claims success when the
 * run hit rejected credentials, rate limits, an offline provider or a spent
 * request budget. A plain no-match stays informational rather than an error.
 */
export function describeRefresh(summary: MetadataRefreshSummary): RefreshReport {
  const attempted = summary.updated + summary.failed
  const parts = attempted ? [`Updated ${summary.updated} of ${attempted} games.`] : ['No games were refreshed.']
  if (summary.noMatch) parts.push(`${summary.noMatch} had no match.`)
  if (summary.authFailed) parts.push(`${summary.authFailed} hit rejected credentials — check the API key in Settings.`)
  if (summary.rateLimited) parts.push(`${summary.rateLimited} were rate-limited or ran out of budget — try again later.`)
  if (summary.serverErrors) parts.push(`${summary.serverErrors} hit a provider server error — try again later.`)
  if (summary.offline) parts.push(`${summary.offline} could not reach a provider.`)
  if (summary.skipped) parts.push(`${summary.skipped} skipped after the budget ran out.`)
  const tone: RefreshReport['tone'] =
    summary.authFailed || summary.rateLimited || summary.serverErrors || summary.offline || summary.skipped
      ? 'error'
      : summary.noMatch
        ? 'info'
        : 'success'
  return { message: parts.join(' '), tone }
}
