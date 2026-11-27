import fs from 'node:fs'
import path from 'node:path'
import type { Emulator, Game, ScanProgress, ScanResult } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { defaultRomOrder } from '../../shared/rom-formats.ts'
import { detectPlatform, platformById } from './platforms.ts'
import {
  findBySource,
  findDuplicate,
  getGame,
  insertGame,
  mergeGames,
  nowIso,
  rowToEmulator,
  rowToGame,
  uid,
  updateGameRecord
} from './repo.ts'

export type ProgressEmitter = (progress: ScanProgress) => void

/**
 * Hooks the app layers onto a ROM scan. `beforeFirstMerge` runs once, just
 * before the scan would permanently fold one library entry into another —
 * the app uses it to snapshot the database, so a mis-grouped multi-disc set
 * can be restored. If the hook throws, the scan stops before changing
 * anything and reports the failure in `errors`.
 */
export interface RomScanHooks {
  beforeFirstMerge?: () => void | Promise<void>
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$recycle.bin',
  'system volume information',
  'windows',
  'winsxs',
  'appdata',
  'redist',
  '_commonredist',
  'directx',
  'vcredist',
  'support',
  'steamworks shared',
  'logs',
  'cache',
  'temp',
  'tmp',
  'installers',
  'uninstall'
])

const NON_GAME_EXE =
  /(unins|uninstall|setup|installer|vc_?redist|vcredist|dxsetup|dxwebsetup|directx|dotnet|crash|report|helper|easyanticheat|battleye|touchup|update|patcher|launcherhelper|steamerrorreporter|editor)/i

interface WalkEntry {
  file: string
  size: number
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function walk(
  root: string,
  maxDepth: number,
  onFile: (entry: WalkEntry, depth: number) => boolean | void,
  onDir?: (dir: string, depth: number) => void,
  shouldCancel?: () => boolean
): Promise<void> {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let processed = 0
  while (queue.length) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number }
    if (shouldCancel?.()) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    onDir?.(dir, depth)
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue
        const lower = entry.name.toLowerCase()
        if (SKIP_DIRS.has(lower) || entry.name.startsWith('.')) continue
        queue.push({ dir: full, depth: depth + 1 })
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = fs.statSync(full).size
        } catch {
          continue
        }
        onFile({ file: full, size }, depth)
        processed += 1
        if (processed % 400 === 0) await yieldToLoop()
      }
    }
    if (processed % 2000 === 0) await yieldToLoop()
  }
}

const TITLE_EXTENSIONS =
  /\.(exe|iso|bin|cue|chd|zip|7z|nes|sfc|smc|n64|z64|gba|gbc|gb|nds|3ds|cia|rvz|gcm|wbfs|gdi|cdi|md|gen|smd|sms|gg|pce|a26|a78|j64|jag|rom|d64|t64|prg|tap|vpk|cso|pbp|xex|xiso|nsp|nsz|xci|wud|wux|rpx|gcz|wad|cci|pkg|dat|dosz|gz|dec)$/i

