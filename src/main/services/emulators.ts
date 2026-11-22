import fs from 'node:fs'
import path from 'node:path'
import type { Emulator } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { nowIso, rowToEmulator, uid } from './repo.ts'

interface CatalogueEntry {
  name: string
  exeNames: string[]
  platformIds: string[]
  argsTemplate: string
  core?: string
  /** Relative folder inside the install directory used for save states. */
  stateSubdir?: string
  coreSubdir?: string
}

export const RETROARCH_CORES: Record<string, string> = {
  nes: 'mesen_libretro.dll',
  snes: 'snes9x_libretro.dll',
  n64: 'mupen64plus_next_libretro.dll',
  gamecube: 'dolphin_libretro.dll',
  wii: 'dolphin_libretro.dll',
  gb: 'gambatte_libretro.dll',
  gbc: 'gambatte_libretro.dll',
  gba: 'mgba_libretro.dll',
  nds: 'melonds_libretro.dll',
  n3ds: 'citra_libretro.dll',
  ps1: 'swanstation_libretro.dll',
  ps2: 'pcsx2_libretro.dll',
  psp: 'ppsspp_libretro.dll',
  genesis: 'genesis_plus_gx_libretro.dll',
  mastersystem: 'genesis_plus_gx_libretro.dll',
  gamegear: 'genesis_plus_gx_libretro.dll',
  segacd: 'genesis_plus_gx_libretro.dll',
  saturn: 'mednafen_saturn_libretro.dll',
  dreamcast: 'flycast_libretro.dll',
  atari2600: 'stella2014_libretro.dll',
  atari7800: 'prosystem_libretro.dll',
  atarijaguar: 'virtualjaguar_libretro.dll',
  turbografx16: 'mednafen_pce_libretro.dll',
  neogeo: 'fbneo_libretro.dll',
  arcade: 'mame_libretro.dll',
  commodore64: 'vice_x64sc_libretro.dll',
  dos: 'dosbox_pure_libretro.dll'
}

