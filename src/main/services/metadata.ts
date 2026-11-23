import type {
  AppSettings,
  ArtworkCandidate,
  Game,
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
}

const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

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

async function fetchSteamDetails(appid: string): Promise<SteamAppDetails | null> {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' }
    })
    if (!response.ok) return null
    const json = (await response.json()) as Record<string, { success: boolean; data?: SteamAppDetails }>
    const entry = json[appid]
    if (!entry?.success || !entry.data) return null
    return entry.data
  } catch {
    return null
  }
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
async function searchSteamAppId(title: string): Promise<string> {
  try {
    const url = new URL('https://store.steampowered.com/api/storesearch/')
    url.searchParams.set('term', title)
    url.searchParams.set('l', 'english')
    url.searchParams.set('cc', 'US')
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' }
    })
    if (!response.ok) return ''
    const json = (await response.json()) as { items?: SteamStoreItem[] }
    return steamStoreMatch(title, json.items ?? [])
  } catch {
    return ''
  }
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
  const details = await fetchSteamDetails(appid)
  if (!details) {
    return {
      ok: false,
      provider: 'steam',
      confidence: 0,
      message: 'Steam returned no data for this App ID. Check your connection and try again.'
    }
  }

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
  settings: AppSettings,
  route: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  const url = new URL(`${RAWG_BASE}${route}`)
  url.searchParams.set('key', settings.rawgApiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' }
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
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
      message: 'RAWG API key is not configured. Add your free key in Settings.'
    }
  }

  const search = await rawgGet<{ results?: RawgGame[] }>(settings, '/games', {
    search: game.title,
    page_size: '5'
  })
  const results = search?.results ?? []
  if (!results.length) {
    return { ok: false, provider: 'rawg', confidence: 0, message: 'RAWG has no match for this title.' }
  }
  const best = results
    .map((entry) => ({ entry, score: titleScore(game.title, entry.name) }))
    .sort((a, b) => b.score - a.score)[0]
  if (best.score <= 0) {
    return { ok: false, provider: 'rawg', confidence: 0, message: 'RAWG returned no close title match.' }
  }

  // The detail call adds descriptions, companies and the extra hero artwork;
  // if it fails the search result still carries enough to fill the basics.
  const detail = (await rawgGet<RawgGame>(settings, `/games/${best.entry.id}`)) ?? best.entry
  const shotResponse = await rawgGet<{ results?: { image: string }[] }>(
    settings,
    `/games/${best.entry.id}/screenshots`,
    { page_size: '6' }
  )

  const base = `rawg-${detail.id}`
  const backgroundSource = detail.background_image_additional || detail.background_image || ''
  const [cover, background] = await Promise.all([
    artFor(deps, detail.background_image || backgroundSource, `${base}-cover`),
    artFor(deps, backgroundSource, `${base}-hero`)
  ])

  const screenshots: Screenshot[] = []
  for (const [index, shot] of (shotResponse?.results ?? []).slice(0, 6).entries()) {
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

async function igdbToken(settings: AppSettings): Promise<string> {
  const key = `${settings.igdbClientId}:${settings.igdbClientSecret}`
  const cached = tokenCache.get(key)
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const url = new URL('https://id.twitch.tv/oauth2/token')
  url.searchParams.set('client_id', settings.igdbClientId)
  url.searchParams.set('client_secret', settings.igdbClientSecret)
  url.searchParams.set('grant_type', 'client_credentials')
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`IGDB authentication failed (${response.status})`)
  const json = (await response.json()) as { access_token: string; expires_in: number }
  tokenCache.set(key, { token: json.access_token, expires: Date.now() + json.expires_in * 1000 })
  return json.access_token
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
  let token: string
  try {
    token = await igdbToken(settings)
  } catch (error) {
    return { ok: false, provider: 'igdb', confidence: 0, message: (error as Error).message }
  }

  const query = `search "${game.title.replace(/["\\]/g, ' ')}";
    fields name,summary,first_release_date,rating,genres.name,cover.url,artworks.url,screenshots.url,
      involved_companies.developer,involved_companies.publisher,involved_companies.company.name,platforms.name;
    limit 6;`
  try {
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': settings.igdbClientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain'
      },
      body: query,
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      return { ok: false, provider: 'igdb', confidence: 0, message: `IGDB request failed (${response.status})` }
    }
    const results = (await response.json()) as IgdbGame[]
    if (!results.length) {
      return { ok: false, provider: 'igdb', confidence: 0, message: 'No IGDB match found for this title.' }
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
    return { ok: false, provider: 'igdb', confidence: 0, message: (error as Error).message }
  }
}

