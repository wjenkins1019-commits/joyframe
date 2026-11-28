/**
 * Fast unit suite for the scanner's grouping rules.
 *
 * Everything here used to be proven only end to end: an Electron probe that
 * boots the packaged app or the 1,900-line smoke script. A wrong PS3 dump root,
 * a CUE that lost to its own BIN or an ISO resolved to the wrong console
 * therefore surfaced minutes after the edit that caused it. These checks run
 * against temp fixtures and a throwaway database in seconds, so `npm run
 * test:scanner` fails first.
 *
 * Covered:
 *  - PS3 disc-dump root and boot-file detection (both path separators).
 *  - A dump importing once, and an older boot-file/licence card folding into
 *    the dump's game with its playtime and a folder-derived title.
 *  - A multi-disc CUE/BIN set keeping the sheets, and an M3U beating its BINs.
 *  - Ambiguous extensions (.iso/.chd/.cue/.zip) resolved by folder hint.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import type { Db } from '../src/main/services/db.ts'
import { openDatabase } from '../src/main/services/db.ts'
import { detectPlatform } from '../src/main/services/platforms.ts'
import { insertGame } from '../src/main/services/repo.ts'
import { isPs3BootFile, ps3DiscRoot, scanRomFolders } from '../src/main/services/scanner.ts'

const tempDirs: string[] = []
const openDbs: Db[] = []

after(() => {
  for (const db of openDbs) db.close()
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joyframe-scan-'))
  tempDirs.push(dir)
  return dir
}

function makeLibrary(): Db {
  const db = openDatabase(path.join(tempDir(), 'library.db'))
  openDbs.push(db)
  return db
}

/** Write each relative path under `root`; every file is 64 bytes unless sized. */
function write(root: string, files: Array<string | [string, number]>): void {
  for (const entry of files) {
    const [file, size] = Array.isArray(entry) ? entry : [entry, 64]
    const full = path.join(root, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, Buffer.alloc(size, 1))
  }
}

async function scan(db: Db, root: string) {
  return scanRomFolders(db, [root], () => {})
}

const rows = (db: Db) => db.prepare('SELECT * FROM games').all() as Record<string, unknown>[]

const romMethods = (db: Db, gameId: unknown) =>
  db
    .prepare(`SELECT label, target, is_default FROM launch_methods WHERE game_id = ? AND kind = 'rom' ORDER BY label`)
    .all(String(gameId)) as { label: string; target: string; is_default: number }[]