export const EMULATOR_CATALOGUE: CatalogueEntry[] = [
  {
    name: 'RetroArch',
    exeNames: ['retroarch.exe'],
    platformIds: Object.keys(RETROARCH_CORES),
    argsTemplate: '-L "{core}" "{rom}"',
    core: RETROARCH_CORES.snes,
    coreSubdir: 'cores',
    stateSubdir: 'states'
  },
  { name: 'Dolphin', exeNames: ['Dolphin.exe', 'dolphin.exe'], platformIds: ['gamecube', 'wii'], argsTemplate: '-e "{rom}"' },
  { name: 'PCSX2', exeNames: ['pcsx2-qt.exe', 'pcsx2.exe'], platformIds: ['ps2'], argsTemplate: '"{rom}"' },
  { name: 'RPCS3', exeNames: ['rpcs3.exe'], platformIds: ['ps3'], argsTemplate: '"{rom}"' },
  {
    name: 'DuckStation',
    exeNames: ['duckstation-qt-x64-ReleaseLTCG.exe', 'duckstation-qt.exe', 'duckstation.exe'],
    platformIds: ['ps1'],
    argsTemplate: '"{rom}"'
  },
  { name: 'PPSSPP', exeNames: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe', 'PPSSPPQt.exe'], platformIds: ['psp'], argsTemplate: '"{rom}"' },
  { name: 'mGBA', exeNames: ['mGBA.exe', 'mgba.exe'], platformIds: ['gb', 'gbc', 'gba'], argsTemplate: '"{rom}"' },
  { name: 'Snes9x', exeNames: ['snes9x-x64.exe', 'snes9x.exe'], platformIds: ['snes'], argsTemplate: '"{rom}"' },
  { name: 'Project64', exeNames: ['Project64.exe'], platformIds: ['n64'], argsTemplate: '"{rom}"' },
  { name: 'Mesen', exeNames: ['Mesen.exe', 'Mesen2.exe'], platformIds: ['nes', 'snes', 'gb', 'gba', 'turbografx16'], argsTemplate: '"{rom}"' },
  { name: 'FCEUX', exeNames: ['fceux64.exe', 'fceux.exe'], platformIds: ['nes'], argsTemplate: '"{rom}"' },
  { name: 'DeSmuME', exeNames: ['DeSmuME_x64.exe', 'DeSmuME.exe', 'DeSmuME_0.9.11_x64.exe'], platformIds: ['nds'], argsTemplate: '"{rom}"' },
  { name: 'melonDS', exeNames: ['melonDS.exe'], platformIds: ['nds'], argsTemplate: '"{rom}"' },
  { name: 'Citra', exeNames: ['citra-qt.exe', 'citra.exe'], platformIds: ['n3ds'], argsTemplate: '"{rom}"' },
  { name: 'Ryujinx', exeNames: ['Ryujinx.exe', 'Ryujinx.Ava.exe'], platformIds: ['switch'], argsTemplate: '"{rom}"' },
  { name: 'Eden', exeNames: ['eden.exe'], platformIds: ['switch'], argsTemplate: '"{rom}"' },
  { name: 'Cemu', exeNames: ['Cemu.exe'], platformIds: ['wiiu'], argsTemplate: '-g "{rom}"' },
  { name: 'Flycast', exeNames: ['flycast.exe'], platformIds: ['dreamcast', 'arcade'], argsTemplate: '"{rom}"' },
  { name: 'redream', exeNames: ['redream.exe'], platformIds: ['dreamcast'], argsTemplate: '"{rom}"' },
  {
    name: 'Kega Fusion',
    exeNames: ['Fusion.exe', 'Fusion64.exe'],
    platformIds: ['genesis', 'mastersystem', 'segacd', 'gamegear', '32x'],
    argsTemplate: '"{rom}"'
  },
  { name: 'MAME', exeNames: ['mame.exe', 'mame64.exe'], platformIds: ['arcade', 'neogeo'], argsTemplate: '"{rom}"' },
  { name: 'DOSBox-X', exeNames: ['dosbox-x.exe', 'dosbox.exe'], platformIds: ['dos'], argsTemplate: '"{rom}"' },
  { name: 'VICE', exeNames: ['x64sc.exe', 'x64.exe'], platformIds: ['commodore64'], argsTemplate: '"{rom}"' },
  { name: 'Stella', exeNames: ['Stella.exe'], platformIds: ['atari2600'], argsTemplate: '"{rom}"' },
  { name: 'Atari800', exeNames: ['atari800.exe'], platformIds: ['atari2600', 'atari7800'], argsTemplate: '"{rom}"' },
  { name: 'xemu', exeNames: ['xemu.exe'], platformIds: ['xbox'], argsTemplate: '-dvd_path "{rom}"' },
  { name: 'Xenia', exeNames: ['xenia_canary.exe', 'xenia.exe'], platformIds: ['xbox360'], argsTemplate: '"{rom}"' },
  { name: 'ares', exeNames: ['ares.exe'], platformIds: ['snes', 'nes', 'n64', 'gb', 'gba', 'nds', 'genesis', 'mastersystem', 'gamegear'], argsTemplate: '"{rom}"' },
  { name: 'BizHawk', exeNames: ['EmuHawk.exe'], platformIds: ['nes', 'snes', 'n64', 'gb', 'gbc', 'gba', 'genesis', 'mastersystem', 'ps1', 'arcade'], argsTemplate: '"{rom}"' },
  { name: 'Mednafen', exeNames: ['mednafen.exe'], platformIds: ['ps1', 'snes', 'nes', 'gb', 'gba', 'turbografx16', 'saturn'], argsTemplate: '"{rom}"' },
  { name: 'Vita3K', exeNames: ['Vita3K.exe'], platformIds: ['vita'], argsTemplate: '"{rom}"' },
  { name: 'BigPEmu', exeNames: ['BigPEmu.exe'], platformIds: ['atarijaguar'], argsTemplate: '"{rom}"' }
]

function searchRoots(): string[] {
  const roots = new Set<string>()
  const env = process.env
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    const value = env[key]
    if (value) roots.add(value)
  }
  if (env.LOCALAPPDATA) roots.add(path.join(env.LOCALAPPDATA, 'Programs'))
  roots.add('C:\\Emulators')
  roots.add('C:\\Emulation')
  roots.add('C:\\Games\\Emulators')
  roots.add('C:\\RetroArch-Win64')
  roots.add('D:\\Emulators')
  roots.add('D:\\Emulation')
  roots.add('E:\\Emulators')
  roots.add('E:\\Emulation')
  return [...roots].filter((r) => {
    try {
      return fs.statSync(r).isDirectory()
    } catch {
      return false
    }
  })
}

