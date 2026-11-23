import type {
  AppSettings,
  ArtworkCandidate,
  Game,
  MetadataFailureReason,
  MetadataRefreshSummary,
  MetadataResult,
  ProviderStatus,
  Screenshot
} from '../../shared/types.ts'
import { cacheImage, copyLocalArtwork, artUrlFor } from './artwork.ts'
import type { Db } from './db.ts'
import { getGame, nowIso, updateGameRecord } from './repo.ts'
import { steamArtworkUrls } from './steam.ts'

export interface MetadataDeps {
  db: Db
  settings: AppSettings
  artworkDir: string
  /** false keeps remote URLs so the library stores no cover files of its own. */
  cacheArtwork: boolean
  /** Shared by one bulk refresh so a run cannot exceed its request allowance. */
  budget?: RequestBudget
}

const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

export type MetadataProviderId = 'steam' | 'rawg' | 'igdb'

/** Per-provider request allowance for one "refresh all" run. */
export const DEFAULT_REQUEST_BUDGET: Record<MetadataProviderId, number> = {
  steam: 60,
  rawg: 40,
  igdb: 40
}

export interface RequestBudget {
  /** Counts one request against the provider, or refuses it at the cap. */
  take(provider: MetadataProviderId): boolean
  /** True once every provider in this run has spent its allowance. */
  exhausted(providers: MetadataProviderId[]): boolean
}

export function createRequestBudget(
  limits: Partial<Record<MetadataProviderId, number>> = {}
): RequestBudget {
  const caps = { ...DEFAULT_REQUEST_BUDGET, ...limits }
  const spent: Record<MetadataProviderId, number> = { steam: 0, rawg: 0, igdb: 0 }
  return {
    take(provider) {
      if (spent[provider] >= caps[provider]) return false
      spent[provider] += 1
      return true
    },
    exhausted(providers) {
      return providers.every((provider) => spent[provider] >= caps[provider])
    }
  }
}

const RETRY_WAIT_MS = 1500
const MAX_RETRY_WAIT_MS = 5000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** HTTP status -> the reason a bulk refresh should report. */
export function reasonForStatus(status: number): MetadataFailureReason {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429 || status >= 500) return 'rate-limit'
  return 'no-match'
}

export function failureMessage(provider: MetadataProviderId, reason: MetadataFailureReason): string {
  const name = provider === 'rawg' ? 'RAWG' : provider === 'igdb' ? 'IGDB' : 'Steam Store'
  switch (reason) {
    case 'auth':
      return `${name} rejected the credentials. Check the API key in Settings.`
    case 'rate-limit':
      return `${name} rate-limited the request. Try again in a few minutes.`
    case 'budget':
      return `The ${name} request budget for this refresh ran out.`
    case 'offline':
      return `${name} could not be reached. Check your connection and try again.`
    default:
      return `${name} had no match for this game.`
  }
}

/** Providers send Retry-After as delta-seconds; anything else waits the default. */
function retryDelay(response: Response): number {
  const header = response.headers.get('retry-after')
  const seconds = header ? Number(header) : Number.NaN
  if (!Number.isFinite(seconds)) return RETRY_WAIT_MS
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(500, seconds * 1000))
}

type FetchOutcome<T> = { data: T } | { reason: MetadataFailureReason }

/**
 * One provider request that respects the run's request budget, retries once
 * after a rate limit or server error (honouring Retry-After), and reports why
 * it failed so a bulk refresh can tell a rejected key, throttling and a plain
 * no-match apart. Budget is spent per attempt, so a retry cannot exceed the cap.
 */
export async function fetchJson<T>(
  deps: MetadataDeps,
  provider: MetadataProviderId,
  url: string | URL,
  init: RequestInit = {}
): Promise<FetchOutcome<T>> {
  let reason: MetadataFailureReason = 'offline'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (deps.budget && !deps.budget.take(provider)) return { reason: 'budget' }
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    } catch {
      reason = 'offline'
      if (attempt === 0) {
        await sleep(RETRY_WAIT_MS)
        continue
      }
      return { reason }
    }
    if (response.ok) {
      try {
        return { data: (await response.json()) as T }
      } catch {
        return { reason: 'offline' }
      }
    }
    reason = reasonForStatus(response.status)
    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt === 0) {
      await sleep(retryDelay(response))
      continue
    }
    return { reason }
  }
  return { reason }
}