/** A PS3 disc dump with the system files that used to import as their own cards. */
function ps3Dump(root: string, folder: string): { dump: string; boot: string; licence: string } {
  const dump = path.join(root, 'Disk Games', folder)
  write(dump, [
    'PS3_DISC.SFB',
    'PS3_GAME/PARAM.SFO',
    'PS3_GAME/USRDIR/EBOOT.BIN',
    'PS3_GAME/USRDIR/data/level.bin',
    'PS3_GAME/LICDIR/LIC.DAT',
    'PS3_GAME/PKGDIR/INSTALL.PKG',
    'PS3_EXTRA/D000/DATA000.PKG'
  ])
  return {
    dump,
    boot: path.join(dump, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'),
    licence: path.join(dump, 'PS3_GAME', 'LICDIR', 'LIC.DAT')
  }
}

describe('PS3 disc-dump paths', () => {
  test('the dump folder is the directory above PS3_GAME or PS3_EXTRA, on either separator', () => {
    const folder = path.join('roms', 'Disk Games', 'Uncharted 2')
    assert.equal(ps3DiscRoot(path.join(folder, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN')), folder)
    assert.equal(ps3DiscRoot(path.join(folder, 'PS3_GAME', 'LICDIR', 'LIC.DAT')), folder)
    assert.equal(ps3DiscRoot(path.join(folder, 'PS3_EXTRA', 'D000', 'DATA000.PKG')), folder)
    assert.equal(ps3DiscRoot(path.join(folder, 'PS3_GAME', 'PARAM.SFO')), folder)
    // Both separators are understood on input, and the root comes back with the
    // platform's own separator — `path.sep`, not the one the path was written
    // with — so the expectation is built the same way rather than hardcoding a
    // backslash that would fail on a POSIX runner.
    assert.equal(
      ps3DiscRoot('C:\\roms\\Uncharted 2\\PS3_GAME\\USRDIR\\EBOOT.BIN'),
      ['C:', 'roms', 'Uncharted 2'].join(path.sep)
    )
    // The root is rebuilt with the platform's separator, whichever it was given.
    assert.equal(ps3DiscRoot('/roms/Uncharted 2/PS3_UPDATE/PS3PATCH.PKG'), path.join('/roms', 'Uncharted 2'))
    // The case on disk is not trusted to be pretty.
    assert.equal(ps3DiscRoot('/roms/GOW/ps3_game/usrdir/eboot.bin'), path.join('/roms', 'GOW'))
  })

  test('a file outside a dump has no dump folder', () => {
    assert.equal(ps3DiscRoot('/roms/Uncharted 2/USRDIR/EBOOT.BIN'), null)
    assert.equal(ps3DiscRoot('/roms/Uncharted 2/EBOOT.BIN'), null)
    assert.equal(ps3DiscRoot('EBOOT.BIN'), null)
  })

  test('only USRDIR/EBOOT.BIN is the game itself', () => {
    assert.equal(isPs3BootFile('/roms/Uncharted 2/PS3_GAME/USRDIR/EBOOT.BIN'), true)
    assert.equal(isPs3BootFile('C:\\roms\\Uncharted 2\\PS3_GAME\\USRDIR\\eboot.bin'), true)
    // The pack files, licence, logo and package data beside it are not games.
    assert.equal(isPs3BootFile('/roms/Uncharted 2/PS3_GAME/USRDIR/data/level.bin'), false)
    assert.equal(isPs3BootFile('/roms/Uncharted 2/PS3_GAME/LICDIR/LIC.DAT'), false)
    assert.equal(isPs3BootFile('/roms/Uncharted 2/PS3_GAME/EBOOT.BIN'), false)
    assert.equal(isPs3BootFile('/roms/Uncharted 2/PS3_GAME/PKGDIR/INSTALL.PKG'), false)
  })
})

describe('PS3 disc-dump import', () => {
  test('a fresh dump imports as one game named after its folder', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const { boot } = ps3Dump(root, 'God of War Collection')

    const result = await scan(db, root)

    assert.equal(result.errors.length, 0)
    assert.equal(result.added, 1)
    const library = rows(db)
    assert.equal(library.length, 1, 'the licence, logo and pack files must not become cards')
    assert.equal(library[0].title, 'God of War Collection')
    assert.equal(library[0].platform_id, 'ps3')
    assert.equal(library[0].source_id, boot)
  })

  test('an older boot-file card is renamed to the folder and its licence card folds in', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const { dump, boot, licence } = ps3Dump(root, 'Uncharted 2')
    // The shape an older build left: the boot file and the licence each had
    // their own card, with the playtime split between them.
    insertGame(db, {
      title: 'EBOOT',
      platformId: 'ps3',
      source: 'rom-scan',
      sourceId: boot,
      romPath: boot,
      installDir: dump,
      playtimeSeconds: 60
    })
    insertGame(db, {
      title: 'LIC',
      platformId: 'ps3',
      source: 'rom-scan',
      sourceId: licence,
      romPath: licence,
      installDir: dump,
      playtimeSeconds: 120
    })

    const result = await scan(db, root)

    assert.equal(result.errors.length, 0)
    assert.equal(result.added, 0, 'the existing card must be reused, not duplicated')
    assert.equal(result.removed, 1, 'the licence card folds into the dump game')
    const library = rows(db)
    assert.equal(library.length, 1)
    assert.equal(library[0].title, 'Uncharted 2', 'the boot-file card takes the folder name')
    assert.equal(library[0].playtime_seconds, 180, 'merged playtime survives the fold')
    assert.equal(library[0].source_id, boot)
  })
})

describe('multi-disc disc sheets', () => {
  test('a CUE/BIN set keeps the CUE sheets and one game with a disc each', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const folder = path.join('PlayStation', 'Final Fantasy IX')
    write(root, [
      [path.join(folder, 'Final Fantasy IX (Disc 1).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 1).bin'), 4096],
      [path.join(folder, 'Final Fantasy IX (Disc 2).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 2).bin'), 4096]
    ])

    await scan(db, root)

    const library = rows(db)
    assert.equal(library.length, 1)
    assert.equal(library[0].title, 'Final Fantasy IX')
    const discs = romMethods(db, library[0].id)
    assert.deepEqual(
      discs.map((disc) => disc.label),
      ['Disc 1', 'Disc 2']
    )
    assert.ok(
      discs.every((disc) => disc.target.toLowerCase().endsWith('.cue')),
      `every disc must launch from its sheet, got ${discs.map((disc) => disc.target).join(', ')}`
    )
    assert.equal(discs.filter((disc) => Number(disc.is_default) === 1).length, 1)
  })

  test('a playlist that lists the folder\'s discs imports the game once, from the playlist', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const folder = path.join('PlayStation', 'Final Fantasy IX')
    write(root, [
      [path.join(folder, 'Final Fantasy IX.m3u'), 20],
      [path.join(folder, 'Final Fantasy IX (Disc 1).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 1).bin'), 4096],
      [path.join(folder, 'Final Fantasy IX (Disc 2).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 2).bin'), 4096]
    ])

    await scan(db, root)

    const library = rows(db)
    assert.equal(library.length, 1, 'the playlist and the disc sheets it lists are one game')
    assert.equal(library[0].title, 'Final Fantasy IX')
    // The playlist is what launches: it already covers every disc, so the
    // sheets beside it are that same game again, not a second card and not
    // extra launch methods.
    assert.ok(
      String(library[0].rom_path).toLowerCase().endsWith('.m3u'),
      `expected the playlist as the ROM, got ${library[0].rom_path}`
    )
    assert.equal(romMethods(db, library[0].id).length, 0, 'the playlist needs no per-disc methods')
  })

  test('a disc-set card from an older scan folds into the folder\'s playlist', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const folder = path.join('PlayStation', 'Final Fantasy IX')
    write(root, [
      [path.join(folder, 'Final Fantasy IX.m3u'), 20],
      [path.join(folder, 'Final Fantasy IX (Disc 1).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 1).bin'), 4096],
      [path.join(folder, 'Final Fantasy IX (Disc 2).cue'), 10],
      [path.join(folder, 'Final Fantasy IX (Disc 2).bin'), 4096]
    ])
    // What the previous build left: one card for the sheets, with the playtime.
    // The scan stores absolute paths, so the seeded card has to mirror that.
    const installDir = path.join(root, folder)
    insertGame(db, {
      title: 'Final Fantasy IX',
      platformId: 'ps1',
      source: 'rom-scan',
      sourceId: path.join(installDir, 'Final Fantasy IX (Disc 1).cue'),
      romPath: path.join(installDir, 'Final Fantasy IX (Disc 1).cue'),
      installDir,
      playtimeSeconds: 90
    })

    const result = await scan(db, root)

    assert.equal(result.removed, 1, 'the sheet card folds instead of sitting beside the playlist')
    const library = rows(db)
    assert.equal(library.length, 1)
    assert.ok(String(library[0].rom_path).toLowerCase().endsWith('.m3u'))
    assert.equal(library[0].playtime_seconds, 90, 'the folded card keeps its playtime')
  })

  test('an M3U beats the larger BIN tracks beside it in a single-game folder', async () => {
    const db = makeLibrary()
    const root = tempDir()
    const folder = path.join('PlayStation', 'Crash Bandicoot')
    write(root, [
      [path.join(folder, 'Crash Bandicoot.m3u'), 16],
      [path.join(folder, 'Crash Bandicoot (Track 1).bin'), 8192],
      [path.join(folder, 'Crash Bandicoot (Track 2).bin'), 8192]
    ])

    await scan(db, root)

    const library = rows(db)
    assert.equal(library.length, 1, 'the track files are sidecars, not extra games')
    assert.equal(library[0].title, 'Crash Bandicoot')
    assert.ok(
      String(library[0].source_id).toLowerCase().endsWith('.m3u'),
      `expected the playlist as the source, got ${library[0].source_id}`
    )
  })
})

