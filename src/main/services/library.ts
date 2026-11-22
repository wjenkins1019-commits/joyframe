import type {
  Collection,
  CollectionRule,
  Game,
  HomeRow,
  HomeSection,
  PlaySession,
  StatsSummary
} from '../../shared/types.ts'
import type { Db } from './db.ts'
import { getPlatforms, nowIso, queryGames, rowToCollection, uid } from './repo.ts'

const BUILTIN_SECTIONS: { key: string; title: string; limit: number }[] = [
  { key: 'continue', title: 'Continue Playing', limit: 14 },
  { key: 'recent', title: 'Recently Played', limit: 18 },
  { key: 'added', title: 'Recently Added', limit: 18 },
  { key: 'most', title: 'Most Played', limit: 18 },
  { key: 'favorites', title: 'Favorites', limit: 18 },
  { key: 'trending', title: 'Trending in My Library', limit: 18 },
  { key: 'retro', title: 'Retro Classics', limit: 18 },
  { key: 'steam', title: 'Steam Library', limit: 18 },
  { key: 'nintendo', title: 'Nintendo Classics', limit: 18 },
  { key: 'playstation', title: 'PlayStation Classics', limit: 18 },
  { key: 'xbox', title: 'Xbox Classics', limit: 18 },
  { key: 'arcade', title: 'Arcade Favorites', limit: 18 },
  { key: 'rpg', title: 'RPG Collection', limit: 18 },
  { key: 'action', title: 'Action Games', limit: 18 },
  { key: 'racing', title: 'Racing Games', limit: 18 },
  { key: 'fighting', title: 'Fighting Games', limit: 18 },
  { key: 'gems', title: 'Hidden Gems', limit: 18 },
  { key: 'never', title: 'Never Played', limit: 18 },
  { key: 'completed', title: 'Recently Completed', limit: 18 }
]

export function ensureSections(db: Db): void {
  const count = db.prepare('SELECT COUNT(*) AS c FROM home_sections').get() as { c: number }
  if (count.c > 0) return
  const insert = db.prepare(
    'INSERT INTO home_sections (id, kind, title, key, collection_id, sort_order, hidden, "limit") VALUES (?,?,?,?,?,?,?,?)'
  )
  BUILTIN_SECTIONS.forEach((section, index) => {
    insert.run(uid(), 'builtin', section.title, section.key, null, index, 0, section.limit)
  })
}

export function listSections(db: Db): HomeSection[] {
  ensureSections(db)
  return (
    db.prepare('SELECT * FROM home_sections ORDER BY sort_order ASC').all() as Record<string, unknown>[]
  ).map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as HomeSection['kind'],
    title: String(row.title),
    key: String(row.key),
    collectionId: row.collection_id ? String(row.collection_id) : null,
    sortOrder: Number(row.sort_order),
    hidden: Number(row.hidden) === 1,
    limit: Number(row.limit)
  }))
}