export async function enrichGame(deps: MetadataDeps, gameId: string, force = false): Promise<MetadataResult> {
  const game = getGame(deps.db, gameId)
  if (!game) throw new Error('Game not found')

  // Honour the preferred provider, then fall back to any other provider whose
  // credentials are configured, so a failed match still gets a second chance.
  const igdbReady = Boolean(deps.settings.igdbClientId && deps.settings.igdbClientSecret)
  const rawgReady = Boolean(deps.settings.rawgApiKey)

  if (deps.settings.metadataProvider === 'rawg' && rawgReady) {
    const rawg = await enrichFromRawg(deps, game)
    if (rawg.ok) return rawg
    if (game.source === 'steam' || (game.sourceId && /^\d+$/.test(game.sourceId) && game.source !== 'rom-scan')) {
      const steam = await enrichFromSteam(deps, game, force)
      if (steam.ok) return { ...steam, message: `${rawg.message} ${steam.message}`.trim() }
    }
    if (igdbReady) {
      const igdb = await enrichFromIgdb(deps, game)
      return { ...igdb, message: `${rawg.message} ${igdb.message}`.trim() }
    }
    return rawg
  }

  if (deps.settings.metadataProvider === 'igdb' && igdbReady) {
    const igdb = await enrichFromIgdb(deps, game)
    if (igdb.ok) return igdb
    if (game.sourceId && /^\d+$/.test(game.sourceId) && game.source !== 'rom-scan') {
      const steam = await enrichFromSteam(deps, game, force)
      return { ...steam, message: `${igdb.message} ${steam.message}`.trim() }
    }
    return igdb
  }

  if (game.source === 'steam' || (game.sourceId && /^\d+$/.test(game.sourceId) && game.source !== 'rom-scan')) {
    const result = await enrichFromSteam(deps, game, force)
    if (result.ok) return result
    if (igdbReady) {
      const igdb = await enrichFromIgdb(deps, game)
      return { ...igdb, message: `${result.message} ${igdb.message}`.trim() }
    }
    if (rawgReady) {
      const rawg = await enrichFromRawg(deps, game)
      return { ...rawg, message: `${result.message} ${rawg.message}`.trim() }
    }
    return result
  }

  // Manually added PC titles (GOG, Epic, itch) carry no App ID. Resolve one
  // through the keyless store search so Steam metadata can fill them too; a
  // cached resolution from an earlier refresh avoids the extra request.
  const searchablePcTitle =
    (game.source === 'manual' || game.source === 'pc-scan') &&
    game.platformId === 'windows' &&
    !/^\d+$/.test(game.sourceId)
  if (searchablePcTitle) {
    const cached = typeof game.extra.steamAppId === 'string' ? game.extra.steamAppId : ''
    const appid = /^\d+$/.test(cached) ? cached : await searchSteamAppId(game.title)
    if (appid) {
      const steam = await enrichFromSteam(deps, game, force, appid)
      if (steam.ok || (!igdbReady && !rawgReady)) return steam
    }
  }

  if (igdbReady) return enrichFromIgdb(deps, game)
  if (rawgReady) return enrichFromRawg(deps, game)

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

export async function refreshAll(deps: MetadataDeps): Promise<{ updated: number; failed: number }> {
  const rows = deps.db
    .prepare("SELECT id FROM games WHERE hidden = 0 AND (cover_path = '' OR cover_path NOT LIKE 'jf-art://%' OR metadata_confidence < 0.9) LIMIT 120")
    .all() as { id: string }[]
  let updated = 0
  let failed = 0
  for (const row of rows) {
    try {
      const result = await enrichGame(deps, row.id, false)
      if (result.ok) updated += 1
      else failed += 1
    } catch {
      failed += 1
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return { updated, failed }
}

export { artUrlFor }
