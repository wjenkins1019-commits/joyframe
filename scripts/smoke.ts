/**
 * JOYFRAME backend smoke test.
 *
 * Runs the real services against fixtures inside .smoke/: database, PC scan,
 * ROM scan, emulator config, Steam manifest import, collections, home rows,
 * statistics, save-state indexing, backups and a genuine process launch with
 * playtime tracking. Run with `npm run smoke`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator, testEmulator } from '../src/main/services/emulators.ts'
import { Launcher, buildLaunchCommand } from '../src/main/services/launcher.ts'
import { buildHomeRows, createCollection, getStats, listCollections, listSections } from '../src/main/services/library.ts'
import { providerStatuses } from '../src/main/services/metadata.ts'
import { queryGames, updateGameRecord } from '../src/main/services/repo.ts'
import { scanSaves, listSaves } from '../src/main/services/saves.ts'
import { scanPcFolders, scanRomFolders } from '../src/main/services/scanner.ts'
import { getSettings, updateSettings } from '../src/main/services/settings.ts'
import { detectSteam, importSteamGames, parseVdf } from '../src/main/services/steam.ts'
import { createBackup, isValidDatabase, listBackups } from '../src/main/services/backup.ts'
import { seedLegacyProfile } from './seed-legacy.ts'

const root = path.join(process.cwd(), '.smoke')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

let passed = 0
const failures: string[] = []

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message}`)
    console.log(`  FAIL  ${name} — ${(error as Error).message}`)
  }
}

function write(file: string, contents: string | Buffer, size = 0): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  if (size > contents.length) fs.appendFileSync(file, Buffer.alloc(size - contents.length, 0))
}

const dbFile = path.join(root, 'joyframe.db')
const db = openDatabase(dbFile)

/* ----------------------------- fixtures ----------------------------- */

const pcRoot = path.join(root, 'pc-games')
write(path.join(pcRoot, 'Hollow Knight', 'hollow_knight.exe'), 'MZ fake', 200_000)
write(path.join(pcRoot, 'Celeste', 'Celeste.exe'), 'MZ fake', 180_000)
write(path.join(pcRoot, 'Celeste', 'unins000.exe'), 'MZ uninstaller', 200_000)
write(path.join(pcRoot, 'Celeste', 'UnityCrashHandler64.exe'), 'MZ crash', 200_000)

const romRoot = path.join(root, 'roms')
write(path.join(romRoot, 'snes', 'Chrono Trigger (USA).sfc'), 'rom', 2048)
write(path.join(romRoot, 'nes', 'Super Mario Bros.nes'), 'rom', 2048)
write(path.join(romRoot, 'gba', 'Pokemon Emerald.gba'), 'rom', 2048)
write(path.join(romRoot, 'ps2', 'Shadow of the Colossus.iso'), 'rom', 4096)
write(path.join(romRoot, 'ps1', 'Final Fantasy VII (Disc 1).cue'), 'FILE "x.bin" BINARY', 256)
write(path.join(romRoot, 'ps1', 'Final Fantasy VII (Disc 1).bin'), 'bin', 4096)
write(path.join(romRoot, 'bios', 'scph1001.bin'), 'bios', 512)
write(path.join(romRoot, 'snes', 'notes.txt'), 'not a rom')

const emulatorDir = path.join(root, 'emulators', 'RetroArch')
write(path.join(emulatorDir, 'retroarch.exe'), 'MZ', 1024)
write(path.join(emulatorDir, 'cores', 'snes9x_libretro.dll'), 'dll', 512)
write(path.join(emulatorDir, 'cores', 'mesen_libretro.dll'), 'dll', 512)
write(path.join(emulatorDir, 'cores', 'mgba_libretro.dll'), 'dll', 512)

/* ------------------------- platform + scans ------------------------- */

console.log('\n[1] PC and ROM scanning')
const progressMessages: string[] = []
const emit = (progress: { message: string }): void => {
  progressMessages.push(progress.message)
}