function walkForExe(root: string, wanted: Set<string>, depthLimit: number, found: string[]): void {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  while (queue.length) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth >= depthLimit) continue
        const lower = entry.name.toLowerCase()
        if (lower === 'node_modules' || lower.startsWith('.')) continue
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 })
      } else if (entry.isFile() && wanted.has(entry.name.toLowerCase())) {
        found.push(path.join(dir, entry.name))
        if (found.length > 120) return
      }
    }
  }
}

/** Discover installed emulators by scanning common install locations. */
export async function detectEmulators(db: Db): Promise<Emulator[]> {
  const roots = searchRoots()
  const detectedPaths: { entry: CatalogueEntry; exePath: string }[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    const wanted = new Map<string, CatalogueEntry>()
    for (const entry of EMULATOR_CATALOGUE) {
      for (const exe of entry.exeNames) wanted.set(exe.toLowerCase(), entry)
    }
    const found: string[] = []
    walkForExe(root, new Set(wanted.keys()), 3, found)
    for (const exePath of found) {
      const key = exePath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const entry = wanted.get(path.basename(exePath).toLowerCase())
      if (entry) detectedPaths.push({ entry, exePath })
    }
  }

  const insert = db.prepare(
    `INSERT INTO emulators (id, name, path, detected, platform_ids, args_template, core, core_dir, save_state_dir, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET detected = 1, platform_ids = excluded.platform_ids`
  )
  for (const { entry, exePath } of detectedPaths) {
    const dir = path.dirname(exePath)
    const coreDir = entry.coreSubdir ? path.join(dir, entry.coreSubdir) : ''
    const stateDir = entry.stateSubdir ? path.join(dir, entry.stateSubdir) : defaultStateDir(entry.name, dir)
    insert.run(
      uid(),
      entry.name,
      exePath,
      1,
      JSON.stringify(entry.platformIds),
      entry.argsTemplate,
      entry.core ?? '',
      fs.existsSync(coreDir) ? coreDir : '',
      stateDir,
      '',
      nowIso()
    )
  }

  return listEmulators(db)
}

function defaultStateDir(name: string, installDir: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  if (!home) return ''
  const docs = path.join(home, 'Documents')
  if (name === 'Dolphin') return path.join(docs, 'Dolphin Emulator', 'StateSaves')
  if (name === 'PCSX2') return path.join(docs, 'PCSX2', 'sstates')
  if (name === 'PPSSPP') return path.join(installDir, 'memstick', 'PSP', 'SAVEDATA')
  if (name === 'RetroArch') return path.join(installDir, 'states')
  return ''
}

export function listEmulators(db: Db): Emulator[] {
  return (db.prepare('SELECT * FROM emulators ORDER BY detected DESC, name ASC').all() as Record<string, unknown>[]).map(
    rowToEmulator
  )
}

