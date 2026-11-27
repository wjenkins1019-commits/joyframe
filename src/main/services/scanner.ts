import fs from 'node:fs'
import path from 'node:path'
import type { Emulator, Game, ScanProgress, ScanResult } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { defaultRomOrder } from '../../shared/rom-formats.ts'
import { detectPlatform, platformById } from './platforms.ts'
import {
  findBySource,
  findDuplicate,
  insertGame,
  mergeGames,
  nowIso,
  rowToEmulator,
  rowToGame,
  uid,
  updateGameRecord
} from './repo.ts'

export type ProgressEmitter = (progress: ScanProgress) => void

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
    .replace(/\((USA|Europe|Japan|World|Rev [^)]*|v[0-9.]+|En|Fr|De|Es|It|Beta|Proto|Demo)[^)]*\)/gi, ' ')
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

/** True when a path's extension is one the ROM scanner imports. */
export function isRomFile(file: string): boolean {
  const ext = path.extname(file).slice(1).toLowerCase()
  return ROM_EXTENSIONS.has(ext)
}

export async function scanRomFolders(
  db: Db,
  paths: string[],
  emit: ProgressEmitter,
  shouldCancel?: () => boolean,
  preferences: Record<string, string[]> = {}
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

  emit({ phase: 'start', kind: 'rom', scanned: 0, found: 0, message: 'Scanning ROM folders…' })

  for (const root of paths) {
    if (!fs.existsSync(root)) {
      errors.push(`Folder not found: ${root}`)
      continue
    }
    markLibraryPath(db, root, 'rom')

    let pending: { file: string; platformId: string; title: string; size: number }[] = []

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
      const match = variantKey(title).match(/(disc|disk|cd|part)\d+/)
      return match ? match[0] : 'single'
    }
    // A sidecar file keeps the folder's name up front and adds a marker
    // (update, DLC, track/disc number …); anything else is another game.
    const SIDECAR_RE = /^(update|dlc|patch|track|disc|disk|cd|part|demo|beta|proto|v\d|\d)/
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

    for (const item of pending) {
      if (shouldCancel?.()) break
      const existing = findBySource(db, 'rom-scan', item.file)
      if (existing) {
        skipped += 1
        continue
      }
      const emulator = findEmulatorForPlatform(db, item.platformId)
      insertGame(db, {
        title: titleCase(item.title),
        platformId: item.platformId,
        source: 'rom-scan',
        sourceId: item.file,
        romPath: item.file,
        installDir: path.dirname(item.file),
        emulatorId: emulator?.id ?? null,
        emulatorCore: emulator?.core ?? '',
        installed: true
      })
      added += 1
      if (added % 10 === 0) {
        emit({
          phase: 'saving',
          kind: 'rom',
          scanned,
          found: added,
          message: `Indexed ${added} ROMs…`,
          current: item.file
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
      const onDisk = fs.existsSync(file)
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
