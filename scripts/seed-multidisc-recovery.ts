/**
 * Packaged multi-disc recovery probe profile.
 *
 * Starts in the shape an older build produced — one library entry per disc of a
 * two-disc PS1 set, each with its own playtime — so the packaged rescan has to
 * fold them into one game and snapshot the library (`pre-merge`) before it does.
 * `verify:dist` then restores that snapshot from the packaged app itself, which
 * is the only way to prove the fold is reversible.
 *
 * Run with: node scripts/seed-multidisc-recovery.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator } from '../src/main/services/emulators.ts'
import { insertGame } from '../src/main/services/repo.ts'

const TITLE = 'Multidisc Recovery Probe'
const root = path.resolve(process.argv[2] ?? '.multidisc-recovery')
fs.rmSync(root, { recursive: true, force: true })
const folder = path.join(root, 'roms', 'ps1')
fs.mkdirSync(folder, { recursive: true })

const discs = [1, 2].map((disc) => path.join(folder, `${TITLE} (Disc ${disc}).cue`))
for (const file of discs) fs.writeFileSync(file, 'JOYFRAME multi-disc recovery probe placeholder')

const record = path.join(root, 'stub-args.json')
const stub = path.join(root, 'stub-emulator.mjs')
// Absolute paths: a relative script resolves against Node's install dir.
fs.writeFileSync(
  stub,
  `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))\n`
)

const db = openDatabase(path.join(root, 'joyframe.db'))
try {
  const emulator = addEmulator(db, {
    name: 'Multidisc Recovery Stub',
    path: process.execPath,
    platformIds: ['ps1'],
    argsTemplate: `"${stub}" "{rom}"`
  })
  // One entry per disc, as a pre-grouping build wrote them: separate playtime,
  // and the notes a fold has to carry onto the survivor.
  discs.forEach((file, index) => {
    insertGame(db, {
      title: `${TITLE} (Disc ${index + 1})`,
      platformId: 'ps1',
      source: 'rom-scan',
      sourceId: file,
      romPath: file,
      installDir: folder,
      emulatorId: emulator.id,
      installed: true,
      playtimeSeconds: index === 0 ? 600 : 300,
      notes: index === 0 ? 'legacy note' : ''
    })
  })
} finally {
  db.close()
}
console.log(`Seeded the multi-disc recovery probe at ${root}`)
