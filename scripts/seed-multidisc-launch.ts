/**
 * Packaged multi-disc launch probe profile.
 *
 * A two-disc PS1 set backed by a stub "emulator": Node running a script that
 * records its own argv as JSON. The game itself is NOT seeded — `verify:dist`
 * runs the packaged app's ROM scan so the grouping, the per-disc launch
 * methods and the default-disc switch are all exercised in the real payload,
 * then Play must hand the stub whichever disc is currently the default.
 *
 * Run with: node scripts/seed-multidisc-launch.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator } from '../src/main/services/emulators.ts'

const TITLE = 'Multidisc Launch Probe'
const root = path.resolve(process.argv[2] ?? '.multidisc-launch')
fs.rmSync(root, { recursive: true, force: true })
const folder = path.join(root, 'roms', 'ps1')
fs.mkdirSync(folder, { recursive: true })

for (const disc of [1, 2]) {
  fs.writeFileSync(path.join(folder, `${TITLE} (Disc ${disc}).cue`), 'JOYFRAME multi-disc probe placeholder')
}

const record = path.join(root, 'stub-args.json')
const stub = path.join(root, 'stub-emulator.mjs')
// Absolute paths: a relative script resolves against Node's install dir.
fs.writeFileSync(
  stub,
  `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))\n`
)

const db = openDatabase(path.join(root, 'joyframe.db'))
try {
  addEmulator(db, {
    name: 'Multidisc Launch Stub',
    path: process.execPath,
    platformIds: ['ps1'],
    argsTemplate: `"${stub}" "{rom}"`
  })
} finally {
  db.close()
}
console.log(`Seeded the multi-disc launch probe at ${root}`)
