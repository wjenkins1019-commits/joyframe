/**
 * Packaged PS3 disc-dump probe profile.
 *
 * Two disc dumps, each wrapped in the licence, logo, package and pack files a
 * real dump carries:
 *
 *  - `God of War Collection` is fresh: nothing in the library, so the packaged
 *    scan has to import the whole dump as one game.
 *  - `Uncharted 2` starts the way an older scan left it — a card made from the
 *    boot file (`EBOOT`, with its own playtime) and a card made from the licence
 *    file (`LIC`) — so the rescan has to fold both into the folder's game,
 *    rename the boot card after the folder and keep their playtime.
 *
 * Run with: node scripts/seed-ps3-dump.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { insertGame } from '../src/main/services/repo.ts'

// Keep in step with PS3_FRESH / PS3_FOLDED in scripts/verify-dist.mjs.
const FRESH = 'God of War Collection (USA) (v02.00)'
const FOLDED = 'Uncharted 2 (USA)'
const root = path.resolve(process.argv[2] ?? '.ps3-dump')
fs.rmSync(root, { recursive: true, force: true })
const roms = path.join(root, 'roms')

/** The dump's game tree, with the system files no scan may import. */
const writeDump = (folder: string): string => {
  const disc = path.join(roms, 'Disk Games', folder)
  const write = (relative: string, content: string, bytes: number) => {
    const file = path.join(disc, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content.padEnd(bytes, '\0'))
  }
  write('PS3_DISC.SFB', 'sfb', 128)
  write(path.join('PS3_GAME', 'PARAM.SFO'), 'sfo', 128)
  write(path.join('PS3_GAME', 'PS3LOGO.DAT'), 'logo', 512)
  write(path.join('PS3_GAME', 'LICDIR', 'LIC.DAT'), 'lic', 256)
  write(path.join('PS3_GAME', 'PKGDIR', 'PKG00', 'INSTALL.PKG'), 'pkg', 1024)
  write(path.join('PS3_GAME', 'USRDIR', 'EBOOT.BIN'), 'boot', 8192)
  write(path.join('PS3_GAME', 'USRDIR', 'data', 'level.bin'), 'pack', 1024)
  write(path.join('PS3_EXTRA', 'D000', 'DATA000.PKG'), 'pkg', 1024)
  return disc
}

writeDump(FRESH)
const foldedDisc = writeDump(FOLDED)

const db = openDatabase(path.join(root, 'joyframe.db'))
try {
  // What a pre-PS3-aware scan wrote: one card per system file it happened to
  // import, each with its own playtime, none of them the game.
  const legacy = [
    { title: 'LIC', file: path.join(foldedDisc, 'PS3_GAME', 'LICDIR', 'LIC.DAT'), playtimeSeconds: 120 },
    { title: 'EBOOT', file: path.join(foldedDisc, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'), playtimeSeconds: 60 }
  ]
  for (const entry of legacy) {
    insertGame(db, {
      title: entry.title,
      platformId: 'ps3',
      source: 'rom-scan',
      sourceId: entry.file,
      romPath: entry.file,
      installDir: path.dirname(entry.file),
      playtimeSeconds: entry.playtimeSeconds
    })
  }
} finally {
  db.close()
}
console.log(`Seeded the PS3 disc-dump probe at ${root}`)
