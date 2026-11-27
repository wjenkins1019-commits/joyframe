import crypto from 'node:crypto'
import type {
  Collection,
  CollectionRule,
  CompletionStatus,
  Emulator,
  Game,
  GameExtra,
  GameSave,
  LaunchMethod,
  LibraryQuery,
  Platform,
  Screenshot
} from '../../shared/types.ts'
import type { Db } from './db.ts'

export function uid(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function rowToGame(row: Record<string, unknown>): Game {
  return {
    id: String(row.id),
    title: String(row.title),
    sortTitle: String(row.sort_title ?? row.title),
    description: String(row.description ?? ''),
    releaseDate: String(row.release_date ?? ''),
    releaseYear: row.release_year === null || row.release_year === undefined ? null : Number(row.release_year),
    developer: String(row.developer ?? ''),
    publisher: String(row.publisher ?? ''),
    genres: safeJson<string[]>(row.genres, []),
    platformId: String(row.platform_id ?? 'windows'),
    platformName: row.platform_name ? String(row.platform_name) : undefined,
    source: String(row.source) as Game['source'],
    sourceId: String(row.source_id ?? ''),
    installDir: String(row.install_dir ?? ''),
    executable: String(row.executable ?? ''),
    launchArgs: String(row.launch_args ?? ''),
    emulatorId: row.emulator_id ? String(row.emulator_id) : null,
    emulatorCore: String(row.emulator_core ?? ''),
    romPath: String(row.rom_path ?? ''),
    installed: Number(row.installed) === 1,
    favorite: Number(row.favorite) === 1,
    hidden: Number(row.hidden) === 1,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    coverPath: String(row.cover_path ?? ''),
    backgroundPath: String(row.background_path ?? ''),
    logoPath: String(row.logo_path ?? ''),
    heroUrl: String(row.hero_url ?? ''),
    screenshots: safeJson<Screenshot[]>(row.screenshots, []),
    videoUrl: String(row.video_url ?? ''),
    videoName: String(row.video_name ?? ''),
    playtimeSeconds: Number(row.playtime_seconds ?? 0),
    playCount: Number(row.play_count ?? 0),
    lastPlayed: String(row.last_played ?? ''),
    addedAt: String(row.added_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    completion: String(row.completion ?? 'unplayed') as CompletionStatus,
    metadataProvider: String(row.metadata_provider ?? ''),
    metadataConfidence: Number(row.metadata_confidence ?? 0),
    notes: String(row.notes ?? ''),
    extra: safeJson<GameExtra>(row.extra, {}),
    launchMethods: [],
    saveCount: row.save_count === undefined ? 0 : Number(row.save_count)
  }
}

export function rowToPlatform(row: Record<string, unknown>): Platform {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name),
    family: String(row.family) as Platform['family'],
    extensions: safeJson<string[]>(row.extensions, []),
    native: Number(row.native) === 1,
    emulatorHint: String(row.emulator_hint ?? ''),
    sortOrder: Number(row.sort_order ?? 0)
  }
}

export function rowToEmulator(row: Record<string, unknown>): Emulator {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    detected: Number(row.detected) === 1,
    platformIds: safeJson<string[]>(row.platform_ids, []),
    argsTemplate: String(row.args_template ?? ''),
    core: String(row.core ?? ''),
    coreDir: String(row.core_dir ?? ''),
    saveStateDir: String(row.save_state_dir ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? '')
  }
}

export function rowToMethod(row: Record<string, unknown>): LaunchMethod {
  return {
    id: String(row.id),
    gameId: String(row.game_id),
    label: String(row.label ?? ''),
    kind: String(row.kind) as LaunchMethod['kind'],
    target: String(row.target ?? ''),
    args: String(row.args ?? ''),
    emulatorId: row.emulator_id ? String(row.emulator_id) : null,
    core: String(row.core ?? ''),
    isDefault: Number(row.is_default) === 1
  }
}

export function rowToSave(row: Record<string, unknown>): GameSave {
  return {
    id: String(row.id),
    gameId: String(row.game_id),
    kind: String(row.kind) as GameSave['kind'],
    slot: String(row.slot ?? ''),
    path: String(row.path),
    label: String(row.label ?? ''),
    timestamp: String(row.timestamp ?? ''),
    sizeBytes: Number(row.size_bytes ?? 0),
    emulatorId: row.emulator_id ? String(row.emulator_id) : null
  }
}