export function updateSection(db: Db, id: string, patch: Partial<HomeSection>): HomeSection[] {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (patch.title !== undefined) {
    sets.push('title = ?')
    params.push(patch.title)
  }
  if (patch.hidden !== undefined) {
    sets.push('hidden = ?')
    params.push(patch.hidden ? 1 : 0)
  }
  if (patch.limit !== undefined) {
    sets.push('"limit" = ?')
    params.push(Math.max(1, Math.min(60, patch.limit)))
  }
  if (patch.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    params.push(patch.sortOrder)
  }
  if (sets.length) {
    params.push(id)
    db.prepare(`UPDATE home_sections SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  return listSections(db)
}

export function reorderSections(db: Db, orderedIds: string[]): HomeSection[] {
  const statement = db.prepare('UPDATE home_sections SET sort_order = ? WHERE id = ?')
  orderedIds.forEach((id, index) => statement.run(index, id))
  return listSections(db)
}

export function createSection(db: Db, title: string, collectionId: string): HomeSection[] {
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM home_sections').get() as { m: number }
  db.prepare(
    'INSERT INTO home_sections (id, kind, title, key, collection_id, sort_order, hidden, "limit") VALUES (?,?,?,?,?,?,?,?)'
  ).run(uid(), 'collection', title, `collection:${collectionId}`, collectionId, max.m + 1, 0, 18)
  return listSections(db)
}

export function resetSections(db: Db): HomeSection[] {
  db.prepare('DELETE FROM home_sections').run()
  ensureSections(db)
  return listSections(db)
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

function collectionGameIds(db: Db, id: string): string[] {
  return (
    db.prepare('SELECT game_id FROM collection_games WHERE collection_id = ? ORDER BY sort_order ASC').all(id) as {
      game_id: string
    }[]
  ).map((row) => row.game_id)
}

function parseCollectionRule(value: unknown): CollectionRule | null {
  if (!value || typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as CollectionRule
    if (parsed && typeof parsed === 'object' && typeof parsed.field === 'string') return parsed
    return null
  } catch {
    return null
  }
}

export function listCollections(db: Db): Collection[] {
  const rows = db.prepare('SELECT * FROM collections ORDER BY sort_order ASC, name ASC').all() as Record<
    string,
    unknown
  >[]
  // Smart collections resolve their members live so counts, shelves and detail
  // badges stay correct as the library changes. Membership rows are only used
  // for manual collections.
  const platforms = getPlatforms(db)
  const families = new Map(platforms.map((platform) => [platform.id, platform.family]))
  const allGames = queryGames(db, {}, true)
  return rows.map((row) => {
    const rule = parseCollectionRule(row.rule)
    if (rule) {
      const ids = allGames.filter((game) => matchesRule(game, rule, families)).map((game) => game.id)
      return rowToCollection({ ...row, kind: 'smart' }, ids)
    }
    return rowToCollection(row, collectionGameIds(db, String(row.id)))
  })
}

export function createCollection(db: Db, patch: Partial<Collection>): Collection {
  const id = uid()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM collections').get() as { m: number }
  db.prepare(
    'INSERT INTO collections (id, name, description, cover_path, sort_order, is_favorite, kind, rule) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    id,
    patch.name?.trim() || 'New Collection',
    patch.description ?? '',
    patch.coverPath ?? '',
    max.m + 1,
    patch.isFavorite ? 1 : 0,
    patch.rule ? 'smart' : (patch.kind ?? 'manual'),
    patch.rule ? JSON.stringify(patch.rule) : null
  )
  const gameIds = patch.gameIds ?? []
  addGamesToCollection(db, id, gameIds)
  return listCollections(db).find((c) => c.id === id) as Collection
}

export function updateCollection(db: Db, id: string, patch: Partial<Collection>): Collection {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name)
  }
  if (patch.description !== undefined) {
    sets.push('description = ?')
    params.push(patch.description)
  }
  if (patch.coverPath !== undefined) {
    sets.push('cover_path = ?')
    params.push(patch.coverPath)
  }
  if (patch.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    params.push(patch.sortOrder)
  }
  if (patch.isFavorite !== undefined) {
    sets.push('is_favorite = ?')
    params.push(patch.isFavorite ? 1 : 0)
  }
  if (patch.rule !== undefined) {
    sets.push('rule = ?')
    params.push(patch.rule ? JSON.stringify(patch.rule) : null)
    sets.push('kind = ?')
    params.push(patch.rule ? 'smart' : 'manual')
  }
  if (sets.length) {
    params.push(id)
    db.prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  const collection = listCollections(db).find((c) => c.id === id)
  if (!collection) throw new Error('Collection not found')
  return collection
}

export function removeCollection(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes) > 0
}

export function addGamesToCollection(db: Db, collectionId: string, gameIds: string[]): void {
  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM collection_games WHERE collection_id = ?')
    .get(collectionId) as { m: number }
  let order = maxRow.m
  const insert = db.prepare(
    'INSERT OR IGNORE INTO collection_games (collection_id, game_id, sort_order) VALUES (?,?,?)'
  )
  for (const gameId of gameIds) {
    order += 1
    insert.run(collectionId, gameId, order)
  }
}

export function removeGameFromCollection(db: Db, collectionId: string, gameId: string): void {
  db.prepare('DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?').run(collectionId, gameId)
}

export function reorderCollections(db: Db, orderedIds: string[]): Collection[] {
  const statement = db.prepare('UPDATE collections SET sort_order = ? WHERE id = ?')
  orderedIds.forEach((id, index) => statement.run(index, id))
  return listCollections(db)
}

/* ------------------------------------------------------------------ */
/* Smart rules & home rows                                             */
/* ------------------------------------------------------------------ */

function matchesRule(game: Game, rule: CollectionRule, platformFamilies: Map<string, string>): boolean {
  const test = (r: CollectionRule): boolean => {
    switch (r.field) {
      case 'platform': {
        const family = platformFamilies.get(game.platformId) ?? ''
        return r.value === game.platformId || r.value.toLowerCase() === family.toLowerCase()
      }
      case 'genre':
        return game.genres.some((g) => g.toLowerCase().includes(r.value.toLowerCase()))
      case 'favorite':
        return r.value === 'true' ? game.favorite : !game.favorite
      case 'completion':
        return game.completion === r.value
      case 'source':
        return game.source === r.value
      case 'playtime': {
        const minutes = game.playtimeSeconds / 60
        const value = Number(r.value)
        return r.op === 'gt' ? minutes > value : minutes < value
      }
      default:
        return false
    }
  }
  if (rule.conditions && rule.conditions.length) {
    return rule.match === 'any' ? rule.conditions.some(test) : rule.conditions.every(test)
  }
  return test(rule)
}

export function buildHomeRows(db: Db, hiddenGamesIncluded = false): HomeRow[] {
  const games = queryGames(db, {}, hiddenGamesIncluded)
  const platforms = getPlatforms(db)
  const families = new Map(platforms.map((p) => [p.id, p.family]))
  const sections = listSections(db).filter((s) => !s.hidden)
  const collections = listCollections(db)
  const byId = new Map(games.map((g) => [g.id, g]))
  const played = games.filter((g) => g.lastPlayed)

  const sortBy = <T extends Game>(list: T[], pick: (g: Game) => number): T[] =>
    [...list].sort((a, b) => pick(b) - pick(a))

  const builder: Record<string, (limit: number) => Game[]> = {
    continue: (limit) =>
      sortBy(played, (g) => new Date(g.lastPlayed).getTime()).slice(0, limit),
    recent: (limit) => sortBy(played, (g) => new Date(g.lastPlayed).getTime()).slice(0, limit),
    added: (limit) => sortBy(games, (g) => new Date(g.addedAt).getTime()).slice(0, limit),
    most: (limit) => sortBy(games.filter((g) => g.playtimeSeconds > 0), (g) => g.playtimeSeconds).slice(0, limit),
    favorites: (limit) => games.filter((g) => g.favorite).slice(0, limit),
    trending: (limit) =>
      sortBy(games.filter((g) => g.playCount > 0), (g) => g.playCount * 60 + g.playtimeSeconds).slice(0, limit),
    retro: (limit) =>
      sortBy(
        games.filter((g) => (families.get(g.platformId) ?? 'PC') !== 'PC'),
        (g) => (g.favorite ? 1e12 : 0) + (g.rating ?? 0) + g.playtimeSeconds
      ).slice(0, limit),
    steam: (limit) => games.filter((g) => g.source === 'steam').slice(0, limit),
    nintendo: (limit) => games.filter((g) => families.get(g.platformId) === 'Nintendo').slice(0, limit),
    playstation: (limit) => games.filter((g) => families.get(g.platformId) === 'Sony').slice(0, limit),
    xbox: (limit) => games.filter((g) => families.get(g.platformId) === 'Microsoft').slice(0, limit),
    arcade: (limit) => games.filter((g) => families.get(g.platformId) === 'Arcade').slice(0, limit),
    rpg: (limit) =>
      games.filter((g) => g.genres.some((x) => /rpg|role/i.test(x))).slice(0, limit),
    action: (limit) =>
      games.filter((g) => g.genres.some((x) => /action|shooter|adventure/i.test(x))).slice(0, limit),
    racing: (limit) => games.filter((g) => g.genres.some((x) => /racing|driving/i.test(x))).slice(0, limit),
    fighting: (limit) => games.filter((g) => g.genres.some((x) => /fighting/i.test(x))).slice(0, limit),
    gems: (limit) =>
      sortBy(
        games.filter((g) => !g.lastPlayed && (g.rating === null || g.rating >= 65)),
        (g) => g.rating ?? 0
      ).slice(0, limit),
    never: (limit) => games.filter((g) => !g.lastPlayed).slice(0, limit),
    completed: (limit) =>
      sortBy(
        games.filter((g) => g.completion === 'completed'),
        (g) => new Date(g.lastPlayed || g.updatedAt).getTime()
      ).slice(0, limit)
  }

  const rows: HomeRow[] = []
  for (const section of sections) {
    if (section.kind === 'collection' && section.collectionId) {
      const collection = collections.find((c) => c.id === section.collectionId)
      if (!collection) continue
      let list = collection.gameIds.map((id) => byId.get(id)).filter((g): g is Game => !!g)
      if (collection.kind === 'smart' && collection.rule) {
        list = games.filter((g) => matchesRule(g, collection.rule as CollectionRule, families))
      }
      rows.push({
        id: section.id,
        title: section.title || collection.name,
        key: section.key,
        games: list.slice(0, section.limit),
        kind: 'collection',
        collectionId: collection.id
      })
      continue
    }
    const build = builder[section.key]
    if (!build) continue
    const list = build(section.limit)
    if (!list.length) continue
    rows.push({
      id: section.id,
      title: section.title,
      key: section.key,
      games: list,
      kind: 'builtin',
      collectionId: null
    })
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export function getStats(db: Db): StatsSummary {
  const games = queryGames(db, {}, true)
  const platforms = getPlatforms(db)
  const platformMap = new Map(platforms.map((p) => [p.id, p.name]))
  const sessions = db.prepare('SELECT * FROM play_sessions').all() as Record<string, unknown>[]

  const byPlatformMap = new Map<string, { count: number; playtime: number }>()
  const byGenre = new Map<string, number>()
  const bySource = new Map<string, number>()

  let totalPlaytime = 0
  for (const game of games) {
    totalPlaytime += game.playtimeSeconds
    const entry = byPlatformMap.get(game.platformId) ?? { count: 0, playtime: 0 }
    entry.count += 1
    entry.playtime += game.playtimeSeconds
    byPlatformMap.set(game.platformId, entry)
    for (const genre of game.genres) byGenre.set(genre, (byGenre.get(genre) ?? 0) + 1)
    bySource.set(game.source, (bySource.get(game.source) ?? 0) + 1)
  }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const dayBuckets = new Map<string, number>()
  const now = Date.now()
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400000)
    dayBuckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const session of sessions) {
    const started = String(session.started_at ?? '')
    const day = started.slice(0, 10)
    if (dayBuckets.has(day)) {
      dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + Number(session.seconds ?? 0))
    }
  }

  return {
    totalGames: games.length,
    installedGames: games.filter((g) => g.installed).length,
    totalPlaytimeSeconds: totalPlaytime,
    favoriteCount: games.filter((g) => g.favorite).length,
    completedCount: games.filter((g) => g.completion === 'completed').length,
    inProgressCount: games.filter((g) => g.completion === 'in-progress').length,
    unplayedCount: games.filter((g) => !g.lastPlayed).length,
    byPlatform: [...byPlatformMap.entries()]
      .map(([platformId, value]) => ({
        platformId,
        name: platformMap.get(platformId) ?? platformId,
        count: value.count,
        playtime: value.playtime
      }))
      .sort((a, b) => b.count - a.count),
    byGenre: [...byGenre.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
    topGames: [...games]
      .filter((g) => g.playtimeSeconds > 0)
      .sort((a, b) => b.playtimeSeconds - a.playtimeSeconds)
      .slice(0, 8)
      .map((g) => ({ id: g.id, title: g.title, playtimeSeconds: g.playtimeSeconds, coverPath: g.coverPath })),
    recent: [...games]
      .filter((g) => g.lastPlayed)
      .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())
      .slice(0, 8)
      .map((g) => ({ id: g.id, title: g.title, lastPlayed: g.lastPlayed, coverPath: g.coverPath })),
    last30Days: [...dayBuckets.entries()].map(([day, seconds]) => ({ day, seconds })),
    addedThisMonth: games.filter((g) => new Date(g.addedAt).getTime() >= monthStart.getTime()).length
  }
}

export function recordSession(db: Db, session: PlaySession): void {
  db.prepare('INSERT INTO play_sessions (id, game_id, started_at, ended_at, seconds, source) VALUES (?,?,?,?,?,?)').run(
    session.id,
    session.gameId,
    session.startedAt,
    session.endedAt,
    session.seconds,
    session.source
  )
}

export function finishGamePlaytime(db: Db, gameId: string, seconds: number): Game | null {
  if (seconds > 0) {
    db.prepare(
      `UPDATE games SET playtime_seconds = playtime_seconds + ?, last_played = ?, play_count = play_count + 1,
       updated_at = ? WHERE id = ?`
    ).run(Math.round(seconds), nowIso(), nowIso(), gameId)
  }
  return queryGames(db, {}, true).find((g) => g.id === gameId) ?? null
}