/**
 * Resolve artwork according to the storage preference: either download it into
 * the local cache (offline browsing) or keep the provider URL (nothing stored).
 */
async function artFor(deps: MetadataDeps, url: string, base: string): Promise<string> {
  if (!url) return ''
  if (!deps.cacheArtwork) return url
  return cacheImage(deps.artworkDir, url, base)
}

export function providerStatuses(settings: AppSettings): ProviderStatus[] {
  return [
    {
      id: 'steam',
      name: 'Steam Store',
      enabled: true,
      requiresKey: false,
      keyConfigured: true,
      note: 'Keyless public metadata and artwork for Steam titles, including trailers and screenshots.'
    },
    {
      id: 'igdb',
      name: 'IGDB (Twitch)',
      enabled: Boolean(settings.igdbClientId && settings.igdbClientSecret),
      requiresKey: true,
      keyConfigured: Boolean(settings.igdbClientId && settings.igdbClientSecret),
      note: 'Add an IGDB client ID and secret in Settings to enrich non-Steam and retro games.'
    },
    {
      id: 'rawg',
      name: 'RAWG',
      enabled: Boolean(settings.rawgApiKey),
      requiresKey: true,
      keyConfigured: Boolean(settings.rawgApiKey),
      note: 'Add your free RAWG API key in Settings to fill descriptions, genres, developers and art for non-Steam games.'
    },
    {
      id: 'screenscraper',
      name: 'ScreenScraper',
      enabled: false,
      requiresKey: true,
      keyConfigured: false,
      note: 'ScreenScraper requires developer API credentials issued by the project. Not enabled in this build.'
    },
    {
      id: 'local',
      name: 'Local artwork',
      enabled: true,
      requiresKey: false,
      keyConfigured: true,
      note: 'Import your own covers, backgrounds and logos from disk at any time.'
    }
  ]
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface SteamAppDetails {
  name?: string
  detailed_description?: string
  short_description?: string
  developers?: string[]
  publishers?: string[]
  genres?: { description: string }[]
  release_date?: { date?: string }
  header_image?: string
  background_raw?: string
  screenshots?: { path_thumbnail: string; path_full: string }[]
  movies?: {
    name?: string
    mp4?: Record<string, string>
    webm?: Record<string, string>
    /** Steam's current trailer format; legacy mp4/webm fields are often absent. */
    hls_h264?: string
    dash_h264?: string
  }[]
  metacritic?: { score?: number }
  categories?: { description: string }[]
}

async function fetchSteamDetails(
  deps: MetadataDeps,
  appid: string
): Promise<{ details: SteamAppDetails } | { reason: MetadataFailureReason }> {
  const outcome = await fetchJson<Record<string, { success: boolean; data?: SteamAppDetails }>>(
    deps,
    'steam',
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
    { headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' } }
  )
  // Steam has no credentials of its own, so a 401/403 here is a lookup refusal
  // rather than a key problem; report it as no match for this App ID.
  if ('reason' in outcome) return { reason: outcome.reason === 'auth' ? 'no-match' : outcome.reason }
  const entry = outcome.data[appid]
  if (!entry?.success || !entry.data) return { reason: 'no-match' }
  return { details: entry.data }
}

interface SteamStoreItem {
  id?: number
  name?: string
}

/**
 * Pick the App ID a store search result matches. Exported so the smoke test can
 * verify the matching rules without network access. Only an exact or contained
 * title match is trusted: a loose word overlap can resolve a GOG/Epic title to
 * an unrelated Steam app, which is worse than no match at all.
 */
export function steamStoreMatch(title: string, items: SteamStoreItem[]): string {
  const best = items
    .filter((item) => typeof item.id === 'number' && typeof item.name === 'string' && item.name)
    .map((item) => ({ item, score: titleScore(title, item.name as string) }))
    .sort((a, b) => b.score - a.score)[0]
  if (!best || best.score < 0.8) return ''
  return String(best.item.id)
}

/**
 * Keyless title -> App ID resolution through the public store search, so titles
 * added from GOG, Epic or itch can reuse the Steam Store enrichment.
 */
async function searchSteamAppId(
  deps: MetadataDeps,
  title: string
): Promise<{ appid: string } | { reason: MetadataFailureReason }> {
  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', title)
  url.searchParams.set('l', 'english')
  url.searchParams.set('cc', 'US')
  const outcome = await fetchJson<{ items?: SteamStoreItem[] }>(deps, 'steam', url, {
    headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' }
  })
  if ('reason' in outcome) return { reason: outcome.reason }
  const appid = steamStoreMatch(title, outcome.data.items ?? [])
  return appid ? { appid } : { reason: 'no-match' }
}

/**
 * Steam often ships a detailed description that is nothing but image and video
 * embeds, leaving a short heading once tags are stripped. Prefer whichever
 * field yields more readable text. Exported for the smoke test.
 */
export function bestSteamDescription(detailedHtml: string, shortHtml: string): string {
  const detailed = stripHtml(detailedHtml || '')
  const short = stripHtml(shortHtml || '')
  return short.length > detailed.length ? short : detailed
}

async function enrichFromSteam(
  deps: MetadataDeps,
  game: Game,
  force: boolean,
  appidOverride = ''
): Promise<MetadataResult> {
  const appid = appidOverride || game.sourceId
  if (!appid || !/^\d+$/.test(appid)) {
    return { ok: false, provider: 'steam', confidence: 0, message: 'This game has no Steam App ID to look up.' }
  }
  if (!force && game.metadataConfidence >= 0.9 && game.description) {
    return { ok: true, provider: 'steam', confidence: game.metadataConfidence, message: 'Metadata already cached.' }
  }
  const fetched = await fetchSteamDetails(deps, appid)
  if ('reason' in fetched) {
    return {
      ok: false,
      provider: 'steam',
      confidence: 0,
      reason: fetched.reason,
      message: failureMessage('steam', fetched.reason)
    }
  }
  const details = fetched.details

  const art = steamArtworkUrls(appid)
  const base = `steam-${appid}`
  const [cover, background, logo] = await Promise.all([
    artFor(deps, art.cover, `${base}-cover`),
    artFor(deps, details.background_raw ?? art.background, `${base}-hero`),
    artFor(deps, art.logo, `${base}-logo`)
  ])

  const screenshots: Screenshot[] = []
  for (const [index, shot] of (details.screenshots ?? []).slice(0, 6).entries()) {
    const local = await artFor(deps, shot.path_full, `${base}-shot-${index}`)
    screenshots.push({ thumb: shot.path_thumbnail, full: shot.path_full, local: local || undefined })
  }

  const movie = details.movies?.[0]
  // Prefer progressive files when Steam still provides them; current payloads
  // only carry an HLS manifest, which the renderer plays through hls.js. DASH is
  // skipped because nothing here can play it.
  const videoUrl =
    movie?.mp4?.max ??
    movie?.mp4?.['480'] ??
    movie?.webm?.max ??
    movie?.webm?.['480'] ??
    movie?.hls_h264 ??
    ''
  const yearMatch = details.release_date?.date?.match(/\b(19|20)\d{2}\b/)
  const genres = (details.genres ?? []).map((g) => g.description)

  const patch: Partial<Game> = {
    title: details.name || game.title,
    description:
      bestSteamDescription(details.detailed_description || '', details.short_description || '') || game.description,
    developer: (details.developers ?? []).join(', ') || game.developer,
    publisher: (details.publishers ?? []).join(', ') || game.publisher,
    genres: genres.length ? genres : game.genres,
    releaseDate: details.release_date?.date || game.releaseDate,
    releaseYear: yearMatch ? Number(yearMatch[0]) : game.releaseYear,
    coverPath: cover || art.cover,
    backgroundPath: background || details.header_image || art.background,
    logoPath: logo || art.logo,
    heroUrl: details.header_image ?? game.heroUrl,
    screenshots: screenshots.length ? screenshots : game.screenshots,
    videoUrl: videoUrl || game.videoUrl,
    videoName: movie?.name || game.videoName,
    rating: details.metacritic?.score ?? game.rating,
    metadataProvider: 'steam',
    metadataConfidence: 0.95,
    extra: {
      ...game.extra,
      // Remember a store-search resolution so later refreshes skip the lookup.
      ...(appidOverride ? { steamAppId: appid } : {}),
      metadataUpdatedAt: nowIso()
    }
  }

  const updated = updateGameRecord(deps.db, game.id, patch)
  return {
    ok: true,
    provider: 'steam',
    confidence: 0.95,
    message: `Updated ${updated.title} with Steam Store metadata.`,
    game: updated,
    candidates: artworkCandidates(updated, appid)
  }
}

/* ------------------------------- RAWG ------------------------------- */

const RAWG_BASE = 'https://api.rawg.io/api'

export interface RawgGame {
  id: number
  slug?: string
  name: string
  description_raw?: string
  description?: string
  released?: string | null
  background_image?: string | null
  background_image_additional?: string | null
  genres?: { name: string }[]
  developers?: { name: string }[]
  publishers?: { name: string }[]
  metacritic?: number | null
}

async function rawgGet<T>(
  deps: MetadataDeps,
  route: string,
  params: Record<string, string> = {}
): Promise<FetchOutcome<T>> {
  const url = new URL(`${RAWG_BASE}${route}`)
  url.searchParams.set('key', deps.settings.rawgApiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return fetchJson<T>(deps, 'rawg', url, {
    headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' }
  })
}

/**
 * Map a RAWG record onto library fields. Exported so the smoke test can verify
 * the mapping without network access. RAWG has no portrait box art, so its main
 * artwork doubles as the cover when the game has none yet.
 */
export function rawgGamePatch(
  entry: RawgGame,
  game: Game,
  art: { cover: string; background: string },
  screenshots: Screenshot[],
  confidence: number
): Partial<Game> {
  const yearMatch = entry.released?.match(/^\d{4}/)
  const genres = (entry.genres ?? []).map((genre) => genre.name)
  const description = entry.description_raw || stripHtml(entry.description || '')
  return {
    description: description || game.description,
    developer: (entry.developers ?? []).map((company) => company.name).join(', ') || game.developer,
    publisher: (entry.publishers ?? []).map((company) => company.name).join(', ') || game.publisher,
    genres: genres.length ? genres : game.genres,
    releaseDate: entry.released || game.releaseDate,
    releaseYear: yearMatch ? Number(yearMatch[0]) : game.releaseYear,
    coverPath: art.cover || game.coverPath,
    backgroundPath: art.background || game.backgroundPath,
    screenshots: screenshots.length ? screenshots : game.screenshots,
    rating: typeof entry.metacritic === 'number' ? entry.metacritic : game.rating,
    metadataProvider: 'rawg',
    metadataConfidence: confidence,
    extra: { ...game.extra, metadataUpdatedAt: nowIso() }
  }
}

async function enrichFromRawg(deps: MetadataDeps, game: Game): Promise<MetadataResult> {
  const { settings } = deps
  if (!settings.rawgApiKey) {
    return {
      ok: false,
      provider: 'rawg',
      confidence: 0,
      reason: 'auth',
      message: 'RAWG API key is not configured. Add your free key in Settings.'
    }
  }

  const search = await rawgGet<{ results?: RawgGame[] }>(deps, '/games', {
    search: game.title,
    page_size: '5'
  })
  if ('reason' in search) {
    return {
      ok: false,
      provider: 'rawg',
      confidence: 0,
      reason: search.reason,
      message: failureMessage('rawg', search.reason)
    }
  }
  const results = search.data.results ?? []
  if (!results.length) {
    return {
      ok: false,
      provider: 'rawg',
      confidence: 0,
      reason: 'no-match',
      message: failureMessage('rawg', 'no-match')
    }
  }
  const best = results
    .map((entry) => ({ entry, score: titleScore(game.title, entry.name) }))
    .sort((a, b) => b.score - a.score)[0]
  if (best.score <= 0) {
    return {
      ok: false,
      provider: 'rawg',
      confidence: 0,
      reason: 'no-match',
      message: failureMessage('rawg', 'no-match')
    }
  }

  // The detail call adds descriptions, companies and the extra hero artwork;
  // if it fails the search result still carries enough to fill the basics.
  const detailOutcome = await rawgGet<RawgGame>(deps, `/games/${best.entry.id}`)
  const detail = 'data' in detailOutcome ? detailOutcome.data : best.entry
  const shotOutcome = await rawgGet<{ results?: { image: string }[] }>(
    deps,
    `/games/${best.entry.id}/screenshots`,
    { page_size: '6' }
  )
  const shots = 'data' in shotOutcome ? shotOutcome.data.results ?? [] : []

  const base = `rawg-${detail.id}`
  const backgroundSource = detail.background_image_additional || detail.background_image || ''
  const [cover, background] = await Promise.all([
    artFor(deps, detail.background_image || backgroundSource, `${base}-cover`),
    artFor(deps, backgroundSource, `${base}-hero`)
  ])

  const screenshots: Screenshot[] = []
  for (const [index, shot] of shots.slice(0, 6).entries()) {
    const local = await artFor(deps, shot.image, `${base}-shot-${index}`)
    screenshots.push({ thumb: shot.image, full: shot.image, local: local || undefined })
  }

  const confidence = Math.min(0.9, best.score)
  const patch = rawgGamePatch(detail, game, { cover, background }, screenshots, confidence)
  const updated = updateGameRecord(deps.db, game.id, patch)
  return {
    ok: true,
    provider: 'rawg',
    confidence,
    message: `Matched "${detail.name}" on RAWG with ${Math.round(confidence * 100)}% confidence.`,
    game: updated,
    candidates: artworkCandidates(updated)
  }
}

/* ------------------------------- IGDB ------------------------------- */

const tokenCache = new Map<string, { token: string; expires: number }>()

async function igdbToken(
  deps: MetadataDeps
): Promise<{ token: string } | { reason: MetadataFailureReason }> {
  const { settings } = deps
  const key = `${settings.igdbClientId}:${settings.igdbClientSecret}`
  const cached = tokenCache.get(key)
  if (cached && cached.expires > Date.now() + 60_000) return { token: cached.token }
  const url = new URL('https://id.twitch.tv/oauth2/token')
  url.searchParams.set('client_id', settings.igdbClientId)
  url.searchParams.set('client_secret', settings.igdbClientSecret)
  url.searchParams.set('grant_type', 'client_credentials')
  const outcome = await fetchJson<{ access_token: string; expires_in: number }>(deps, 'igdb', url, {
    method: 'POST'
  })
  if ('reason' in outcome) {
    // Twitch reports an invalid client as a 400, so anything that is not a
    // transport or throttling problem here means the credentials were refused.
    const reason =
      outcome.reason === 'rate-limit' || outcome.reason === 'offline' || outcome.reason === 'budget'
        ? outcome.reason
        : 'auth'
    return { reason }
  }
  tokenCache.set(key, {
    token: outcome.data.access_token,
    expires: Date.now() + outcome.data.expires_in * 1000
  })
  return { token: outcome.data.access_token }
}

interface IgdbGame {
  id: number
  name: string
  summary?: string
  first_release_date?: number
  rating?: number
  genres?: { name: string }[]
  cover?: { url: string }
  artworks?: { url: string }[]
  screenshots?: { url: string }[]
  involved_companies?: { developer: boolean; publisher: boolean; company: { name: string } }[]
  platforms?: { name: string }[]
}

function igdbImage(url: string, size: 'cover_big' | '1080p' | 'screenshot_huge'): string {
  const normalized = url.startsWith('//') ? `https:${url}` : url
  return normalized.replace(/t_(thumb|cover_small|micro|720p|screenshot_med)/, `t_${size}`)
}

function titleScore(a: string, b: string): number {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const left = norm(a)
  const right = norm(b)
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.8
  const leftWords = new Set(left.split(' '))
  const rightWords = right.split(' ')
  const overlap = rightWords.filter((w) => leftWords.has(w)).length
  return overlap / Math.max(leftWords.size, 1) / 2
}

async function enrichFromIgdb(deps: MetadataDeps, game: Game): Promise<MetadataResult> {
  const { settings } = deps
  if (!settings.igdbClientId || !settings.igdbClientSecret) {
    return {
      ok: false,
      provider: 'igdb',
      confidence: 0,
      message: 'IGDB credentials are not configured. Add a client ID and secret in Settings.'
    }
  }
  const tokenized = await igdbToken(deps)
  if ('reason' in tokenized) {
    return {
      ok: false,
      provider: 'igdb',
      confidence: 0,
      reason: tokenized.reason,
      message: failureMessage('igdb', tokenized.reason)
    }
  }
  const token = tokenized.token

  const query = `search "${game.title.replace(/["\\]/g, ' ')}";
    fields name,summary,first_release_date,rating,genres.name,cover.url,artworks.url,screenshots.url,
      involved_companies.developer,involved_companies.publisher,involved_companies.company.name,platforms.name;
    limit 6;`
  try {
    const outcome = await fetchJson<IgdbGame[]>(deps, 'igdb', 'https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': settings.igdbClientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain'
      },
      body: query
    })
    if ('reason' in outcome) {
      return {
        ok: false,
        provider: 'igdb',
        confidence: 0,
        reason: outcome.reason,
        message: failureMessage('igdb', outcome.reason)
      }
    }
    const results = outcome.data
    if (!results.length) {
      return {
        ok: false,
        provider: 'igdb',
        confidence: 0,
        reason: 'no-match',
        message: failureMessage('igdb', 'no-match')
      }
    }
    const best = results
      .map((entry) => ({ entry, score: titleScore(game.title, entry.name) }))
      .sort((a, b) => b.score - a.score)[0]

    const entry = best.entry
    const base = `igdb-${entry.id}`
    const cover = entry.cover ? await artFor(deps, igdbImage(entry.cover.url, 'cover_big'), `${base}-cover`) : ''
    const backgroundSource =
      entry.artworks?.[0]?.url ?? entry.screenshots?.[0]?.url ?? entry.cover?.url ?? ''
    const background = backgroundSource
      ? await artFor(deps, igdbImage(backgroundSource, '1080p'), `${base}-hero`)
      : ''

    const screenshots: Screenshot[] = []
    for (const [index, shot] of (entry.screenshots ?? []).slice(0, 6).entries()) {
      const remote = igdbImage(shot.url, 'screenshot_huge')
      const local = await artFor(deps, remote, `${base}-shot-${index}`)
      screenshots.push({ full: remote, local: local || undefined })
    }

    const developer = (entry.involved_companies ?? [])
      .filter((c) => c.developer)
      .map((c) => c.company.name)
      .join(', ')
    const publisher = (entry.involved_companies ?? [])
      .filter((c) => c.publisher)
      .map((c) => c.company.name)
      .join(', ')
    const year = entry.first_release_date ? new Date(entry.first_release_date * 1000).getFullYear() : null

    const patch: Partial<Game> = {
      description: entry.summary ?? game.description,
      developer: developer || game.developer,
      publisher: publisher || game.publisher,
      genres: entry.genres?.map((g) => g.name) ?? game.genres,
      releaseYear: year ?? game.releaseYear,
      releaseDate: year ? String(year) : game.releaseDate,
      coverPath: cover || game.coverPath,
      backgroundPath: background || game.backgroundPath,
      screenshots: screenshots.length ? screenshots : game.screenshots,
      rating: entry.rating ? Math.round(entry.rating) : game.rating,
      metadataProvider: 'igdb',
      metadataConfidence: best.score,
      extra: { ...game.extra, metadataUpdatedAt: nowIso() }
    }
    const updated = updateGameRecord(deps.db, game.id, patch)
    return {
      ok: true,
      provider: 'igdb',
      confidence: best.score,
      message: `Matched "${entry.name}" on IGDB with ${Math.round(best.score * 100)}% confidence.`,
      game: updated,
      candidates: artworkCandidates(updated)
    }
  } catch (error) {
    return { ok: false, provider: 'igdb', confidence: 0, reason: 'offline', message: (error as Error).message }
  }
}

/**
 * Ordered providers to try for a game: the preferred one first, then every
 * other configured provider. Steam is always available because it needs no
 * key; RAWG and IGDB join the chain only when their credentials are set, and a
 * preference without credentials simply falls back to the natural order.
 */
export function providerChain(settings: AppSettings): MetadataProviderId[] {
  const available: MetadataProviderId[] = ['steam']
  if (settings.igdbClientId && settings.igdbClientSecret) available.push('igdb')
  if (settings.rawgApiKey) available.push('rawg')
  const preferred = available.find((provider) => provider === settings.metadataProvider)
  return preferred ? [preferred, ...available.filter((provider) => provider !== preferred)] : available
}

/**
 * Steam can only act on a title with a usable App ID. Steam imports and games
 * with a numeric ID carry one; manually added or scanned PC titles ask the
 * keyless store search, which is cached in the game's extras after the first
 * hit. Returns null when Steam has nothing to work with, so the chain can move
 * on without a misleading failure message.
 */
async function enrichFromSteamGame(deps: MetadataDeps, game: Game, force: boolean): Promise<MetadataResult | null> {
  if (game.source === 'steam' || (/^\d+$/.test(game.sourceId) && game.source !== 'rom-scan')) {
    return enrichFromSteam(deps, game, force)
  }
  const searchablePcTitle =
    (game.source === 'manual' || game.source === 'pc-scan') &&
    game.platformId === 'windows' &&
    !/^\d+$/.test(game.sourceId)
  if (!searchablePcTitle) return null

  const cached = typeof game.extra.steamAppId === 'string' ? game.extra.steamAppId : ''
  let appid = /^\d+$/.test(cached) ? cached : ''
  if (!appid) {
    const resolved = await searchSteamAppId(deps, game.title)
    if ('reason' in resolved) {
      return {
        ok: false,
        provider: 'steam',
        confidence: 0,
        reason: resolved.reason,
        message: failureMessage('steam', resolved.reason)
      }
    }
    appid = resolved.appid
  }
  return enrichFromSteam(deps, game, force, appid)
}

export async function enrichGame(deps: MetadataDeps, gameId: string, force = false): Promise<MetadataResult> {
  const game = getGame(deps.db, gameId)
  if (!game) throw new Error('Game not found')

  // Every provider sees the same game; the first success wins and earlier
  // failures stay in the message so a fallback explains itself.
  const failures: string[] = []
  const reasons: MetadataFailureReason[] = []
  for (const provider of providerChain(deps.settings)) {
    const result =
      provider === 'steam'
        ? await enrichFromSteamGame(deps, game, force)
        : provider === 'rawg'
          ? await enrichFromRawg(deps, game)
          : await enrichFromIgdb(deps, game)
    if (!result) continue
    if (result.ok) {
      return failures.length ? { ...result, message: `${failures.join(' ')} ${result.message}`.trim() } : result
    }
    failures.push(result.message)
    if (result.reason) reasons.push(result.reason)
  }

  if (failures.length) {
    const priority: MetadataFailureReason[] = ['auth', 'rate-limit', 'budget', 'offline', 'no-match']
    return {
      ok: false,
      provider: 'none',
      confidence: 0,
      reason: priority.find((candidate) => reasons.includes(candidate)),
      message: failures.join(' ')
    }
  }
  return {
    ok: false,
    provider: 'none',
    confidence: 0,
    message:
      'No metadata provider is available for this game. Add a free RAWG or IGDB key in Settings, or add artwork manually from disk.'
  }
}

export function artworkCandidates(game: Game, appid?: string): ArtworkCandidate[] {
  const candidates: ArtworkCandidate[] = []
  const id = appid ?? game.sourceId
  if (game.source === 'steam' && id) {
    candidates.push(
      { provider: 'Steam', label: 'Vertical library cover', url: `${STEAM_CDN}/${id}/library_600x900.jpg`, kind: 'cover' },
      { provider: 'Steam', label: 'Box art (2x)', url: `${STEAM_CDN}/${id}/library_600x900_2x.jpg`, kind: 'cover' },
      { provider: 'Steam', label: 'Header banner', url: `${STEAM_CDN}/${id}/header.jpg`, kind: 'banner' },
      { provider: 'Steam', label: 'Hero background', url: `${STEAM_CDN}/${id}/library_hero.jpg`, kind: 'background' },
      { provider: 'Steam', label: 'Page background', url: `${STEAM_CDN}/${id}/page_bg_generated_v6b.jpg`, kind: 'background' },
      { provider: 'Steam', label: 'Game logo', url: `${STEAM_CDN}/${id}/logo.png`, kind: 'logo' }
    )
  }
  for (const [index, shot] of game.screenshots.entries()) {
    candidates.push({
      provider: 'Screenshots',
      label: `Screenshot ${index + 1}`,
      url: shot.local ?? shot.full,
      kind: 'screenshot'
    })
  }
  return candidates
}

export async function setArtwork(
  deps: MetadataDeps,
  gameId: string,
  kind: ArtworkCandidate['kind'],
  url: string
): Promise<Game> {
  const game = getGame(deps.db, gameId)
  if (!game) throw new Error('Game not found')
  const base = `${game.id}-${kind}`
  let resolved = ''
  if (url.startsWith('jf-art://')) resolved = url
  else if (!deps.cacheArtwork && /^https?:\/\//i.test(url)) resolved = url
  else resolved = await cacheImage(deps.artworkDir, url, base)
  if (!resolved) throw new Error('Could not download that artwork. Check the URL and your connection.')

  const patch: Partial<Game> = {}
  if (kind === 'cover' || kind === 'banner') patch.coverPath = resolved
  else if (kind === 'background') patch.backgroundPath = resolved
  else if (kind === 'logo') patch.logoPath = resolved
  else if (kind === 'screenshot') {
    const screenshots = [...game.screenshots, { full: url, local: resolved }]
    patch.screenshots = screenshots
  }
  patch.extra = { ...game.extra, artworkSource: url }
  return updateGameRecord(deps.db, gameId, patch)
}

export async function setLocalArtwork(
  deps: MetadataDeps,
  gameId: string,
  kind: ArtworkCandidate['kind'],
  sourceFile: string
): Promise<Game> {
  const game = getGame(deps.db, gameId)
  if (!game) throw new Error('Game not found')
  const url = copyLocalArtwork(deps.artworkDir, sourceFile, `${game.id}-${kind}-${Date.now()}`)
  const patch: Partial<Game> = {}
  if (kind === 'cover' || kind === 'banner') patch.coverPath = url
  else if (kind === 'background') patch.backgroundPath = url
  else if (kind === 'logo') patch.logoPath = url
  else if (kind === 'screenshot') patch.screenshots = [...game.screenshots, { full: url, local: url }]
  return updateGameRecord(deps.db, gameId, patch)
}

/**
 * Refresh every game that looks incomplete, within a per-provider request
 * budget. Results are grouped by failure reason so the UI can tell a missing
 * match apart from a rejected key or a rate limit, and the run stops early
 * instead of spending the last of a provider's allowance on retries.
 */
export async function refreshAll(
  deps: MetadataDeps,
  options: { /** Caps the provider requests for this run. */ budget?: RequestBudget } = {}
): Promise<MetadataRefreshSummary> {
  const budget = options.budget ?? createRequestBudget()
  const chain = providerChain(deps.settings)
  const rows = deps.db
    .prepare("SELECT id FROM games WHERE hidden = 0 AND (cover_path = '' OR cover_path NOT LIKE 'jf-art://%' OR metadata_confidence < 0.9) LIMIT 120")
    .all() as { id: string }[]
  const summary: MetadataRefreshSummary = {
    updated: 0,
    failed: 0,
    skipped: 0,
    noMatch: 0,
    rateLimited: 0,
    authFailed: 0,
    offline: 0
  }
  let processed = 0
  for (const row of rows) {
    if (budget.exhausted(chain)) break
    try {
      const result = await enrichGame({ ...deps, budget }, row.id, false)
      if (result.ok) {
        summary.updated += 1
      } else {
        summary.failed += 1
        if (result.reason === 'auth') summary.authFailed += 1
        else if (result.reason === 'rate-limit' || result.reason === 'budget') summary.rateLimited += 1
        else if (result.reason === 'offline') summary.offline += 1
        else summary.noMatch += 1
      }
    } catch {
      summary.failed += 1
      summary.offline += 1
    }
    processed += 1
  }
  summary.skipped = rows.length - processed
  return summary
}

export { artUrlFor }