export function rowToCollection(row: Record<string, unknown>, gameIds: string[] = []): Collection {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    coverPath: String(row.cover_path ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    isFavorite: Number(row.is_favorite) === 1,
    kind: String(row.kind ?? 'manual') as Collection['kind'],
    rule: safeJson<CollectionRule | null>(row.rule, null),
    gameCount: gameIds.length,
    gameIds
  }
}

const SORTS: Record<string, string> = {
  title: 'g.sort_title COLLATE NOCASE',
  lastPlayed: 'g.last_played',
  added: 'g.added_at',
  playtime: 'g.playtime_seconds',
  releaseYear: 'g.release_year',
  rating: 'g.rating'
}

/** Query games with filters, sorting, launch methods and save counts attached. */
export function queryGames(db: Db, query: LibraryQuery = {}, includeHidden = false): Game[] {
  const where: string[] = []
  const params: (string | number)[] = []

  if (!includeHidden) where.push('g.hidden = 0')
  if (query.search) {
    const q = `%${query.search.toLowerCase()}%`
    where.push('(lower(g.title) LIKE ? OR lower(g.developer) LIKE ? OR lower(g.publisher) LIKE ? OR lower(g.genres) LIKE ?)')
    params.push(q, q, q, q)
  }
  if (query.platformId) {
    where.push('g.platform_id = ?')
    params.push(query.platformId)
  }
  if (query.source) {
    where.push('g.source = ?')
    params.push(query.source)
  }
  if (query.genre) {
    where.push('g.genres LIKE ?')
    params.push(`%${query.genre}%`)
  }
  if (query.installed === 'installed') where.push('g.installed = 1')
  if (query.installed === 'uninstalled') where.push('g.installed = 0')
  if (query.played === 'played') where.push("g.last_played <> ''")
  if (query.played === 'never') where.push("g.last_played = ''")
  if (query.favorite === true) where.push('g.favorite = 1')
  if (query.favorite === false) where.push('g.favorite = 0')

  let join = ''
  if (query.collectionId) {
    join = 'JOIN collection_games cg ON cg.game_id = g.id AND cg.collection_id = ?'
    params.unshift(query.collectionId)
  }

  const sortKey = SORTS[query.sort ?? 'title'] ?? SORTS.title
  const direction = query.direction === 'asc' ? 'ASC' : query.sort && query.sort !== 'title' ? 'DESC' : 'ASC'
  const limit = query.limit && query.limit > 0 ? `LIMIT ${Math.floor(query.limit)}` : ''

  const sql = `
    SELECT g.*, p.name AS platform_name,
      (SELECT COUNT(*) FROM game_saves s WHERE s.game_id = g.id) AS save_count
    FROM games g
    LEFT JOIN platforms p ON p.id = g.platform_id
    ${join}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortKey} ${direction}, g.title COLLATE NOCASE ASC
    ${limit}`

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  const games = rows.map(rowToGame)
  if (games.length === 0) return games

  const ids = games.map((g) => g.id)
  const placeholders = ids.map(() => '?').join(',')
  const methods = db
    .prepare(`SELECT * FROM launch_methods WHERE game_id IN (${placeholders}) ORDER BY is_default DESC`)
    .all(...ids) as Record<string, unknown>[]
  const byGame = new Map<string, LaunchMethod[]>()
  for (const row of methods) {
    const method = rowToMethod(row)
    const list = byGame.get(method.gameId) ?? []
    list.push(method)
    byGame.set(method.gameId, list)
  }
  for (const game of games) game.launchMethods = byGame.get(game.id) ?? []
  return games
}

