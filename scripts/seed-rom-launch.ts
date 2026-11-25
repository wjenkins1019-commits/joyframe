/**
 * Packaged ROM-launch probe profile.
 *
 * One ROM game backed by a stub "emulator": Node running a script that records
 * its own argv. `verify:dist` boots the packaged app on this profile so it can
 * prove what the real launcher passes to the emulator, including after the
 * per-game "Launch the ROM directly" switch is turned off and saved.
 *
 * Run with: node scripts/seed-rom-launch.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator } from '../src/main/services/emulators.ts'
import { insertGame } from '../src/main/services/repo.ts'

const TITLE = 'ROM Launch Probe'
const root = path.resolve(process.argv[2] ?? '.rom-launch')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'roms'), { recursive: true })

const db = openDatabase(path.join(root, 'joyframe.db'))
try {
  const rom = path.join(root, 'roms', `${TITLE}.nes`)
  fs.writeFileSync(rom, 'JOYFRAME ROM launch probe placeholder')
  const record = path.join(root, 'stub-args.json')
  const stub = path.join(root, 'stub-emulator.mjs')
  // Absolute paths: a relative script resolves against Node's install dir.
  fs.writeFileSync(
    stub,
    `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))\n`
  )
  const emulator = addEmulator(db, {
    name: 'ROM Launch Stub',
    path: process.execPath,
    platformIds: ['nes'],
    argsTemplate: `"${stub}"`
  })
  insertGame(db, {
    title: TITLE,
    platformId: 'nes',
    source: 'rom-scan',
    romPath: rom,
    emulatorId: emulator.id,
    installed: true,
    extra: { romLaunchProbe: true }
  })
  console.log(`Seeded the ROM launch probe at ${root}`)
} finally {
  db.close()
}