const emulator = addEmulator(db, {
  name: 'RetroArch',
  path: path.join(emulatorDir, 'retroarch.exe'),
  platformIds: ['snes', 'nes', 'gba', 'ps2', 'ps1'],
  argsTemplate: '-L "{core}" "{rom}"',
  coreDir: path.join(emulatorDir, 'cores'),
  saveStateDir: path.join(emulatorDir, 'states')
})

await scanPcFolders(db, [pcRoot], emit)
await scanRomFolders(db, [romRoot], emit)

await check('PC scan imports one game per folder and filters installers', () => {
  const pcGames = queryGames(db, { source: 'pc-scan' }, true)
  assert.equal(pcGames.length, 2)
  assert.ok(pcGames.some((game) => game.title.toLowerCase().includes('hollow')))
  assert.ok(pcGames.some((game) => game.title.toLowerCase().includes('celeste')))
})

await check('PC scan picks the executable matching the folder name', () => {
  const celeste = queryGames(db, { search: 'Celeste' }, true)[0]
  assert.ok(celeste)
  assert.ok(celeste.executable.toLowerCase().endsWith('celeste.exe'))
})

await check('ROM scan detects platforms from extensions and folder hints', () => {
  const romGames = queryGames(db, { source: 'rom-scan' }, true)
  const byPlatform = new Map(romGames.map((game) => [game.title, game.platformId]))
  assert.equal(romGames.length, 5)
  assert.equal(byPlatform.get('Chrono Trigger'), 'snes')
  assert.equal(byPlatform.get('Super Mario Bros'), 'nes')
  assert.equal(byPlatform.get('Pokemon Emerald'), 'gba')
  assert.equal(byPlatform.get('Shadow of the Colossus'), 'ps2')
  assert.equal(byPlatform.get('Final Fantasy VII (Disc 1)'), 'ps1')
})

await check('CUE/BIN pairs are not imported twice and BIOS files are ignored', () => {
  const romGames = queryGames(db, { source: 'rom-scan' }, true)
  assert.equal(romGames.filter((game) => game.romPath.toLowerCase().endsWith('.bin')).length, 0)
  assert.equal(romGames.filter((game) => /bios/i.test(game.romPath)).length, 0)
})

await check('ROMs are auto-mapped to a compatible emulator and core', () => {
  const chrono = queryGames(db, { search: 'Chrono Trigger' }, true)[0]
  assert.equal(chrono.emulatorId, emulator.id)
  assert.ok(chrono.launchMethods.length === 0)
})

await check('Rescanning is idempotent (no duplicates)', async () => {
  const before = queryGames(db, {}, true).length
  const again = await scanRomFolders(db, [romRoot], emit)
  assert.equal(again.added, 0)
  assert.ok(again.skipped >= 5)
  assert.equal(queryGames(db, {}, true).length, before)
})

await check('Scan progress is reported', () => {
  assert.ok(progressMessages.length > 0)
  assert.ok(progressMessages.some((message) => /complete/i.test(message)))
})

await check('Duplicate detection blocks the same title+platform', async () => {
  const before = queryGames(db, {}, true).length
  const emptyDir = path.join(root, 'pc-dup', 'Celeste')
  write(path.join(emptyDir, 'Celeste.exe'), 'MZ', 200_000)
  const result = await scanPcFolders(db, [path.join(root, 'pc-dup')], emit)
  assert.equal(result.added, 0)
  assert.equal(queryGames(db, {}, true).length, before)
})

console.log('\n[2] Emulator configuration')
await check('Emulator config validates executable, core and placeholders', () => {
  const result = testEmulator(db, emulator.id, 'snes')
  assert.equal(result.ok, true, result.message)
  assert.ok(result.command.includes('snes9x_libretro.dll'))
})

await check('Emulator validation reports missing cores', async () => {
  const broken = addEmulator(db, {
    name: 'Broken Core Emulator',
    path: path.join(emulatorDir, 'retroarch.exe'),
    platformIds: ['switch'],
    argsTemplate: '-L "{core}" "{rom}"',
    coreDir: path.join(emulatorDir, 'cores')
  })
  const result = testEmulator(db, broken.id, 'switch')
  assert.equal(result.ok, false)
})