export function getGame(db: Db, id: string): Game | null {
  const row = db
    .prepare(
      `SELECT g.*, p.name AS platform_name,
        (SELECT COUNT(*) FROM game_saves s WHERE s.game_id = g.id) AS save_count
       FROM games g LEFT JOIN platforms p ON p.id = g.platform_id WHERE g.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  const game = rowToGame(row)
  game.launchMethods = (
    db.prepare('SELECT * FROM launch_methods WHERE game_id = ? ORDER BY is_default DESC').all(id) as Record<
      string,
      unknown
    >[]
  ).map(rowToMethod)
  return game
}

export function findBySource(db: Db, source: string, sourceId: string): Game | null {
  if (!sourceId) return null
  const row = db.prepare('SELECT * FROM games WHERE source = ? AND source_id = ?').get(source, sourceId) as
    | Record<string, unknown>
    | undefined
  return row ? rowToGame(row) : null
}

export function findDuplicate(db: Db, title: string, platformId: string, installDir = ''): Game | null {
  const norm = normalizeTitle(title)
  const rows = db.prepare('SELECT * FROM games WHERE platform_id = ?').all(platformId) as Record<string, unknown>[]
  for (const row of rows) {
    const game = rowToGame(row)
    if (installDir && game.installDir && game.installDir.toLowerCase() === installDir.toLowerCase()) return game
    if (normalizeTitle(game.title) === norm) return game
  }
  return null
}

export interface NewGameInput extends Partial<Game> {
  title: string
}

export function insertGame(db: Db, input: NewGameInput): Game {
  const id = input.id ?? uid()
  const timestamp = nowIso()
  const title = input.title.trim() || 'Untitled Game'
  const platformId = input.platformId ?? 'windows'
  db.prepare(
    `INSERT INTO games (
      id, title, sort_title, description, release_date, release_year, developer, publisher, genres,
      platform_id, source, source_id, install_dir, executable, launch_args, emulator_id, emulator_core,
      rom_path, installed, favorite, hidden, rating, cover_path, background_path, logo_path, hero_url,
      screenshots, video_url, video_name, playtime_seconds, play_count, last_played, added_at, updated_at,
      completion, metadata_provider, metadata_confidence, notes, extra
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    title,
    normalizeTitle(title) || title.toLowerCase(),
    input.description ?? '',
    input.releaseDate ?? '',
    input.releaseYear ?? null,
    input.developer ?? '',
    input.publisher ?? '',
    JSON.stringify(input.genres ?? []),
    platformId,
    input.source ?? 'manual',
    input.sourceId ?? '',
    input.installDir ?? '',
    input.executable ?? '',
    input.launchArgs ?? '',
    input.emulatorId ?? null,
    input.emulatorCore ?? '',
    input.romPath ?? '',
    input.installed === false ? 0 : 1,
    input.favorite ? 1 : 0,
    input.hidden ? 1 : 0,
    input.rating ?? null,
    input.coverPath ?? '',
    input.backgroundPath ?? '',
    input.logoPath ?? '',
    input.heroUrl ?? '',
    JSON.stringify(input.screenshots ?? []),
    input.videoUrl ?? '',
    input.videoName ?? '',
    input.playtimeSeconds ?? 0,
    input.playCount ?? 0,
    input.lastPlayed ?? '',
    input.addedAt ?? timestamp,
    timestamp,
    input.completion ?? 'unplayed',
    input.metadataProvider ?? '',
    input.metadataConfidence ?? 0,
    input.notes ?? '',
    JSON.stringify(input.extra ?? {})
  )
  const game = getGame(db, id)
  if (!game) throw new Error('Failed to insert game')
  return game
}

export interface GameUpdate extends Partial<Game> {
  sortTitle?: string
}

const UPDATE_COLUMNS: Record<string, string> = {
  title: 'title',
  description: 'description',
  releaseDate: 'release_date',
  releaseYear: 'release_year',
  developer: 'developer',
  publisher: 'publisher',
  genres: 'genres',
  platformId: 'platform_id',
  source: 'source',
  sourceId: 'source_id',
  installDir: 'install_dir',
  executable: 'executable',
  launchArgs: 'launch_args',
  emulatorId: 'emulator_id',
  emulatorCore: 'emulator_core',
  romPath: 'rom_path',
  installed: 'installed',
  favorite: 'favorite',
  hidden: 'hidden',
  rating: 'rating',
  coverPath: 'cover_path',
  backgroundPath: 'background_path',
  logoPath: 'logo_path',
  heroUrl: 'hero_url',
  screenshots: 'screenshots',
  videoUrl: 'video_url',
  videoName: 'video_name',
  playtimeSeconds: 'playtime_seconds',
  playCount: 'play_count',
  lastPlayed: 'last_played',
  completion: 'completion',
  metadataProvider: 'metadata_provider',
  metadataConfidence: 'metadata_confidence',
  notes: 'notes',
  extra: 'extra'
}

export function updateGameRecord(db: Db, id: string, patch: GameUpdate): Game {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const jsonFields = new Set(['genres', 'screenshots', 'extra'])

  for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
    if (!(key in patch)) continue
    const raw = (patch as Record<string, unknown>)[key]
    let value: string | number | null
    if (raw === null || raw === undefined) value = null
    else if (typeof raw === 'boolean') value = raw ? 1 : 0
    else if (jsonFields.has(key)) value = JSON.stringify(raw)
    else value = typeof raw === 'number' ? raw : String(raw)
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (typeof patch.title === 'string') {
    sets.push('sort_title = ?')
    params.push(normalizeTitle(patch.title) || patch.title.toLowerCase())
  }
  sets.push('updated_at = ?')
  params.push(nowIso())
  params.push(id)
  db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const game = getGame(db, id)
  if (!game) throw new Error('Game not found after update')
  return game
}

export function deleteGame(db: Db, id: string): boolean {
  const result = db.prepare('DELETE FROM games WHERE id = ?').run(id)
  return Number(result.changes) > 0
}

/**
 * Fold `duplicateId` into `primaryId` without losing history: playtime and
 * play counts are summed, the latest play date wins, launch methods,
 * collections, sessions and saves move over, and blank metadata fields are
 * filled from the duplicate. Returns the surviving game.
 */
export function mergeGames(db: Db, primaryId: string, duplicateId: string): Game {
  const primary = getGame(db, primaryId)
  const duplicate = getGame(db, duplicateId)
  if (!primary || !duplicate) throw new Error('Both games must exist to merge')
  db.prepare('UPDATE launch_methods SET game_id = ? WHERE game_id = ?').run(primaryId, duplicateId)
  db.prepare('UPDATE play_sessions SET game_id = ? WHERE game_id = ?').run(primaryId, duplicateId)
  // Rows that would collide (same save path or collection) stay behind and
  // vanish with the duplicate instead of breaking unique constraints.
  db.prepare('UPDATE OR IGNORE game_saves SET game_id = ? WHERE game_id = ?').run(primaryId, duplicateId)
  db.prepare('UPDATE OR IGNORE collection_games SET game_id = ? WHERE game_id = ?').run(primaryId, duplicateId)
  const merged: GameUpdate = {
    description: primary.description || duplicate.description,
    developer: primary.developer || duplicate.developer,
    publisher: primary.publisher || duplicate.publisher,
    genres: [...new Set([...primary.genres, ...duplicate.genres])],
    coverPath: primary.coverPath || duplicate.coverPath,
    backgroundPath: primary.backgroundPath || duplicate.backgroundPath,
    logoPath: primary.logoPath || duplicate.logoPath,
    screenshots: primary.screenshots.length ? primary.screenshots : duplicate.screenshots,
    videoUrl: primary.videoUrl || duplicate.videoUrl,
    playtimeSeconds: primary.playtimeSeconds + duplicate.playtimeSeconds,
    playCount: primary.playCount + duplicate.playCount,
    lastPlayed: primary.lastPlayed > duplicate.lastPlayed ? primary.lastPlayed : duplicate.lastPlayed,
    favorite: primary.favorite || duplicate.favorite,
    rating: primary.rating ?? duplicate.rating,
    platformId: primary.platformId || duplicate.platformId,
    completion: primary.completion === 'unplayed' ? duplicate.completion : primary.completion,
    notes: primary.notes || duplicate.notes,
    metadataProvider: primary.metadataProvider || duplicate.metadataProvider,
    metadataConfidence: primary.metadataConfidence || duplicate.metadataConfidence
  }
  deleteGame(db, duplicateId)
  const survivor = updateGameRecord(db, primaryId, merged)
  // The duplicate may be the older entry: the survivor keeps the earliest date.
  if (duplicate.addedAt && (!survivor.addedAt || duplicate.addedAt < survivor.addedAt)) {
    db.prepare('UPDATE games SET added_at = ? WHERE id = ?').run(duplicate.addedAt, primaryId)
    const redated = getGame(db, primaryId)
    if (redated) return redated
  }
  return survivor
}

export function getPlatforms(db: Db): Platform[] {
  return (db.prepare('SELECT * FROM platforms ORDER BY sort_order ASC').all() as Record<string, unknown>[]).map(
    rowToPlatform
  )
}