describe('ambiguous extension platform inference', () => {
  test('a folder hint resolves extensions several platforms share', () => {
    const cases: [string, string][] = [
      ['/roms/PlayStation 2/Shadow of the Colossus.iso', 'ps2'],
      ['/roms/PlayStation Portable/God of War.iso', 'psp'],
      ['/roms/Xbox 360/Halo 3.iso', 'xbox360'],
      ['/roms/Arcade/mslug.zip', 'arcade'],
      ['/roms/Sega Dreamcast/Sonic Adventure.chd', 'dreamcast'],
      ['C:\\roms\\Nintendo GameCube\\Wind Waker.iso', 'gamecube'],
      ['/roms/PlayStation/Crash Bandicoot.cue', 'ps1']
    ]
    for (const [file, platformId] of cases) {
      assert.equal(detectPlatform(file), platformId, file)
    }
  })

  test('without a hint an unambiguous extension decides, and shared ones fall back in catalogue order', () => {
    assert.equal(detectPlatform('/roms/loose/Game.nes'), 'nes')
    assert.equal(detectPlatform('/roms/PS3/Game.pkg'), 'ps3')
    // .iso belongs to PS2, PSP and Xbox 360; with nothing to go on the first
    // catalogue match wins instead of dropping the file.
    assert.equal(detectPlatform('/roms/loose/Game.iso'), 'ps2')
  })

  test('the inferred platform is what the scan stores', async () => {
    const db = makeLibrary()
    const root = tempDir()
    write(root, [
      'PlayStation 2/Shadow of the Colossus.iso',
      'Xbox 360/Halo 3.iso',
      'PlayStation Portable/God of War.iso'
    ])

    await scan(db, root)

    const byTitle = new Map(rows(db).map((row) => [String(row.title), String(row.platform_id)]))
    assert.deepEqual(Object.fromEntries(byTitle), {
      'Halo 3': 'xbox360',
      'God of War': 'psp',
      'Shadow of the Colossus': 'ps2'
    })
  })
})
