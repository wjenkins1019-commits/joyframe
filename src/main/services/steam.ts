import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ScanResult, SteamDetection } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { findBySource, getGame, insertGame, nowIso, updateGameRecord } from './repo.ts'
import type { ProgressEmitter } from './scanner.ts'

const execFileAsync = promisify(execFile)

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

/**
 * Minimal but tolerant Valve KeyValues (VDF/ACF) parser. Key names are
 * lower-cased, which is what all Steam lookups here rely on.
 */
export function parseVdf(text: string): VdfObject {
  let i = 0
  const n = text.length

  const skip = (): void => {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i += 1
        continue
      }
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i += 1
        continue
      }
      break
    }
  }

  const readString = (): string => {
    skip()
    if (text[i] === '"') {
      i += 1
      let out = ''
      while (i < n) {
        const c = text[i]
        if (c === '\\' && i + 1 < n) {
          const next = text[i + 1]
          if (next === 'n') out += '\n'
          else if (next === 't') out += '\t'
          else out += next
          i += 2
          continue
        }
        if (c === '"') {
          i += 1
          break
        }
        out += c
        i += 1
      }
      return out
    }
    let out = ''
    while (i < n && !/[\s{}]/.test(text[i])) {
      out += text[i]
      i += 1
    }
    return out
  }

  const parseObject = (): VdfObject => {
    const obj: VdfObject = {}
    while (i < n) {
      skip()
      if (i >= n) break
      if (text[i] === '}') {
        i += 1
        break
      }
      const key = readString().toLowerCase()
      if (!key) {
        i += 1
        continue
      }
      skip()
      if (text[i] === '{') {
        i += 1
        obj[key] = parseObject()
      } else {
        obj[key] = readString()
      }
    }
    return obj
  }

  skip()
  if (text[i] === '{') {
    i += 1
    return parseObject()
  }
  return parseObject()
}

