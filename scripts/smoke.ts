/**
 * JOYFRAME backend smoke test.
 *
 * Runs the real services against fixtures inside .smoke/: database, PC scan,
 * ROM scan, emulator config, Steam manifest import, collections, home rows,
 * statistics, save-state indexing, backups and a genuine process launch with
 * playtime tracking. Run with `npm run smoke`.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator, testEmulator } from '../src/main/services/emulators.ts'
import type { MetadataRefreshSummary } from '../src/shared/types.ts'
import { describeRefresh } from '../src/renderer/src/lib/refresh-summary.ts'
import { Launcher, buildLaunchCommand } from '../src/main/services/launcher.ts'
import { buildHomeRows, createCollection, getStats, listCollections, listSections } from '../src/main/services/library.ts'
import {
  bestSteamDescription,
  createRequestBudget,
  enrichGame,
  failureMessage,
  fetchJson,
  injectedBudgetLimits,
  injectedFaultStatus,
  providerChain,
  rawgGamePatch,
  reasonForStatus,
  refreshAll,
  steamStoreMatch
} from '../src/main/services/metadata.ts'
import { insertGame, queryGames, updateGameRecord, uid } from '../src/main/services/repo.ts'
import { listOpenSessions, reconcileOpenSessions, startSession } from '../src/main/services/sessions.ts'
import { scanSaves, listSaves } from '../src/main/services/saves.ts'
import { scanPcFolders, scanRomFolders } from '../src/main/services/scanner.ts'
import { getSettings, migrateSecrets, publicSettings, updateSettings } from '../src/main/services/settings.ts'
import { configureSecrets } from '../src/main/services/secrets.ts'
import { detectSteam, importSteamGames, parseVdf } from '../src/main/services/steam.ts'
import { createBackup, isValidDatabase, listBackups } from '../src/main/services/backup.ts'
import { seedLegacyProfile } from './seed-legacy.ts'

const root = path.join(process.cwd(), '.smoke')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })
configureSecrets(path.join(root, 'secrets.key'))

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
// One game shipped in three Switch formats: only the preferred file may import.
write(path.join(romRoot, 'switch', 'Metroid Dread.nsp'), 'nsp', 2048)
write(path.join(romRoot, 'switch', 'Metroid Dread.nsz'), 'nsz', 3072)
write(path.join(romRoot, 'switch', 'Metroid Dread.xci'), 'xci', 4096)
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
  assert.equal(romGames.length, 6)
  assert.equal(byPlatform.get('Chrono Trigger'), 'snes')
  assert.equal(byPlatform.get('Super Mario Bros'), 'nes')
  assert.equal(byPlatform.get('Pokemon Emerald'), 'gba')
  assert.equal(byPlatform.get('Shadow of the Colossus'), 'ps2')
  assert.equal(byPlatform.get('Final Fantasy VII (Disc 1)'), 'ps1')
  assert.equal(byPlatform.get('Metroid Dread'), 'switch')
})

const prefRoot = path.join(root, 'roms-format-pref')
write(path.join(prefRoot, 'switch', 'Splatoon 3.xci'), 'xci', 2048)
write(path.join(prefRoot, 'switch', 'Splatoon 3.nsp'), 'nsp', 2048)
write(path.join(prefRoot, 'switch', 'Splatoon 3.nsz'), 'nsz', 3072)
const prefDb = openDatabase(path.join(root, 'format-pref.db'))
await scanRomFolders(prefDb, [prefRoot], emit, undefined, { switch: ['nsz', 'xci', 'nsp'] })
await check('per-platform format preference replaces the default order', () => {
  const games = queryGames(prefDb, { source: 'rom-scan' }, true)
  assert.equal(games.length, 1)
  assert.ok(games[0].romPath.toLowerCase().endsWith('.nsz'))
})
prefDb.close()

await check('multi-format games import once, in the preferred format', () => {
  const romGames = queryGames(db, { source: 'rom-scan' }, true)
  const metroid = romGames.filter((game) => game.title === 'Metroid Dread')
  assert.equal(metroid.length, 1)
  assert.ok(metroid[0].romPath.toLowerCase().endsWith('.xci'))
  assert.equal(romGames.filter((game) => /\.(nsp|nsz)$/i.test(game.romPath)).length, 0)
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

await check('Launch command appends the ROM when the template never mentions it', () => {
  const barePath = path.join(emulatorDir, 'bare', 'bare.exe')
  write(barePath, 'MZ', 1024)
  const bare = addEmulator(db, { name: 'Bare Emulator', path: barePath, platformIds: ['snes'], argsTemplate: '--fullscreen' })
  const chrono = queryGames(db, { search: 'Chrono Trigger' }, true)[0]
  const game = { ...chrono, emulatorId: bare.id, launchArgs: '', launchMethods: [] }

  assert.deepEqual(buildLaunchCommand(db, game).args, ['--fullscreen', chrono.romPath])
  // The switch is the opt-out for opening the emulator's own window instead.
  const bareOnly = { ...game, extra: { ...game.extra, launchRomDirectly: false } }
  assert.deepEqual(buildLaunchCommand(db, bareOnly).args, ['--fullscreen'])
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

await check('Payload builders reuse one game query without changing results', () => {
  const games = queryGames(db, {}, true)
  const collections = listCollections(db, games)
  assert.deepEqual(getStats(db, games), getStats(db))
  assert.deepEqual(listCollections(db, games), listCollections(db))
  assert.deepEqual(buildHomeRows(db, false, games, collections), buildHomeRows(db, false))
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

  // The ledger row exists while the game runs, so a crash cannot lose it.
  const open = listOpenSessions(db).find((session) => session.gameId === rom.id)
  assert.ok(open, 'launch did not record an open session')
  assert.equal(open.pid, launcher.getState().pid)

  const deadline = Date.now() + 20_000
  while (launcher.getState().state !== 'idle' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert.equal(launcher.getState().state, 'idle', 'launcher did not return to idle')
  assert.ok(states.includes('running'))
  const closed = db.prepare('SELECT ended_at, seconds FROM play_sessions WHERE id = ?').get(open.id) as {
    ended_at: string
    seconds: number
  }
  assert.ok(closed.ended_at.length > 0, 'finished session was never closed')
  assert.ok(closed.seconds >= 5)
  const updated = queryGames(db, { search: 'Super Mario Bros' }, true)[0]
  assert.ok(updated.playtimeSeconds >= 5, `playtime ${updated.playtimeSeconds}`)
  assert.ok(updated.lastPlayed.length > 0)
  assert.equal(updated.playCount, 1)
})

await check('A launched emulator receives the appended ROM argument', async () => {
  const rom = queryGames(db, { search: 'Super Mario Bros' }, true)[0]
  const record = path.join(emulatorDir, 'stub-args.json')
  const stub = path.join(emulatorDir, 'stub-emulator.mjs')
  write(stub, `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))\n`)
  // The template never mentions {rom}, exactly like a hand-written emulator
  // entry, so only the launcher's append can put the ROM on the command line.
  const bare = addEmulator(db, {
    name: 'Stub Emulator',
    path: process.execPath,
    platformIds: ['nes'],
    argsTemplate: `"${stub}"`
  })
  updateGameRecord(db, rom.id, { emulatorId: bare.id, emulatorCore: '', launchArgs: '' })

  fs.rmSync(record, { force: true })
  const launcher = new Launcher(db, {
    emit: () => undefined,
    openExternal: async () => undefined,
    settings: () => getSettings(db)
  })
  const result = await launcher.launch(rom.id)
  assert.equal(result.ok, true, result.message)

  const deadline = Date.now() + 10_000
  while (!fs.existsSync(record) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(fs.existsSync(record), 'the stub emulator never ran')
  const args = JSON.parse(fs.readFileSync(record, 'utf8')) as string[]
  assert.deepEqual(args, [rom.romPath], `stub received ${JSON.stringify(args)}`)
})

await check('Protocol launch is observable and cancelable before the game appears', async () => {
  const tf2 = queryGames(db, { search: 'Team Fortress' }, true)[0]
  assert.ok(tf2, 'Steam fixture missing')
  const opened: string[] = []
  const states: string[] = []
  const launcher = new Launcher(db, {
    emit: (state) => states.push(state.state),
    openExternal: async (url) => {
      opened.push(url)
    },
    settings: () => getSettings(db)
  })
  const countSessions = (): number =>
    (db.prepare('SELECT COUNT(*) AS c FROM play_sessions WHERE game_id = ?').get(tf2.id) as { c: number }).c
  const before = countSessions()

  const result = await launcher.launch(tf2.id)
  assert.equal(result.ok, true, result.message)
  assert.equal(opened.length, 1)
  assert.match(opened[0], /^steam:\/\/rungameid\//)

  const live = launcher.getState()
  assert.equal(live.state, 'launching')
  assert.equal(live.observing, true)
  assert.ok(live.observeUntil, 'observation window has no deadline')

  assert.equal(await launcher.stop(), true)
  assert.equal(launcher.getState().state, 'idle')
  assert.equal(launcher.getState().notice, null)
  assert.equal(countSessions(), before, 'a cancelled observation should not record a session')
})

console.log('\n[7] Crash recovery')
await check('Startup reconciliation closes a session whose process is gone', async () => {
  const game = queryGames(db, {}, true)[0]
  const id = uid()
  startSession(db, {
    id,
    gameId: game.id,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    source: 'executable',
    pid: 987654,
    exe: 'C:/nowhere/game.exe'
  })
  const report = await reconcileOpenSessions(db)
  assert.ok(report.closed >= 1, 'crashed session was not closed')
  const row = db.prepare('SELECT ended_at, seconds, recovered FROM play_sessions WHERE id = ?').get(id) as {
    ended_at: string
    seconds: number
    recovered: number
  }
  assert.ok(row.ended_at.length > 0)
  assert.equal(row.seconds, 0)
  assert.equal(row.recovered, 1)
})

await check('A game still running from a previous run is adopted and can be stopped', async () => {
  const game = queryGames(db, {}, true)[0]
  const id = uid()
  // Stand in for a game that outlived the launcher.
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  assert.ok(sleeper.pid)
  await new Promise((resolve) => setTimeout(resolve, 600))
  startSession(db, {
    id,
    gameId: game.id,
    startedAt: new Date(Date.now() - 30_000).toISOString(),
    source: 'executable',
    pid: sleeper.pid,
    exe: process.execPath
  })
  const report = await reconcileOpenSessions(db)
  const live = report.live.find((session) => session.id === id)
  assert.ok(live, 'surviving session was not recognised')

  const launcher = new Launcher(db, {
    emit: () => undefined,
    openExternal: async () => undefined,
    settings: () => getSettings(db)
  })
  assert.equal(launcher.adopt(live), true)
  const state = launcher.getState()
  assert.equal(state.state, 'running')
  assert.equal(state.recovered, true)
  assert.equal(state.gameId, game.id)

  assert.equal(await launcher.stop(), true)
  assert.equal(launcher.getState().state, 'idle')
  assert.equal(launcher.getState().recovered, false)
  const row = db.prepare('SELECT ended_at, seconds FROM play_sessions WHERE id = ?').get(id) as {
    ended_at: string
    seconds: number
  }
  assert.ok(row.ended_at.length > 0)
  assert.ok(row.seconds >= 25, `adopted session recorded ${row.seconds}s`)

  await new Promise((resolve) => setTimeout(resolve, 500))
  let alive = true
  try {
    process.kill(sleeper.pid, 0)
  } catch {
    alive = false
  }
  assert.equal(alive, false, 'stopping the adopted session left the game running')
})

console.log('\n[8] Settings and backups')
await check('Settings persist across reads', () => {
  updateSettings(db, { autoPreviews: false, previewDelay: 2400, steamPath: steamRoot })
  const settings = getSettings(db)
  assert.equal(settings.autoPreviews, false)
  assert.equal(settings.previewDelay, 2400)
  assert.equal(settings.steamPath, steamRoot)
})

await check('Startup intro preference persists with a sane default', () => {
  assert.equal(getSettings(db).introMode, 'always')
  updateSettings(db, { introMode: 'first-run' })
  assert.equal(getSettings(db).introMode, 'first-run')
  updateSettings(db, { introMode: 'off' })
  assert.equal(getSettings(db).introMode, 'off')
  updateSettings(db, { introMode: 'always' })
})

await check('Provider secrets are encrypted at rest and hidden from public settings', () => {
  updateSettings(db, { rawgApiKey: 'rawg-secret-value', igdbClientSecret: 'igdb-secret-value' })
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('rawgApiKey','igdbClientSecret')")
    .all() as { key: string; value: string }[]
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.equal(row.value.includes('secret-value'), false, `${row.key} was stored in clear text`)
    assert.match(row.value, /enc:v1:/)
  }

  const settings = getSettings(db)
  assert.equal(settings.rawgApiKey, 'rawg-secret-value')
  assert.equal(settings.igdbClientSecret, 'igdb-secret-value')
  const publicView = publicSettings(settings)
  assert.equal(publicView.rawgKeyConfigured, true)
  assert.equal(publicView.igdbSecretConfigured, true)
  assert.equal('rawgApiKey' in publicView, false, 'the RAWG key leaked into public settings')
  assert.equal('igdbClientSecret' in publicView, false, 'the IGDB secret leaked into public settings')

  // A profile written by an older build still has plaintext rows.
  db.prepare("INSERT INTO settings (key, value) VALUES ('rawgApiKey', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify('legacy-plain-key')
  )
  migrateSecrets(db)
  const migrated = db.prepare("SELECT value FROM settings WHERE key = 'rawgApiKey'").get() as { value: string }
  assert.match(migrated.value, /enc:v1:/)
  assert.equal(getSettings(db).rawgApiKey, 'legacy-plain-key')
  assert.equal(getSettings(db).igdbClientSecret, 'igdb-secret-value')

  updateSettings(db, { rawgApiKey: '', igdbClientSecret: '' })
  assert.equal(publicSettings(getSettings(db)).rawgKeyConfigured, false)
  assert.equal(publicSettings(getSettings(db)).igdbSecretConfigured, false)
})

await check('Provider chain puts the preference first and keeps every configured fallback', () => {
  updateSettings(db, { metadataProvider: 'steam', rawgApiKey: '', igdbClientId: '', igdbClientSecret: '' })
  assert.deepEqual(providerChain(getSettings(db)), ['steam'])
  updateSettings(db, { rawgApiKey: 'rawg-key' })
  assert.deepEqual(providerChain(getSettings(db)), ['steam', 'rawg'])
  updateSettings(db, { igdbClientId: 'id', igdbClientSecret: 'secret' })
  assert.deepEqual(providerChain(getSettings(db)), ['steam', 'igdb', 'rawg'])
  updateSettings(db, { metadataProvider: 'igdb' })
  assert.deepEqual(providerChain(getSettings(db)), ['igdb', 'steam', 'rawg'])
  updateSettings(db, { metadataProvider: 'rawg' })
  assert.deepEqual(providerChain(getSettings(db)), ['rawg', 'steam', 'igdb'])
  updateSettings(db, { metadataProvider: 'igdb', igdbClientId: '', igdbClientSecret: '' })
  assert.deepEqual(providerChain(getSettings(db)), ['steam', 'rawg'], 'an unkeyed preference should not stall the chain')
  updateSettings(db, { metadataProvider: 'steam', rawgApiKey: '' })
})

await check('Metadata routing skips Steam for ROMs instead of asking for an App ID', async () => {
  updateSettings(db, { metadataProvider: 'steam', rawgApiKey: '', igdbClientId: '', igdbClientSecret: '' })
  const rom = queryGames(db, {}, true).find((game) => game.source === 'rom-scan')
  assert.ok(rom, 'no ROM game to route')
  const result = await enrichGame(
    { db, settings: getSettings(db), artworkDir: path.join(root, 'artwork'), cacheArtwork: false },
    rom.id
  )
  assert.equal(result.ok, false)
  assert.match(result.message, /RAWG or IGDB/)
})

await check('Metadata failures map to distinct reasons and messages', () => {
  assert.equal(reasonForStatus(401), 'auth')
  assert.equal(reasonForStatus(403), 'auth')
  assert.equal(reasonForStatus(429), 'rate-limit')
  assert.equal(reasonForStatus(500), 'server')
  assert.equal(reasonForStatus(503), 'server')
  assert.equal(reasonForStatus(404), 'no-match')
  assert.match(failureMessage('rawg', 'auth'), /credentials/)
  assert.match(failureMessage('steam', 'rate-limit'), /rate-limited/)
  assert.match(failureMessage('steam', 'server'), /server error/i)
  assert.match(failureMessage('igdb', 'no-match'), /no match/)
  assert.match(failureMessage('rawg', 'budget'), /budget/)
})

await check('Refresh budget caps requests and stops the run when spent', async () => {
  updateSettings(db, { metadataProvider: 'steam', rawgApiKey: '', igdbClientId: '', igdbClientSecret: '' })
  const probe = createRequestBudget({ steam: 1, rawg: 0, igdb: 0 })
  assert.equal(probe.take('steam'), true)
  assert.equal(probe.take('steam'), false, 'budget allowed an extra request')
  assert.equal(probe.take('rawg'), false, 'a zero limit still allowed a request')
  assert.equal(probe.exhausted(['steam']), true, 'a spent provider should exhaust a Steam-only run')
  const mixed = createRequestBudget({ steam: 0 })
  assert.equal(mixed.exhausted(['steam']), true)
  assert.equal(mixed.exhausted(['steam', 'rawg']), false, 'RAWG still has allowance to spend')

  const budget = createRequestBudget({ steam: 0, rawg: 0, igdb: 0 })
  const summary = await refreshAll(
    { db, settings: getSettings(db), artworkDir: path.join(root, 'artwork'), cacheArtwork: false },
    { budget }
  )
  assert.equal(summary.updated, 0)
  assert.ok(summary.skipped > 0, 'a spent budget processed games anyway')
  assert.equal(summary.failed, 0)
})

await check('Provider requests back off after a rate limit and stop at the budget', async () => {
  const hits: Record<string, number> = { rate: 0, auth: 0, budget: 0 }
  const server = http.createServer((request, response) => {
    const route = (request.url ?? '/').slice(1)
    hits[route] = (hits[route] ?? 0) + 1
    if (route === 'rate' && hits[route] === 1) {
      response.writeHead(429, { 'retry-after': '1' })
      response.end('')
      return
    }
    if (route === 'auth') {
      response.writeHead(401)
      response.end('')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"items":[]}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  const deps = { db, settings: getSettings(db), artworkDir: path.join(root, 'artwork'), cacheArtwork: false }
  try {
    const started = Date.now()
    const retried = await fetchJson<{ items: unknown[] }>(deps, 'steam', `http://127.0.0.1:${port}/rate`)
    const waited = Date.now() - started
    assert.ok('data' in retried, 'a rate limit was not retried')
    assert.equal(hits.rate, 2, 'did not retry exactly once')
    assert.ok(waited >= 900, `did not honour Retry-After (waited ${waited}ms)`)

    const rejected = await fetchJson(deps, 'rawg', `http://127.0.0.1:${port}/auth`)
    assert.ok('reason' in rejected)
    assert.equal(rejected.reason, 'auth')
    assert.equal(hits.auth, 1, 'a rejected key was retried')

    const budgeted = createRequestBudget({ steam: 0 })
    const blocked = await fetchJson(
      { ...deps, budget: budgeted },
      'steam',
      `http://127.0.0.1:${port}/budget`
    )
    assert.ok('reason' in blocked)
    assert.equal(blocked.reason, 'budget')
    assert.equal(hits.budget, 0, 'a spent budget still sent a request')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

await check('Test-only fault injection reports every refresh failure path', async () => {
  const deps = { db, settings: getSettings(db), artworkDir: path.join(root, 'artwork'), cacheArtwork: false }
  const unreachable = 'http://127.0.0.1:1/never'
  const previous = process.env.JOYFRAME_FAULT_METADATA
  assert.equal(injectedFaultStatus(), 0, 'fault injection was active without the env var')
  assert.deepEqual(injectedBudgetLimits(), {}, 'a faulted budget was active without the env var')
  try {
    process.env.JOYFRAME_FAULT_METADATA = '429'
    assert.equal(injectedFaultStatus(), 429)
    const limited = await fetchJson(deps, 'steam', unreachable)
    assert.ok('reason' in limited)
    assert.equal(limited.reason, 'rate-limit')

    process.env.JOYFRAME_FAULT_METADATA = '500'
    const served = await fetchJson(deps, 'rawg', unreachable)
    assert.ok('reason' in served)
    assert.equal(served.reason, 'server')

    process.env.JOYFRAME_FAULT_METADATA = '401'
    const denied = await fetchJson(deps, 'rawg', unreachable)
    assert.ok('reason' in denied)
    assert.equal(denied.reason, 'auth', 'a rejected key did not report rejected credentials')

    process.env.JOYFRAME_FAULT_METADATA = 'budget'
    assert.equal(injectedFaultStatus(), 0, "'budget' is not an HTTP status")
    assert.deepEqual(injectedBudgetLimits(), { steam: 1, rawg: 1, igdb: 1 })
    const started = Date.now()
    const spent = await fetchJson(deps, 'steam', unreachable)
    assert.ok('reason' in spent)
    assert.equal(spent.reason, 'budget')
    assert.ok(Date.now() - started < 500, 'a faulted budget still waited on the network')

    // Mid-run exhaustion: one visible game is attempted, then the run stops.
    updateSettings(db, { metadataProvider: 'steam', rawgApiKey: '', igdbClientId: '', igdbClientSecret: '' })
    // Steam-actionable rows only, so the attempt really spends the faulted budget.
    const rows = db
      .prepare(
        "SELECT id, cover_path, metadata_confidence FROM games WHERE hidden = 0 AND (source = 'steam' OR (source_id GLOB '[0-9]*' AND source <> 'rom-scan')) LIMIT 3"
      )
      .all() as { id: string; cover_path: string; metadata_confidence: number }[]
    assert.ok(rows.length >= 2, 'need at least two visible Steam games for a mid-run budget stop')
    try {
      for (const row of rows) {
        db.prepare("UPDATE games SET cover_path = '', metadata_confidence = 0 WHERE id = ?").run(row.id)
      }
      const summary = await refreshAll({ db, settings: getSettings(db), artworkDir: path.join(root, 'artwork'), cacheArtwork: false })
      assert.equal(summary.updated, 0)
      assert.equal(summary.failed, 1, 'the faulted budget should attempt exactly one game')
      assert.equal(summary.budget, 1, 'a spent budget was reported as something else')
      assert.equal(summary.rateLimited, 0, 'a spent budget was reported as a rate limit')
      assert.ok(summary.skipped >= 1, 'a mid-run budget stop left no skipped games')
      assert.equal(summary.serverErrors, 0)
    } finally {
      for (const row of rows) {
        db.prepare('UPDATE games SET cover_path = ?, metadata_confidence = ? WHERE id = ?').run(
          row.cover_path,
          row.metadata_confidence,
          row.id
        )
      }
    }

    process.env.JOYFRAME_FAULT_METADATA = 'nonsense'
    assert.equal(injectedFaultStatus(), 0, 'an invalid fault value should be inert')
    assert.deepEqual(injectedBudgetLimits(), {}, 'an invalid fault value should not spend a budget')
  } finally {
    if (previous === undefined) delete process.env.JOYFRAME_FAULT_METADATA
    else process.env.JOYFRAME_FAULT_METADATA = previous
  }
})

await check('A refresh that runs out of budget partway skips the games it never reached', async () => {
  // A dedicated Steam-only profile: every candidate spends exactly one request,
  // so the stopping point is fixed by the allowance instead of library order.
  const budgetDb = openDatabase(path.join(root, 'budget.db'))
  const previous = process.env.JOYFRAME_FAULT_METADATA
  const allowance = 3
  const total = 5
  try {
    for (let index = 0; index < total; index += 1) {
      insertGame(budgetDb, {
        title: `Budget Probe ${index + 1}`,
        source: 'steam',
        sourceId: String(1_000_000 + index),
        platformId: 'windows',
        coverPath: '',
        metadataConfidence: 0
      })
    }
    process.env.JOYFRAME_FAULT_METADATA = 'budget'
    const started = Date.now()
    const summary = await refreshAll(
      { db: budgetDb, settings: getSettings(budgetDb), artworkDir: path.join(root, 'artwork'), cacheArtwork: false },
      { budget: createRequestBudget({ steam: allowance }) }
    )
    assert.ok(Date.now() - started < 1000, 'a faulted budget still waited on the network')
    assert.equal(summary.updated, 0)
    assert.equal(summary.failed, allowance, 'the run should process several games before the budget runs out')
    assert.equal(summary.budget, allowance, 'every processed game should report the spent budget')
    assert.equal(summary.rateLimited, 0, 'a spent budget was reported as a rate limit')
    assert.equal(summary.skipped, total - allowance, 'skipped should count the games the run never reached')

    const report = describeRefresh(summary)
    assert.equal(
      report.message,
      "Updated 0 of 3 games. 3 used up this run's request budget — refresh again later. " +
        '2 skipped after the budget ran out.'
    )
    assert.equal(report.tone, 'error')
  } finally {
    if (previous === undefined) delete process.env.JOYFRAME_FAULT_METADATA
    else process.env.JOYFRAME_FAULT_METADATA = previous
    budgetDb.close()
  }
})

await check('Refresh summaries word every outcome and pick the loudest tone', () => {
  const summary = (fields: Partial<MetadataRefreshSummary> = {}): MetadataRefreshSummary => ({
    updated: 0,
    failed: 0,
    skipped: 0,
    noMatch: 0,
    rateLimited: 0,
    budget: 0,
    authFailed: 0,
    offline: 0,
    serverErrors: 0,
    ...fields
  })

  const nothing = describeRefresh(summary())
  assert.equal(nothing.message, 'No games were refreshed.')
  assert.equal(nothing.tone, 'success')

  const clean = describeRefresh(summary({ updated: 3 }))
  assert.equal(clean.message, 'Updated 3 of 3 games.')
  assert.equal(clean.tone, 'success')

  // Each sentence on its own, so a reworded one fails here rather than in a probe.
  const auth = describeRefresh(summary({ failed: 1, authFailed: 1 }))
  assert.equal(auth.message, 'Updated 0 of 1 games. 1 hit rejected credentials — check the API key in Settings.')
  assert.equal(auth.tone, 'error')

  const limited = describeRefresh(summary({ failed: 3, rateLimited: 3 }))
  assert.equal(limited.message, 'Updated 0 of 3 games. 3 were rate-limited — try again later.')
  assert.equal(limited.tone, 'error')

  const budget = describeRefresh(summary({ failed: 2, budget: 2 }))
  assert.equal(budget.message, "Updated 0 of 2 games. 2 used up this run's request budget — refresh again later.")
  assert.equal(budget.tone, 'error')
  assert.notEqual(budget.message, limited.message, 'a spent budget should not read as a rate limit')

  const served = describeRefresh(summary({ failed: 1, serverErrors: 1 }))
  assert.equal(served.message, 'Updated 0 of 1 games. 1 hit a provider server error — try again later.')
  assert.equal(served.tone, 'error')

  const offline = describeRefresh(summary({ failed: 2, offline: 2 }))
  assert.equal(offline.message, 'Updated 0 of 2 games. 2 could not reach a provider.')
  assert.equal(offline.tone, 'error')

  const unmatchedOnly = describeRefresh(summary({ failed: 2, noMatch: 2 }))
  assert.equal(unmatchedOnly.message, 'Updated 0 of 2 games. 2 had no match.')
  assert.equal(unmatchedOnly.tone, 'info')

  const unmatched = describeRefresh(summary({ updated: 1, failed: 2, noMatch: 2 }))
  assert.equal(unmatched.message, 'Updated 1 of 3 games. 2 had no match.')
  assert.equal(unmatched.tone, 'info', 'a plain no-match should not read as an error')

  const combined = describeRefresh(
    summary({
      updated: 1,
      failed: 5,
      noMatch: 1,
      authFailed: 1,
      rateLimited: 1,
      budget: 1,
      serverErrors: 1,
      offline: 1
    })
  )
  assert.equal(
    combined.message,
    'Updated 1 of 6 games. 1 had no match. 1 hit rejected credentials — check the API key in Settings. ' +
      '1 were rate-limited — try again later. 1 used up this run\'s request budget — refresh again later. ' +
      '1 hit a provider server error — try again later. 1 could not reach a provider.'
  )
  assert.equal(combined.tone, 'error')

  const skipped = describeRefresh(summary({ skipped: 4 }))
  assert.equal(skipped.message, 'No games were refreshed. 4 skipped after the budget ran out.')
  assert.equal(skipped.tone, 'error')

  const errorBeatsInfo = describeRefresh(summary({ updated: 2, failed: 3, noMatch: 2, serverErrors: 1 }))
  assert.equal(errorBeatsInfo.message, 'Updated 2 of 5 games. 2 had no match. 1 hit a provider server error — try again later.')
  assert.equal(errorBeatsInfo.tone, 'error', 'an error should outrank a plain no-match')
})

await check('Steam store search resolves a manual PC title to an App ID', () => {
  const items = [
    { id: 292030, name: 'The Witcher 3: Wild Hunt' },
    { id: 1091500, name: 'Cyberpunk 2077' },
    { id: 271590, name: 'Grand Theft Auto V' }
  ]
  assert.equal(steamStoreMatch('Cyberpunk 2077', items), '1091500')
  assert.equal(steamStoreMatch('Cyberpunk 2077: Phantom Liberty', items), '1091500')
  assert.equal(steamStoreMatch('The Witcher 3 Wild Hunt', items), '292030')
  assert.equal(steamStoreMatch('Disco Elysium', items), '', 'unrelated title matched a Steam app')
  assert.equal(steamStoreMatch('Cyberpunk 2077', []), '')
})

await check('Steam descriptions fall back to the short blurb when the long one is only embeds', () => {
  const imageOnly = '<h1>Game: Ultimate Edition</h1><p><span><img src="art.avif" /></span></p><h1>About the Game</h1>'
  const blurb = '<p>An open-world RPG set in a dangerous megalopolis.</p>'
  assert.equal(bestSteamDescription(imageOnly, blurb), 'An open-world RPG set in a dangerous megalopolis.')
  const detailed = `<p>${'A detailed paragraph about systems, story and combat. '.repeat(4).trim()}</p>`
  assert.equal(bestSteamDescription(detailed, blurb), 'A detailed paragraph about systems, story and combat. '.repeat(4).trim())
  assert.equal(bestSteamDescription('', ''), '')
})

await check('RAWG mapping fills descriptions, companies, genres and artwork', () => {
  const game = queryGames(db, {}, true).find((entry) => entry.source === 'rom-scan')
  assert.ok(game, 'no ROM game to map onto')
  const patch = rawgGamePatch(
    {
      id: 3498,
      name: game.title,
      description_raw: 'A plumber searches for a missing princess.',
      released: '1985-09-13',
      background_image: 'https://media.rawg.io/cover.jpg',
      background_image_additional: 'https://media.rawg.io/hero.jpg',
      genres: [{ name: 'Platformer' }, { name: 'Adventure' }],
      developers: [{ name: 'Nintendo R&D4' }],
      publishers: [{ name: 'Nintendo' }],
      metacritic: 94
    },
    game,
    { cover: 'https://media.rawg.io/cover.jpg', background: 'https://media.rawg.io/hero.jpg' },
    [{ full: 'https://media.rawg.io/shot.jpg' }],
    0.9
  )
  assert.equal(patch.description, 'A plumber searches for a missing princess.')
  assert.deepEqual(patch.genres, ['Platformer', 'Adventure'])
  assert.equal(patch.developer, 'Nintendo R&D4')
  assert.equal(patch.publisher, 'Nintendo')
  assert.equal(patch.releaseDate, '1985-09-13')
  assert.equal(patch.releaseYear, 1985)
  assert.equal(patch.coverPath, 'https://media.rawg.io/cover.jpg')
  assert.equal(patch.backgroundPath, 'https://media.rawg.io/hero.jpg')
  assert.equal(patch.screenshots?.length, 1)
  assert.equal(patch.rating, 94)
  assert.equal(patch.metadataProvider, 'rawg')
  assert.equal(patch.metadataConfidence, 0.9)
  assert.ok(typeof patch.extra?.metadataUpdatedAt === 'string')
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
  assert.equal(getSettings(reopened).rawgApiKey, '')
  const celeste = games.find((game) => game.title.toLowerCase().includes('celeste'))
  assert.ok(celeste)
  reopened.close()
})

console.log('\n[9] Upgrading a 1.0.0 profile')
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