await check('Launch command substitutes ROM and core tokens', () => {
  const chrono = queryGames(db, { search: 'Chrono Trigger' }, true)[0]
  const command = buildLaunchCommand(db, chrono)
  assert.equal(command.kind, 'spawn')
  assert.ok(command.args.includes(chrono.romPath))
  assert.ok(command.args.some((arg) => arg.includes('snes9x_libretro.dll')))
})

console.log('\n[3] Steam integration')
const steamRoot = path.join(root, 'steam')
const escaped = steamRoot.replace(/\\/g, '\\\\')
write(
  path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
  `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${escaped}"\n\t}\n}`
)
write(
  path.join(steamRoot, 'steamapps', 'appmanifest_440.acf'),
  `"AppState"\n{\n\t"appid"\t\t"440"\n\t"name"\t\t"Team Fortress 2"\n\t"installdir"\t\t"Team Fortress 2"\n\t"StateFlags"\t\t"4"\n\t"SizeOnDisk"\t\t"123456"\n}`
)
write(
  path.join(steamRoot, 'steamapps', 'appmanifest_999001.acf'),
  `"AppState"\n{\n\t"appid"\t\t"999001"\n\t"name"\t\t"Uninstalled Test Game"\n\t"installdir"\t\t"Test Game"\n\t"StateFlags"\t\t"2"\n}`
)
write(path.join(steamRoot, 'steamapps', 'common', 'Team Fortress 2', 'hl2.exe'), 'MZ', 1024)
write(
  path.join(steamRoot, 'userdata', '12345', 'config', 'localconfig.vdf'),
  `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"440"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LastPlayed"\t\t"1700000000"\n\t\t\t\t\t\t"Playtime"\t\t"120"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}`
)

await check('VDF parser handles nested quoted objects', () => {
  const parsed = parseVdf(`"A" { "b" "c" "d" { "e" "f" } }`)
  const a = parsed.a as Record<string, unknown>
  assert.equal(a.b, 'c')
  assert.equal((a.d as Record<string, unknown>).e, 'f')
})

await check('Steam detection reads library folders and installed counts', async () => {
  const detection = await detectSteam(db, steamRoot)
  assert.equal(detection.found, true)
  assert.equal(detection.installedCount, 1)
  assert.equal(detection.libraryFolders.length, 1)
})

await check('Steam import reads manifests, install state and local playtime', async () => {
  const result = await importSteamGames(db, emit, steamRoot)
  assert.equal(result.added, 2)
  const tf2 = queryGames(db, { search: 'Team Fortress' }, true)[0]
  assert.ok(tf2)
  assert.equal(tf2.source, 'steam')
  assert.equal(tf2.sourceId, '440')
  assert.equal(tf2.installed, true)
  assert.equal(tf2.playtimeSeconds, 7200)
  assert.ok(tf2.lastPlayed.startsWith('2023-'))
  const uninstalled = queryGames(db, { search: 'Uninstalled Test' }, true)[0]
  assert.equal(uninstalled.installed, false)
})

console.log('\n[4] Collections, rows, statistics, filters')
await check('Manual collections keep membership and counts', () => {
  const roms = queryGames(db, { source: 'rom-scan' }, true)
  const collection = createCollection(db, {
    name: 'Childhood Favorites',
    description: 'Test shelf',
    gameIds: [roms[0].id, roms[1].id]
  })
  assert.equal(collection.gameCount, 2)
  assert.equal(listCollections(db)[0].gameIds.length, 2)
})

await check('Favorites and completion drive built-in home rows', () => {
  const chrono = queryGames(db, { search: 'Chrono Trigger' }, true)[0]
  updateGameRecord(db, chrono.id, { favorite: true, completion: 'completed' })
  const rows = buildHomeRows(db)
  assert.ok(rows.some((row) => row.key === 'favorites' && row.games.some((game) => game.id === chrono.id)))
  assert.ok(rows.some((row) => row.key === 'completed'))
  assert.ok(rows.some((row) => row.key === 'retro'))
  assert.ok(rows.some((row) => row.key === 'steam'))
})

