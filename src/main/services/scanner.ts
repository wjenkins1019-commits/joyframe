import fs from 'node:fs'
import path from 'node:path'
import type { Emulator, Game, ScanProgress, ScanResult } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { detectPlatform } from './platforms.ts'
import { findBySource, findDuplicate, insertGame, nowIso, rowToEmulator, uid } from './repo.ts'

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

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\.(exe|iso|bin|cue|chd|zip|7z|nes|sfc|smc|n64|z64|gba|gbc|gb|nds|3ds|cia|rvz|gcm|wbfs|gdi|cdi|md|gen|smd|sms|gg|pce|a26|a78|j64|d64|t64|prg|tap|vpk|cso|pbp|xex|xiso)$/i, '')
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
  return { kind: 'pc', added, updated, skipped, errors, elapsedMs: Date.now() - started }
}

const ROM_EXTENSIONS = new Set([
  'nes', 'unf', 'fds', 'sfc', 'smc', 'fig', 'swc', 'n64', 'z64', 'v64', 'ndd',
  'gcm', 'rvz', 'gcz', 'dol', 'wbfs', 'wad', 'wud', 'wux', 'rpx', 'nsp', 'xci',
  'gb', 'gbc', 'gba', 'agb', 'nds', 'dsi', '3ds', 'cci', 'cia',
  'iso', 'chd', 'cso', 'pbp', 'pkg', 'vpk', 'xiso', 'xex',
  'gdi', 'cdi', 'dat', 'md', 'gen', 'smd', '32x', 'sms', 'gg',
  'a26', 'a78', 'j64', 'jag', 'pce', 'sgx', 'd64', 't64', 'crt', 'prg', 'tap',
  'zip', '7z', 'ccd', 'm3u', 'cue', 'bin', 'img'
])

export async function scanRomFolders(
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

  emit({ phase: 'start', kind: 'rom', scanned: 0, found: 0, message: 'Scanning ROM folders…' })

  for (const root of paths) {
    if (!fs.existsSync(root)) {
      errors.push(`Folder not found: ${root}`)
      continue
    }
    markLibraryPath(db, root, 'rom')

    let pending: { file: string; platformId: string; title: string }[] = []

    await walk(
      root,
      6,
      (entry) => {
        scanned += 1
        const ext = path.extname(entry.file).slice(1).toLowerCase()
        if (!ROM_EXTENSIONS.has(ext)) return
        const lower = entry.file.toLowerCase()
        if (lower.includes('.uninstall') || lower.includes('bios') || lower.includes('firmware')) return
        const title = cleanTitle(path.basename(entry.file))
        if (!title || title.length < 2) return
        const platformId = detectPlatform(entry.file)
        if (!platformId) {
          skipped += 1
          return
        }
        pending.push({ file: entry.file, platformId, title })
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
    // Release memory between roots.
    pending = []
  }

  emit({
    phase: 'done',
    kind: 'rom',
    scanned,
    found: added,
    message: `ROM scan complete — ${added} added, ${skipped} skipped`,
    errors
  })
  return { kind: 'rom', added, updated, skipped, errors, elapsedMs: Date.now() - started }
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
