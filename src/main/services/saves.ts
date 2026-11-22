import fs from 'node:fs'
import path from 'node:path'
import type { GameSave } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { listEmulators } from './emulators.ts'
import { nowIso, rowToGame, rowToSave } from './repo.ts'

const STATE_EXTENSIONS = new Set([
  'state', 'st0', 'st1', 'st2', 'st3', 'st4', 'st5', 'st6', 'st7', 'st8', 'st9',
  'ss0', 'ss1', 'ss2', 'ss3', 'ss4', 'ss5', 'ss6', 'ss7', 'ss8', 'ss9',
  'sav', 'srm', 'dsv', 'mcd', 'ps2', 'rtc', 'eep', 'fla', 'mpk', 'gci', 'sa1', 'sav0'
])

function classify(ext: string, inStateDir: boolean): GameSave['kind'] {
  if (/^(state\d*|st\d|ss\d)$/.test(ext) || inStateDir) return 'emulator-state'
  return 'native'
}

function isSaveFile(ext: string): boolean {
  return STATE_EXTENSIONS.has(ext) || /^state\d+$/.test(ext)
}

function slotFromName(name: string): string {
  const match = name.match(/\.(?:state|st|ss|sav)(\d+)$/i)
  return match ? match[1] : ''
}

function collectFiles(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) collectFiles(full, depth - 1, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
}

/**
 * Discover save states and native battery saves for ROM games. This never
 * writes to or modifies save files — it only indexes what already exists.
 */
export async function scanSaves(db: Db): Promise<{ found: number }> {
  const games = (db.prepare("SELECT * FROM games WHERE rom_path <> '' AND hidden = 0").all() as Record<
    string,
    unknown
  >[]).map(rowToGame)
  const emulators = listEmulators(db)
  const upsert = db.prepare(
    `INSERT INTO game_saves (id, game_id, kind, slot, path, label, timestamp, size_bytes, emulator_id)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET timestamp = excluded.timestamp, size_bytes = excluded.size_bytes,
       label = excluded.label, slot = excluded.slot`
  )

  let found = 0
  for (const game of games) {
    if (!game.romPath || !fs.existsSync(game.romPath)) continue
    const emulator = emulators.find((e) => e.id === game.emulatorId) ?? null
    const romBase = path.basename(game.romPath, path.extname(game.romPath)).toLowerCase()
    if (romBase.length < 2) continue

    const dirs = new Map<string, boolean>()
    dirs.set(path.dirname(game.romPath), false)
    if (emulator) {
      const installDir = path.dirname(emulator.path)
      if (emulator.saveStateDir) dirs.set(emulator.saveStateDir, true)
      dirs.set(path.join(installDir, 'states'), true)
      dirs.set(path.join(installDir, 'saves'), false)
      dirs.set(path.join(installDir, 'sstates'), true)
      dirs.set(path.join(installDir, 'memcards'), false)
      dirs.set(path.join(installDir, 'memstick', 'PSP', 'SAVEDATA'), false)
    }

    for (const [dir, isStateDir] of dirs.entries()) {
      if (!fs.existsSync(dir)) continue
      const files: string[] = []
      collectFiles(dir, 2, files)
      for (const file of files) {
        const ext = path.extname(file).slice(1).toLowerCase()
        if (!isSaveFile(ext)) continue
        const name = path.basename(file).toLowerCase()
        if (!name.includes(romBase.slice(0, Math.min(romBase.length, 24))) && name !== `${romBase}.${ext}`) continue
        let stat: fs.Stats
        try {
          stat = fs.statSync(file)
        } catch {
          continue
        }
        const slot = slotFromName(path.basename(file))
        const label = `${classify(ext, isStateDir) === 'emulator-state' ? 'Save state' : 'Battery save'}${
          slot ? ` · slot ${slot}` : ''
        }`
        upsert.run(
          `${game.id}:${file}`,
          game.id,
          classify(ext, isStateDir),
          slot,
          file,
          label,
          stat.mtime.toISOString(),
          stat.size,
          emulator?.id ?? null
        )
        found += 1
      }
    }
  }

  // Drop index entries whose files no longer exist.
  const rows = db.prepare('SELECT id, path FROM game_saves').all() as { id: string; path: string }[]
  const remove = db.prepare('DELETE FROM game_saves WHERE id = ?')
  for (const row of rows) {
    if (!fs.existsSync(row.path)) remove.run(row.id)
  }

  return { found }
}

export function listSaves(db: Db, gameId: string): GameSave[] {
  return (
    db.prepare('SELECT * FROM game_saves WHERE game_id = ? ORDER BY timestamp DESC').all(gameId) as Record<
      string,
      unknown
    >[]
  ).map(rowToSave)
}

export function removeSaveRecord(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM game_saves WHERE id = ?').run(id).changes) > 0
}

export function saveSummary(db: Db): { total: number; lastScanned: string } {
  const row = db.prepare('SELECT COUNT(*) AS c FROM game_saves').get() as { c: number }
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'saves_scanned_at'").get() as
    | { value: string }
    | undefined
  return { total: row.c, lastScanned: meta?.value ?? '' }
}

export function markSavesScanned(db: Db): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('saves_scanned_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(nowIso())
}