export async function findSteamPath(customPath = ''): Promise<string> {
  if (customPath) {
    const normalized = customPath.replace(/[\\/]+$/, '')
    if (fs.existsSync(path.join(normalized, 'steamapps'))) return normalized
    if (fs.existsSync(path.join(normalized, 'SteamApps'))) return normalized
    if (fs.existsSync(normalized)) return normalized
  }
  const attempts: string[] = []
  if (process.platform === 'win32') {
    for (const hive of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try {
        const { stdout } = await execFileAsync('reg', ['query', hive, '/v', 'SteamPath'], { timeout: 6000 })
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
        if (match) attempts.push(match[1].trim().replace(/\//g, '\\'))
      } catch {
        /* registry key missing */
      }
    }
    const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const programFiles64 = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    attempts.push(
      path.join(programFiles, 'Steam'),
      path.join(programFiles64, 'Steam'),
      'C:\\Steam',
      'D:\\Steam',
      'C:\\SteamLibrary',
      'D:\\SteamLibrary'
    )
  }
  for (const candidate of attempts) {
    if (!candidate) continue
    if (fs.existsSync(path.join(candidate, 'steamapps')) || fs.existsSync(path.join(candidate, 'SteamApps'))) {
      return candidate.replace(/[\\/]+$/, '')
    }
  }
  return ''
}

export function steamAppsDir(steamPath: string): string {
  const lower = path.join(steamPath, 'steamapps')
  if (fs.existsSync(lower)) return lower
  const upper = path.join(steamPath, 'SteamApps')
  if (fs.existsSync(upper)) return upper
  return lower
}

export function readLibraryFolders(steamPath: string): string[] {
  const folders = new Set<string>([steamPath.replace(/[\\/]+$/, '')])
  const file = path.join(steamAppsDir(steamPath), 'libraryfolders.vdf')
  if (!fs.existsSync(file)) return [...folders]
  try {
    const parsed = parseVdf(fs.readFileSync(file, 'utf8'))
    const root = (parsed.libraryfolders ?? parsed.LibraryFolders ?? {}) as VdfObject
    for (const value of Object.values(root)) {
      if (typeof value === 'string') {
        if (value.includes(':') || value.startsWith('/')) folders.add(value.replace(/[\\/]+$/, ''))
      } else if (value && typeof value === 'object' && typeof value.path === 'string') {
        folders.add(value.path.replace(/[\\/]+$/, ''))
      }
    }
  } catch {
    /* malformed VDF — keep the main library */
  }
  return [...folders]
}

export interface SteamApp {
  appid: string
  name: string
  installdir: string
  libraryPath: string
  sizeOnDisk: number
  stateFlags: number
  installed: boolean
}

export function readInstalledApps(steamPath: string): { apps: SteamApp[]; libraries: string[] } {
  const libraries = readLibraryFolders(steamPath)
  const apps: SteamApp[] = []
  const skipIds = new Set(['228980', '1070560', '1391110', '1628350', '1826330'])

  for (const library of libraries) {
    const appsDir = steamAppsDir(library)
    if (!fs.existsSync(appsDir)) continue
    let files: string[] = []
    try {
      files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const file of files) {
      try {
        const parsed = parseVdf(fs.readFileSync(path.join(appsDir, file), 'utf8'))
        const state = (parsed.appstate ?? parsed.AppState ?? {}) as VdfObject
        const appid = String(state.appid ?? '')
        const name = String(state.name ?? '')
        const installdir = String(state.installdir ?? '')
        if (!appid || !name || skipIds.has(appid)) continue
        if (/steamworks common redistributables|steam linux runtime/i.test(name)) continue
        const sizeOnDisk = Number(state.sizeondisk ?? 0)
        const stateFlags = Number(state.stateflags ?? 0)
        const common = path.join(appsDir, 'common', installdir)
        const installed = fs.existsSync(common) || (stateFlags & 4) === 4
        apps.push({ appid, name, installdir, libraryPath: library, sizeOnDisk, stateFlags, installed })
      } catch {
        /* skip malformed manifest */
      }
    }
  }
  return { apps, libraries }
}

/** Locally recorded Steam playtime, keyed by appid (minutes). */
export function readLocalSteamPlaytime(steamPath: string): Map<string, { minutes: number; lastPlayed: number }> {
  const result = new Map<string, { minutes: number; lastPlayed: number }>()
  const userdata = path.join(steamPath, 'userdata')
  if (!fs.existsSync(userdata)) return result
  let accounts: string[] = []
  try {
    accounts = fs.readdirSync(userdata).filter((d) => /^\d+$/.test(d))
  } catch {
    return result
  }
  for (const account of accounts) {
    const file = path.join(userdata, account, 'config', 'localconfig.vdf')
    if (!fs.existsSync(file)) continue
    try {
      const parsed = parseVdf(fs.readFileSync(file, 'utf8'))
      const store = (parsed.userlocalconfigstore ?? parsed.UserLocalConfigStore ?? {}) as VdfObject
      const software = (store.software ?? {}) as VdfObject
      const valve = (software.valve ?? {}) as VdfObject
      const steam = (valve.steam ?? {}) as VdfObject
      const apps = (steam.apps ?? {}) as VdfObject
      for (const [appid, value] of Object.entries(apps)) {
        if (typeof value !== 'object' || !value) continue
        const minutes = Number(value.playtime ?? 0)
        const lastPlayed = Number(value.lastplayed ?? 0)
        if (minutes > 0 || lastPlayed > 0) result.set(appid, { minutes, lastPlayed })
      }
    } catch {
      /* skip unreadable config */
    }
  }
  return result
}

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

export function steamArtworkUrls(appid: string): { cover: string; background: string; logo: string } {
  return {
    cover: `${CDN}/${appid}/library_600x900.jpg`,
    background: `${CDN}/${appid}/library_hero.jpg`,
    logo: `${CDN}/${appid}/logo.png`
  }
}

export async function detectSteam(db: Db, customPath = ''): Promise<SteamDetection> {
  const steamPath = await findSteamPath(customPath)
  if (!steamPath) {
    return { found: false, steamPath: '', libraryFolders: [], installedCount: 0, totalCount: 0 }
  }
  const { apps, libraries } = readInstalledApps(steamPath)
  const imported = db.prepare("SELECT COUNT(*) AS c FROM games WHERE source = 'steam'").get() as { c: number }
  return {
    found: true,
    steamPath,
    libraryFolders: libraries,
    installedCount: apps.filter((a) => a.installed).length,
    totalCount: Math.max(imported.c, apps.length)
  }
}

export async function importSteamGames(
  db: Db,
  emit: ProgressEmitter,
  customPath = ''
): Promise<ScanResult & { steamPath: string }> {
  const started = Date.now()
  const errors: string[] = []
  const steamPath = await findSteamPath(customPath)
  if (!steamPath) {
    return {
      kind: 'steam',
      added: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      missing: 0,
      errors: ['Steam installation not found. Set the Steam folder in Settings.'],
      elapsedMs: Date.now() - started,
      steamPath: ''
    }
  }

  emit({ phase: 'start', kind: 'steam', scanned: 0, found: 0, message: 'Reading Steam library…' })
  const { apps } = readInstalledApps(steamPath)
  const playtimes = readLocalSteamPlaytime(steamPath)
  let added = 0
  let updated = 0
  let skipped = 0

  for (let index = 0; index < apps.length; index += 1) {
    const app = apps[index]
    emit({
      phase: 'matching',
      kind: 'steam',
      scanned: index,
      found: added,
      message: `Importing ${app.name}`,
      current: app.name
    })
    const art = steamArtworkUrls(app.appid)
    const play = playtimes.get(app.appid)
    const installDir = path.join(steamAppsDir(app.libraryPath), 'common', app.installdir)
    const existing = findBySource(db, 'steam', app.appid)

    if (existing) {
      const patch: Record<string, unknown> = {
        title: app.name,
        installed: app.installed,
        installDir
      }
      if (!existing.coverPath) patch.coverPath = art.cover
      if (!existing.backgroundPath) patch.backgroundPath = art.background
      if (play && play.minutes * 60 > existing.playtimeSeconds) {
        patch.playtimeSeconds = play.minutes * 60
      }
      if (play?.lastPlayed) {
        const iso = new Date(play.lastPlayed * 1000).toISOString()
        if (!existing.lastPlayed || new Date(iso) > new Date(existing.lastPlayed)) patch.lastPlayed = iso
      }
      updateGameRecord(db, existing.id, patch as never)
      updated += 1
    } else {
      insertGame(db, {
        title: app.name,
        platformId: 'windows',
        source: 'steam',
        sourceId: app.appid,
        installDir,
        installed: app.installed,
        coverPath: art.cover,
        backgroundPath: art.background,
        logoPath: art.logo,
        playtimeSeconds: play ? play.minutes * 60 : 0,
        lastPlayed: play?.lastPlayed ? new Date(play.lastPlayed * 1000).toISOString() : '',
        metadataProvider: 'steam',
        metadataConfidence: 1,
        extra: { metadataUpdatedAt: nowIso() }
      })
      added += 1
    }
  }

  db.prepare('INSERT OR IGNORE INTO library_paths (path, kind, added_at) VALUES (?,?,?)').run(
    steamPath,
    'steam',
    nowIso()
  )

  emit({
    phase: 'done',
    kind: 'steam',
    scanned: apps.length,
    found: added,
    message: `Steam import complete — ${added} added, ${updated} updated`,
    errors
  })

  return {
    kind: 'steam',
    added,
    updated,
    skipped,
    removed: 0,
    missing: 0,
    errors,
    elapsedMs: Date.now() - started,
    steamPath
  }
}

export function steamLaunchUrl(gameId: string, db: Db): string | null {
  const game = getGame(db, gameId)
  if (!game || game.source !== 'steam' || !game.sourceId) return null
  return `steam://rungameid/${game.sourceId}`
}