await check('Search and filters work across the unified library', () => {
  assert.equal(queryGames(db, { search: 'chrono' }).length, 1)
  assert.ok(queryGames(db, { platformId: 'snes' }).length >= 1)
  assert.ok(queryGames(db, { favorite: true }).length >= 1)
  assert.equal(queryGames(db, { played: 'never' }).some((game) => game.title === 'Chrono Trigger'), true)
  assert.equal(queryGames(db, { played: 'played' }).some((game) => game.title === 'Team Fortress 2'), true)
})

await check('Statistics summarise the library', () => {
  const stats = getStats(db)
  assert.ok(stats.totalGames >= 9)
  assert.ok(stats.totalPlaytimeSeconds >= 7200)
  assert.ok(stats.byPlatform.length >= 3)
  assert.ok(stats.bySource.some((entry) => entry.source === 'steam'))
})

await check('Default home sections are seeded and editable', () => {
  const sections = listSections(db)
  assert.ok(sections.length >= 19)
  assert.ok(sections.some((section) => section.key === 'continue'))
})

console.log('\n[5] Save states')
const stateFile = path.join(emulatorDir, 'states', 'Chrono Trigger (USA).state1')
write(stateFile, 'state', 2048)
await check('Save-state discovery indexes state files with timestamps', async () => {
  const result = await scanSaves(db)
  assert.ok(result.found >= 1)
  const chrono = queryGames(db, { search: 'Chrono Trigger' }, true)[0]
  const saves = listSaves(db, chrono.id)
  assert.ok(saves.length >= 1)
  assert.equal(saves[0].kind, 'emulator-state')
  assert.ok(saves[0].timestamp.length > 0)
  assert.ok(fs.existsSync(saves[0].path))
})