export function cleanTitle(raw: string): string {
  // Loop, so a compound name like `Foo.iso.gz` loses every stacked extension
  // instead of keeping `.iso` in the title.
  let title = raw
  while (TITLE_EXTENSIONS.test(title)) title = title.replace(TITLE_EXTENSIONS, '')
  return title
    .replace(/\[(.*?)\]/g, ' ')
    // A region/revision tag must stand alone as a token: without the boundary
    // check `(Deluxe Edition)` would lose its `De` prefix and vanish.
    .replace(/\((USA|Europe|Japan|World|Rev [^)]*|v[0-9.]+|En|Fr|De|Es|It|Beta|Proto|Demo)(?=[\s,)])[^)]*\)/gi, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/, '')
    .trim()
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'a', 'an', 'for', 'vs', 'or', 'de'])

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((word, index) => {
      if (!word) return word
      if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase()
      if (word.length <= 2) return word
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * A game that already uses this file as one of its discs. Scanning after a
 * disc was deleted must not create a second card for the remaining discs.
 */
function findByDiscTarget(db: Db, file: string): Game | null {
  const row = db.prepare(`SELECT game_id FROM launch_methods WHERE kind = 'rom' AND target = ?`).get(file) as
    | { game_id: string }
    | undefined
  return row ? getGame(db, row.game_id) : null
}

function findEmulatorForPlatform(db: Db, platformId: string): Emulator | null {
  const emulators = (db.prepare('SELECT * FROM emulators ORDER BY detected DESC, name ASC').all() as Record<
    string,
    unknown
  >[]).map(rowToEmulator)
  return emulators.find((e) => e.platformIds.includes(platformId)) ?? null
}

function markLibraryPath(db: Db, dir: string, kind: 'pc' | 'rom'): void {
  db.prepare('INSERT OR IGNORE INTO library_paths (path, kind, added_at) VALUES (?,?,?)').run(dir, kind, nowIso())
  db.prepare('DELETE FROM discovered_files WHERE kind = ? AND path LIKE ?').run(kind, `${dir}%`)
}

export async function scanPcFolders(
  db: Db,
  paths: string[],
  emit: ProgressEmitter,
  shouldCancel?: () => boolean
): Promise<ScanResult> {
  const started = Date.now()
  const errors: string[] = []
  let scanned = 0
  let added = 0
  let updated = 0
  let skipped = 0

  emit({ phase: 'start', kind: 'pc', scanned: 0, found: 0, message: 'Scanning folders for PC games…' })

  for (const root of paths) {
    if (!fs.existsSync(root)) {
      errors.push(`Folder not found: ${root}`)
      continue
    }
    markLibraryPath(db, root, 'pc')
    const candidates = new Map<string, WalkEntry[]>()

    await walk(
      root,
      4,
      (entry) => {
        scanned += 1
        const name = path.basename(entry.file)
        const dir = path.dirname(entry.file)
        if (!name.toLowerCase().endsWith('.exe')) return
        if (NON_GAME_EXE.test(name)) return
        if (entry.size < 150_000) return
        const list = candidates.get(dir) ?? []
        list.push(entry)
        candidates.set(dir, list)
        if (scanned % 25 === 0) {
          emit({
            phase: 'scanning',
            kind: 'pc',
            scanned,
            found: candidates.size,
            message: `Scanning… ${candidates.size} game folders found`,
            current: entry.file
          })
        }
      },
      undefined,
      shouldCancel
    )

    for (const [dir, exes] of candidates.entries()) {
      if (shouldCancel?.()) break
      // Prefer the executable whose name best matches the folder, then the largest binary.
      const folderName = path.basename(dir)
      const best =
        exes.find((e) => cleanTitle(path.basename(e.file)).toLowerCase() === folderName.toLowerCase()) ??
        [...exes].sort((a, b) => b.size - a.size)[0]
      if (!best) continue

      const title = titleCase(cleanTitle(folderName) || cleanTitle(path.basename(best.file)))
      if (!title || title.length < 2) continue

      const existing = findDuplicate(db, title, 'windows', dir) ?? findBySource(db, 'pc-scan', best.file)
      if (existing) {
        if (!existing.executable) {
          db.prepare('UPDATE games SET executable = ?, install_dir = ?, installed = 1 WHERE id = ?').run(
            best.file,
            dir,
            existing.id
          )
          updated += 1
        } else {
          skipped += 1
        }
        continue
      }

      insertGame(db, {
        title,
        platformId: 'windows',
        source: 'pc-scan',
        sourceId: best.file,
        executable: best.file,
        installDir: dir,
        installed: true
      })
      added += 1
      emit({
        phase: 'scanning',
        kind: 'pc',
        scanned,
        found: added,
        message: `Added ${title}`,
        current: best.file
      })
    }
  }

  emit({
    phase: 'done',
    kind: 'pc',
    scanned,
    found: added,
    message: `PC scan complete — ${added} added, ${updated} updated, ${skipped} already in library`,
    errors
  })
  return { kind: 'pc', added, updated, skipped, removed: 0, missing: 0, errors, elapsedMs: Date.now() - started }
}

const ARCHIVE_EXTENSIONS = new Set(['zip', '7z'])

/** A user override wins; otherwise the platform's built-in order applies. */
export function effectiveRomOrder(
  platformId: string,
  preferences: Record<string, string[]> = {}
): string[] {
  const override = preferences[platformId]
  if (override?.length) return override
  return defaultRomOrder(platformId, platformById(platformId)?.extensions ?? [])
}

/** Lower is better; ties are broken by file size so a full dump beats a stub. */
function variantRank(file: string, platformId: string, preferences: Record<string, string[]>): number {
  const ext = path.extname(file).slice(1).toLowerCase()
  const preferred = effectiveRomOrder(platformId, preferences)
  const index = preferred.indexOf(ext)
  if (index !== -1) return index
  const archivePenalty = ARCHIVE_EXTENSIONS.has(ext) ? 50 : 0
  return preferred.length + archivePenalty
}

/** Compare two files for the same game; negative means `left` is preferred. */
function compareVariants(
  left: { file: string; platformId: string; size: number },
  right: { file: string; platformId: string; size: number },
  preferences: Record<string, string[]>
): number {
  const rank =
    variantRank(left.file, left.platformId, preferences) - variantRank(right.file, right.platformId, preferences)
  return rank !== 0 ? rank : right.size - left.size
}

/** Format-agnostic identity for dedupe: the cleaned title with punctuation removed. */
function variantKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Every extension the scanner imports. The platform catalogue's `extensions`
 * mostly mirrors this list, and a smoke check keeps the two in step — a format
 * only in the catalogue would never reach the import step.
 */
export const ROM_EXTENSIONS = new Set([
  'nes', 'unf', 'fds', 'sfc', 'smc', 'fig', 'swc', 'n64', 'z64', 'v64', 'ndd',
  'gcm', 'rvz', 'gcz', 'dol', 'wbfs', 'wad', 'wud', 'wux', 'rpx', 'nsp', 'nsz', 'xci',
  'gb', 'gbc', 'gba', 'agb', 'nds', 'dsi', '3ds', 'cci', 'cia',
  'iso', 'chd', 'cso', 'pbp', 'pkg', 'vpk', 'xiso', 'xex', 'gz', 'dec',
  'gdi', 'cdi', 'dat', 'md', 'gen', 'smd', '32x', 'sms', 'gg',
  'a26', 'a78', 'j64', 'jag', 'rom', 'pce', 'sgx', 'd64', 't64', 'crt', 'prg', 'tap',
  'dosz', 'zip', '7z', 'ccd', 'm3u', 'cue', 'bin', 'img'
])

/**
 * Platform extensions that are not game files, so the scan skips them on
 * purpose: DOSBox `.conf` and `.bat` are launch configurations, not ROMs.
 * Kept explicit so the catalogue/scan consistency check can allow them.
 */
export const NON_ROM_EXTENSIONS = new Set(['conf', 'bat'])

/**
 * True when a path is a ROM the scanner imports. `.gz` is only a ROM when it
 * wraps a disc image — a stray `backup.tar.gz` is not a PS2 game.
 */
function isRomFile(file: string): boolean {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!ROM_EXTENSIONS.has(ext)) return false
  if (ext === 'gz') return /\.(iso|bin|img|cue|cdi)\.gz$/i.test(file)
  return true
}

interface ScanItem {
  file: string
  platformId: string
  title: string
  size: number
}

/** A library entry to create: one file, or several discs of one game. */
interface ScanUnit {
  title: string
  files: ScanItem[]
}

// `part` is deliberately absent: "(Part 1)" and "(Part 2)" are usually
// separate releases, not discs of one game.
const DISC_MARKER = /\((?:disc|disk|cd)\s*\d+[^)]*\)/gi
// The same marker without brackets: `Game CD1`, `Game cd2`, `Game - Disc 3`.
// A single digit only, so `WipEout CD32` keeps its name.
const BARE_DISC_MARKER = /(?:^|[\s._-]+)(?:disc|disk|cd)[\s._-]*[1-9](?!\d)/gi