export function addEmulator(db: Db, input: Partial<Emulator>): Emulator {
  if (!input.path) throw new Error('An emulator executable path is required')
  if (!fs.existsSync(input.path)) throw new Error(`Emulator not found at ${input.path}`)
  const dir = path.dirname(input.path)
  const name = input.name?.trim() || path.basename(input.path, path.extname(input.path))
  const catalogue = EMULATOR_CATALOGUE.find((entry) =>
    entry.exeNames.some((exe) => exe.toLowerCase() === path.basename(input.path as string).toLowerCase())
  )
  const platformIds = input.platformIds ?? catalogue?.platformIds ?? ['windows']
  const argsTemplate = input.argsTemplate ?? catalogue?.argsTemplate ?? '"{rom}"'
  const id = uid()
  db.prepare(
    `INSERT INTO emulators (id, name, path, detected, platform_ids, args_template, core, core_dir, save_state_dir, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(path) DO UPDATE SET
       name = excluded.name, platform_ids = excluded.platform_ids, args_template = excluded.args_template,
       core = excluded.core, core_dir = excluded.core_dir, save_state_dir = excluded.save_state_dir,
       notes = excluded.notes`
  ).run(
    id,
    name,
    input.path,
    input.detected ? 1 : 0,
    JSON.stringify(platformIds),
    argsTemplate,
    input.core ?? catalogue?.core ?? '',
    input.coreDir ?? (catalogue?.coreSubdir ? path.join(dir, catalogue.coreSubdir) : ''),
    input.saveStateDir ?? (catalogue?.stateSubdir ? path.join(dir, catalogue.stateSubdir) : defaultStateDir(name, dir)),
    input.notes ?? '',
    nowIso()
  )
  const row = db.prepare('SELECT * FROM emulators WHERE path = ?').get(input.path) as Record<string, unknown>
  return rowToEmulator(row)
}

export function updateEmulator(db: Db, id: string, patch: Partial<Emulator>): Emulator {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const map: Record<string, string> = {
    name: 'name',
    path: 'path',
    detected: 'detected',
    platformIds: 'platform_ids',
    argsTemplate: 'args_template',
    core: 'core',
    coreDir: 'core_dir',
    saveStateDir: 'save_state_dir',
    notes: 'notes'
  }
  for (const [key, column] of Object.entries(map)) {
    if (!(key in patch)) continue
    const raw = (patch as Record<string, unknown>)[key]
    sets.push(`${column} = ?`)
    if (key === 'platformIds') params.push(JSON.stringify(raw ?? []))
    else if (key === 'detected') params.push(raw ? 1 : 0)
    else params.push(raw === null || raw === undefined ? '' : String(raw))
  }
  if (sets.length) {
    params.push(id)
    db.prepare(`UPDATE emulators SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }
  const row = db.prepare('SELECT * FROM emulators WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new Error('Emulator not found')
  return rowToEmulator(row)
}

export function removeEmulator(db: Db, id: string): boolean {
  db.prepare('UPDATE games SET emulator_id = NULL WHERE emulator_id = ?').run(id)
  return Number(db.prepare('DELETE FROM emulators WHERE id = ?').run(id).changes) > 0
}

export function coreForPlatform(platformId: string): string {
  return RETROARCH_CORES[platformId] ?? ''
}

export function testEmulator(db: Db, id: string, platformId?: string): { ok: boolean; message: string; command: string } {
  const row = db.prepare('SELECT * FROM emulators WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return { ok: false, message: 'Emulator not found', command: '' }
  const emulator = rowToEmulator(row)
  if (!fs.existsSync(emulator.path)) {
    return { ok: false, message: `Executable missing: ${emulator.path}`, command: emulator.path }
  }
  const template = emulator.argsTemplate || '"{rom}"'
  if (!template.includes('{rom}')) {
    return {
      ok: false,
      message: 'Launch arguments must include the {rom} placeholder for ROM-based games.',
      command: `${emulator.path} ${template}`
    }
  }
  const core = platformId ? coreForPlatform(platformId) : emulator.core
  if (template.includes('{core}')) {
    if (!core) {
      return {
        ok: false,
        message: 'This configuration passes {core} but no core is selected. Choose a core or pick another template.',
        command: `${emulator.path} ${template}`
      }
    }
    const coreDir = emulator.coreDir || path.join(path.dirname(emulator.path), 'cores')
    const corePath = path.join(coreDir, core)
    if (!fs.existsSync(corePath)) {
      return {
        ok: false,
        message: `Core not found: ${corePath}. Install the core in RetroArch or update the core folder.`,
        command: `${emulator.path} ${template}`
      }
    }
  }
  const sample = platformId ? `sample-${platformId}.rom` : 'game.rom'
  const command = [emulator.path, template.replace('{rom}', sample).replace('{core}', core || '{core}')].join(' ')
  return {
    ok: true,
    message: 'Configuration is valid. The executable, core and placeholders resolve correctly.',
    command
  }
}