console.log('\n[6] Launching and playtime tracking')
await check('Launcher spawns a process, tracks it and records playtime', async () => {
  const rom = queryGames(db, { search: 'Super Mario Bros' }, true)[0]
  const runner = addEmulator(db, {
    name: 'Node Test Runner',
    path: process.execPath,
    platformIds: ['nes'],
    argsTemplate: '-e "setTimeout(()=>{}, 6500)"'
  })
  updateGameRecord(db, rom.id, { emulatorId: runner.id, emulatorCore: '', launchArgs: '' })

  const states: string[] = []
  const launcher = new Launcher(db, {
    emit: (state) => states.push(state.state),
    openExternal: async () => undefined,
    settings: () => getSettings(db)
  })
  const result = await launcher.launch(rom.id)
  assert.equal(result.ok, true, result.message)
  assert.equal(result.tracked, true)
  assert.equal(launcher.getState().state, 'running')

  const deadline = Date.now() + 20_000
  while (launcher.getState().state !== 'idle' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert.equal(launcher.getState().state, 'idle', 'launcher did not return to idle')
  assert.ok(states.includes('running'))
  const updated = queryGames(db, { search: 'Super Mario Bros' }, true)[0]
  assert.ok(updated.playtimeSeconds >= 5, `playtime ${updated.playtimeSeconds}`)
  assert.ok(updated.lastPlayed.length > 0)
  assert.equal(updated.playCount, 1)
})

console.log('\n[7] Settings, providers and backups')
await check('Settings persist across reads', () => {
  updateSettings(db, { autoPreviews: false, previewDelay: 2400, steamPath: steamRoot })
  const settings = getSettings(db)
  assert.equal(settings.autoPreviews, false)
  assert.equal(settings.previewDelay, 2400)
  assert.equal(settings.steamPath, steamRoot)
})

await check('Metadata provider status reflects configured credentials', () => {
  updateSettings(db, { igdbClientId: '', igdbClientSecret: '' })
  const providers = providerStatuses(getSettings(db))
  assert.equal(providers.find((provider) => provider.id === 'steam')?.enabled, true)
  assert.equal(providers.find((provider) => provider.id === 'igdb')?.enabled, false)
  updateSettings(db, { igdbClientId: 'id', igdbClientSecret: 'secret' })
  assert.equal(providerStatuses(getSettings(db)).find((provider) => provider.id === 'igdb')?.enabled, true)
  updateSettings(db, { igdbClientId: '', igdbClientSecret: '' })
})

await check('Database backups are valid SQLite files and restorable candidates', async () => {
  const backupDir = path.join(root, 'backups')
  const backup = await createBackup(db, backupDir, 5, 'smoke')
  assert.ok(fs.existsSync(backup.path))
  assert.equal(isValidDatabase(backup.path), true)
  assert.equal(listBackups(backupDir).length, 1)
})

await check('Settings and game data survive a database reopen', () => {
  db.close()
  const reopened = openDatabase(dbFile)
  const games = queryGames(reopened, {}, true)
  assert.ok(games.length >= 9)
  assert.equal(getSettings(reopened).previewDelay, 2400)
  const celeste = games.find((game) => game.title.toLowerCase().includes('celeste'))
  assert.ok(celeste)
  reopened.close()
})

console.log('\n[8] Upgrading a 1.0.0 profile')
// A real profile from the shipped 1.0.0 build: its exact schema plus the
// content a used library would have, opened with the current services. A new
// column in SCHEMA only lands in brand-new databases, so this fails unless
// db.ts also migrates existing profiles.
const legacyFile = seedLegacyProfile(path.join(root, 'upgrade'))

const columns = (handle: DatabaseSync, table: string): string[] =>
  (handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)

await check('1.0.0 profile gains every column the current schema needs', () => {
  const fresh = openDatabase(path.join(root, 'upgrade', 'fresh.db'))
  const upgraded = openDatabase(legacyFile)
  try {
    const tables = (handle: DatabaseSync): string[] =>
      (handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name
      )
    const currentTables = new Set(tables(fresh))
    const oldTables = new Set(tables(upgraded))
    const missing: string[] = []
    for (const table of currentTables) {
      if (!oldTables.has(table)) {
        missing.push(`${table} (table)`)
        continue
      }
      const oldColumns = new Set(columns(upgraded, table))
      for (const column of columns(fresh, table)) {
        if (!oldColumns.has(column)) missing.push(`${table}.${column}`)
      }
    }
    assert.ok(missing.length === 0, `missing from 1.0.0 profiles: ${missing.join(', ')} — add a migration in src/main/services/db.ts`)
  } finally {
    upgraded.close()
    fresh.close()
  }
})

await check('A 1.0.0 profile library loads through the current services', () => {
  const upgraded = openDatabase(legacyFile)
  try {
    const all = queryGames(upgraded, {}, true)
    assert.equal(all.length, 3)
    assert.equal(queryGames(upgraded, {}).length, 2, 'the hidden game stays hidden')
    const chrono = all.find((game) => game.id === 'legacy-chrono')
    assert.ok(chrono)
    assert.equal(chrono.favorite, true)
    assert.equal(chrono.playtimeSeconds, 3600)
    assert.equal(chrono.completion, 'completed')
    assert.deepEqual(chrono.genres, ['RPG'])
    assert.equal(chrono.platformName, 'Super Nintendo')
    assert.equal(chrono.launchMethods.length, 1)
    assert.deepEqual(listSaves(upgraded, 'legacy-chrono').map((save) => save.slot), ['1'])
    assert.deepEqual(listCollections(upgraded).find((c) => c.id === 'legacy-shelf')?.gameIds, ['legacy-chrono'])
    assert.ok(buildHomeRows(upgraded).some((row) => row.key === 'favorites' && row.games.some((game) => game.id === 'legacy-chrono')))
    assert.equal(getSettings(upgraded).previewDelay, 900)
    const stats = getStats(upgraded)
    assert.equal(stats.totalGames, 3)
    assert.equal(stats.totalPlaytimeSeconds, 10_800)
  } finally {
    upgraded.close()
  }
})

console.log(`\n${passed} checks passed, ${failures.length} failed.`)
if (failures.length) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  console.error(`\nFixtures kept at ${root}`)
  process.exit(1)
}

fs.rmSync(root, { recursive: true, force: true })
console.log('Smoke test complete — fixtures cleaned up.')