/** `Final Fantasy IX (Disc 2)` / `Final Fantasy IX CD2` → `Final Fantasy IX`. */
function baseTitle(title: string): string {
  return title
    .replace(DISC_MARKER, ' ')
    .replace(BARE_DISC_MARKER, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s._-]+$/, '')
    .trim()
}

/** `Final Fantasy IX (Disc 2)` → `Disc 2`. */
function discLabel(title: string): string {
  return `Disc ${discNumber(title)}`
}

function discNumber(title: string): number {
  const bracketed = title.match(/\((?:disc|disk|cd)\s*(\d+)/i)
  if (bracketed) return Number(bracketed[1])
  // Bare markers are limited to one digit, so an Amiga `CD32` is not disc 32.
  const bare = title.match(/(?:^|[\s._-])(?:disc|disk|cd)[\s._-]*([1-9])(?!\d)/i)
  return bare ? Number(bare[1]) : 0
}

/**
 * One entry per game: files that only differ by their disc marker and share a
 * folder and platform become a single unit with one file per disc. Everything
 * else stays one unit per file, so collection folders are untouched.
 */
function groupScanUnits(items: ScanItem[]): ScanUnit[] {
  const groups = new Map<string, ScanItem[]>()
  for (const item of items) {
    const base = baseTitle(item.title)
    const key =
      discNumber(item.title) > 0
        ? `${item.platformId}|${path.dirname(item.file).toLowerCase()}|${variantKey(base)}`
        : `${item.platformId}|${path.dirname(item.file).toLowerCase()}|#${item.file.toLowerCase()}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return [...groups.values()].flatMap((files): ScanUnit[] => {
    const discs = files.filter((item) => discNumber(item.title) > 0)
    // Only call it a set when the disc numbers actually differ; two files that
    // merely share a base title stay separate games rather than being dropped.
    const isSet = discs.length > 1 && new Set(discs.map((item) => discNumber(item.title))).size > 1
    if (!isSet) return files.map((item) => ({ title: item.title, files: [item] }))
    const ordered = [...files].sort((left, right) => discNumber(left.title) - discNumber(right.title))
    return [{ title: baseTitle(ordered[0].title), files: ordered }]
  })
}

/**
 * Give a multi-disc game one `rom` method per disc. The rows are left exactly
 * as they are when the disc list already matches, so a rescan does not churn
 * ids or clobber a per-disc edit; only a changed set is rebuilt, keeping the
 * default disc and any non-disc default the user chose.
 */
function syncDiscMethods(db: Db, game: Game, files: ScanItem[], emulator: Emulator | null): void {
  const existing = db
    .prepare(`SELECT target, is_default FROM launch_methods WHERE game_id = ? AND kind = 'rom'`)
    .all(game.id) as { target: string; is_default: number }[]
  const targets = existing.map((row) => row.target)
  if (targets.length === files.length && files.every((item) => targets.includes(item.file))) return

  const chosen = existing.find((row) => Number(row.is_default) === 1)?.target
  const otherDefault = db
    .prepare(`SELECT 1 FROM launch_methods WHERE game_id = ? AND is_default = 1 AND kind <> 'rom'`)
    .get(game.id)
  db.prepare(`DELETE FROM launch_methods WHERE game_id = ? AND kind = 'rom'`).run(game.id)
  const insert = db.prepare(
    'INSERT INTO launch_methods (id, game_id, label, kind, target, args, emulator_id, core, is_default) VALUES (?,?,?,?,?,?,?,?,?)'
  )
  const defaultFile = chosen && files.some((item) => item.file === chosen) ? chosen : files[0].file
  for (const item of files) {
    insert.run(
      uid(),
      game.id,
      discLabel(item.title),
      'rom',
      item.file,
      '',
      emulator?.id ?? null,
      emulator?.core ?? '',
      !otherDefault && item.file === defaultFile ? 1 : 0
    )
  }
}

export async function scanRomFolders(
  db: Db,
  paths: string[],
  emit: ProgressEmitter,
  shouldCancel?: () => boolean,
  preferences: Record<string, string[]> = {},
  hooks: RomScanHooks = {}
): Promise<ScanResult> {
  const started = Date.now()
  const errors: string[] = []
  let scanned = 0
  let added = 0
  let updated = 0
  let skipped = 0
  let removed = 0
  let missing = 0
  let restored = 0
  let mergeGuarded = false

  // The first permanent fold of a scan is the risky one: once entries merge,
  // only a backup can undo a mis-grouped set. Ask the app to snapshot the
  // database exactly once, and stop before touching anything if it fails.
  const ensureMergeBackup = async (): Promise<boolean> => {
    if (mergeGuarded) return true
    mergeGuarded = true
    if (!hooks.beforeFirstMerge) return true
    try {
      await hooks.beforeFirstMerge()
      emit({
        phase: 'matching',
        kind: 'rom',
        scanned,
        found: 0,
        message: 'Library backup saved before merging entries…'
      })
      return true
    } catch (error) {
      errors.push(
        `Library backup failed, so the rescan stopped before changing any entries: ${(error as Error).message}`
      )
      return false
    }
  }

  const finish = (): ScanResult => {
    emit({
      phase: 'done',
      kind: 'rom',
      scanned,
      found: added,
      message: `ROM scan complete — ${added} added, ${skipped} skipped (duplicate formats and sidecar files kept out)${removed > 0 ? `, ${removed} stale sidecar${removed === 1 ? '' : 's'} folded into surviving games` : ''}${missing > 0 ? `, ${missing} ROM${missing === 1 ? '' : 's'} missing from disk` : ''}${restored > 0 ? `, ${restored} back on disk` : ''}`,
      errors
    })
    return { kind: 'rom', added, updated, skipped, removed, missing, errors, elapsedMs: Date.now() - started }
  }

  emit({ phase: 'start', kind: 'rom', scanned: 0, found: 0, message: 'Scanning ROM folders…' })

  for (const root of paths) {
    if (!fs.existsSync(root)) {
      errors.push(`Folder not found: ${root}`)
      continue
    }
    markLibraryPath(db, root, 'rom')

    let pending: ScanItem[] = []

    await walk(
      root,
      6,
      (entry) => {
        scanned += 1
        if (!isRomFile(entry.file)) return
        const lower = entry.file.toLowerCase()
        if (lower.includes('.uninstall') || lower.includes('bios') || lower.includes('firmware')) return
        const title = cleanTitle(path.basename(entry.file))
        if (!title || title.length < 2) return
        const platformId = detectPlatform(entry.file)
        if (!platformId) {
          skipped += 1
          return
        }
        pending.push({ file: entry.file, platformId, title, size: entry.size })
        if (scanned % 30 === 0) {
          emit({
            phase: 'scanning',
            kind: 'rom',
            scanned,
            found: pending.length,
            message: `Scanning ROMs… ${pending.length} found`,
            current: entry.file
          })
        }
      },
      undefined,
      shouldCancel
    )

    // CUE/BIN pairs: prefer the .cue sheet, skip its companion .bin.
    const cueBases = new Set(
      pending.filter((p) => p.file.toLowerCase().endsWith('.cue')).map((p) => p.file.slice(0, -4).toLowerCase())
    )
    pending = pending.filter(
      (p) => !(p.file.toLowerCase().endsWith('.bin') && cueBases.has(p.file.slice(0, -4).toLowerCase()))
    )

    // One entry per game per folder: a title present as .xci, .nsp and .nsz
    // imports once, in the preferred format, instead of three times.
    const bestVariants = new Map<string, { file: string; platformId: string; title: string; size: number }>()
    let variantsSkipped = 0
    for (const item of pending) {
      const key = `${item.platformId}|${path.dirname(item.file).toLowerCase()}|${variantKey(item.title)}`
      const current = bestVariants.get(key)
      if (!current) {
        bestVariants.set(key, item)
        continue
      }
      if (compareVariants(item, current, preferences) < 0) {
        bestVariants.set(key, item)
      }
      variantsSkipped += 1
    }
    pending = [...bestVariants.values()]
    skipped += variantsSkipped

    // Single-game folders: a directory named after its game (e.g. `Hades/`
    // holding the ROM plus update/DLC/track sidecars) imports one ROM — the
    // disc sheet (.cue/.m3u) when the folder has one, otherwise the largest
    // file, which is usually the game itself. Each disc of a multi-disc set
    // still imports. Collection folders whose name matches no title keep
    // every game.
    const SHEET_EXTENSIONS = new Set(['cue', 'm3u'])
    const discGroup = (title: string): string => {
      const match = variantKey(title).match(/(disc|disk|cd)\d+/)
      return match ? match[0] : 'single'
    }
    // A sidecar file keeps the folder's name up front and adds a marker
    // (update, DLC, track/disc number …); anything else is another game.
    const SIDECAR_RE = /^(update|dlc|patch|track|disc|disk|cd|demo|beta|proto|v\d|\d)/
    const relatesToFolder = (title: string, folderKey: string): boolean => {
      const key = variantKey(title)
      if (key === folderKey) return true
      return key.startsWith(folderKey) && SIDECAR_RE.test(key.slice(folderKey.length))
    }
    const byFolder = new Map<string, typeof pending>()
    for (const item of pending) {
      const key = `${item.platformId}|${path.dirname(item.file).toLowerCase()}`
      const list = byFolder.get(key) ?? []
      list.push(item)
      byFolder.set(key, list)
    }
    let folderSkipped = 0
    pending = [...byFolder.values()].flatMap((items) => {
      if (items.length < 2) return items
      const folderKey = variantKey(path.basename(path.dirname(items[0].file)))
      if (!items.some((item) => variantKey(item.title) === folderKey)) return items
      // Collapse only the files that belong to the folder's game; an
      // unrelated game sharing the folder still imports on its own.
      const related = items.filter((item) => relatesToFolder(item.title, folderKey))
      const unrelated = items.filter((item) => !relatesToFolder(item.title, folderKey))
      const winners = new Map<string, (typeof items)[number]>()
      for (const item of related) {
        const group = discGroup(item.title)
        const current = winners.get(group)
        if (!current) {
          winners.set(group, item)
          continue
        }
        const itemIsSheet = SHEET_EXTENSIONS.has(path.extname(item.file).slice(1).toLowerCase())
        const currentIsSheet = SHEET_EXTENSIONS.has(path.extname(current.file).slice(1).toLowerCase())
        if (itemIsSheet !== currentIsSheet ? itemIsSheet : item.size > current.size) {
          winners.set(group, item)
        }
        folderSkipped += 1
      }
      return [...winners.values(), ...unrelated]
    })
    skipped += folderSkipped
    const extrasSkipped = variantsSkipped + folderSkipped
    if (extrasSkipped > 0) {
      emit({
        phase: 'matching',
        kind: 'rom',
        scanned,
        found: pending.length,
        message: `Skipped ${extrasSkipped} extra file${extrasSkipped === 1 ? '' : 's'} — keeping one ROM per game`
      })
    }

    // Multi-disc sets: discs of one game in one folder import as a single
    // library entry carrying a launch method per disc, so one cover, one
    // playtime and one favourite cover the whole game.
    const units = groupScanUnits(pending)

    for (const unit of units) {
      if (shouldCancel?.()) break
      const primary = unit.files[0]
      const emulator = findEmulatorForPlatform(db, primary.platformId)
      // A disc can match the same game twice (its first file is the entry's
      // source, the others are its disc methods), so collapse by game id.
      const entries = [
        ...new Map(
          unit.files
            .map((item) => findBySource(db, 'rom-scan', item.file) ?? findByDiscTarget(db, item.file))
            .filter((game): game is Game => Boolean(game))
            .map((game) => [game.id, game] as const)
        ).values()
      ]

      if (entries.length) {
        let survivor = entries[0]
        // Migration: a library scanned by an older build has one entry per
        // disc. Fold the extra discs into the first, which keeps the summed
        // playtime and the merged metadata, then give it a method per disc.
        // The first fold of a scan is guarded: the app snapshots the
        // database before anything is permanently rewritten.
        for (const duplicate of entries.slice(1)) {
          if (!(await ensureMergeBackup())) return finish()
          survivor = mergeGames(db, survivor.id, duplicate.id)
        }
        if (unit.files.length > 1) {
          syncDiscMethods(db, survivor, unit.files, emulator)
          // An entry carried over from a per-disc scan still says "(Disc 1)";
          // a title the user edited is left exactly as they wrote it.
          if (discNumber(survivor.title) > 0) {
            survivor = updateGameRecord(db, survivor.id, { title: titleCase(unit.title) })
          }
        }
        skipped += 1
        continue
      }

      const game = insertGame(db, {
        title: titleCase(unit.title),
        platformId: primary.platformId,
        source: 'rom-scan',
        sourceId: primary.file,
        romPath: primary.file,
        installDir: path.dirname(primary.file),
        emulatorId: emulator?.id ?? null,
        emulatorCore: emulator?.core ?? '',
        installed: true
      })
      if (unit.files.length > 1) syncDiscMethods(db, game, unit.files, emulator)
      added += 1
      if (added % 10 === 0) {
        emit({
          phase: 'saving',
          kind: 'rom',
          scanned,
          found: added,
          message: `Indexed ${added} ROMs…`,
          current: primary.file
        })
        await yieldToLoop()
      }
    }
    // Fold stale sidecar entries left by older scans into the surviving game,
    // so rescanning cleans the library without losing playtime or metadata.
    // Only entries that relate to a single-game folder's kept ROM qualify —
    // anything else in the library is left alone.
    const winnerFiles = new Set(pending.map((item) => item.file.toLowerCase()))
    const rootPrefix = root.toLowerCase()
    const library = db.prepare(`SELECT * FROM games WHERE source = 'rom-scan'`).all() as Record<string, unknown>[]
    for (const row of library) {
      const stale = rowToGame(row)
      const staleFile = (stale.sourceId || stale.romPath).toLowerCase()
      if (!staleFile || winnerFiles.has(staleFile)) continue
      const staleDir = path.dirname(staleFile)
      if (!staleFile.startsWith(rootPrefix) && !stale.installDir.toLowerCase().startsWith(rootPrefix)) continue
      const folderKey = variantKey(path.basename(staleDir))
      if (!relatesToFolder(stale.title, folderKey)) continue
      const survivor = pending.find(
        (item) =>
          path.dirname(item.file).toLowerCase() === staleDir.toLowerCase() &&
          item.platformId === stale.platformId &&
          variantKey(item.title) === folderKey &&
          discGroup(item.title) === discGroup(stale.title)
      )
      const survivorGame = survivor ? findBySource(db, 'rom-scan', survivor.file) : null
      if (!survivor || !survivorGame || survivorGame.id === stale.id) continue
      if (!(await ensureMergeBackup())) return finish()
      mergeGames(db, survivorGame.id, stale.id)
      removed += 1
    }

    // Entries whose ROM file is gone are marked missing — never deleted — so
    // playtime, metadata and notes survive a moved folder or unplugged drive.
    // The check runs against the filesystem, so an entry the scan skipped
    // (e.g. an ambiguous platform) is not mistaken for a missing one, and a
    // file that comes back clears the flag on the next rescan.
    // A cancelled scan only saw part of the tree: flagging on that view would
    // mark everything it never reached as missing.
    const alive = new Set(
      (db.prepare(`SELECT id FROM games WHERE source = 'rom-scan'`).all() as { id: string }[]).map((row) => row.id)
    )
    for (const row of shouldCancel?.() ? [] : library) {
      const game = rowToGame(row)
      if (!alive.has(game.id)) continue // folded into a survivor above
      const file = game.sourceId || game.romPath
      if (!file) continue
      if (!file.toLowerCase().startsWith(rootPrefix) && !game.installDir.toLowerCase().startsWith(rootPrefix)) continue
      // A multi-disc game is only missing when none of its discs is on disk.
      let onDisk = fs.existsSync(file)
      if (!onDisk) {
        const discs = db
          .prepare(`SELECT target FROM launch_methods WHERE game_id = ? AND kind = 'rom'`)
          .all(game.id) as { target: string }[]
        onDisk = discs.some((disc) => disc.target && fs.existsSync(disc.target))
      }
      const flagged = Boolean(game.extra.missingRom)
      if (!onDisk && !flagged) {
        updateGameRecord(db, game.id, { installed: false, extra: { ...game.extra, missingRom: true } })
        missing += 1
      } else if (onDisk && flagged) {
        updateGameRecord(db, game.id, { installed: true, extra: { ...game.extra, missingRom: false } })
        restored += 1
      }
    }
    // Release memory between roots.
    pending = []
  }

  return finish()
}

/** Best-effort enrichment of ROM metadata from the filename. */
export function romRegionFromName(name: string): string {
  const match = name.match(/\((USA|Europe|Japan|World|Asia)[^)]*\)/i)
  return match ? match[1] : ''
}

export function totalLibraryPaths(db: Db): { path: string; kind: string }[] {
  return db.prepare('SELECT path, kind FROM library_paths ORDER BY added_at ASC').all() as {
    path: string
    kind: string
  }[]
}

export type ScanGame = Game

export { uid }
