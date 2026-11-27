/**
 * Packaged multi-disc probe profile, in either of the two shapes verify:dist uses.
 *
 * Both shapes write two PS1 cues and a stub "emulator": Node running a script
 * that records its own argv, so the probe can read what the packaged launcher
 * handed the emulator.
 *
 *  - without `--legacy` the library is empty, so the packaged scan has to group
 *    the cues into one game with a launch method per disc (the launch profile);
 *  - with `--legacy` the library starts as a pre-grouping build left it — one
 *    entry per disc, each with its own playtime — so the rescan has to fold them
 *    and snapshot the library first. That shape also carries an orphan game
 *    outside the scanned folder with one live disc method and no default, which
 *    is what makes the launcher's third fallback path reachable.
 *
 * Run with: node scripts/seed-multidisc.ts [directory] [--legacy]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { addEmulator } from '../src/main/services/emulators.ts'
import { insertGame, uid } from '../src/main/services/repo.ts'

const legacy = process.argv.includes('--legacy')
// The titles the probe's checks look for; keep them in step with MULTI_TITLE and
// RECOVERY_TITLE in scripts/verify-dist.mjs.
const TITLE = legacy ? 'Multidisc Recovery Probe' : 'Multidisc Launch Probe'
const ORPHAN = 'Orphan Disc Probe'
const root = path.resolve(process.argv[2] ?? (legacy ? '.multidisc-recovery' : '.multidisc-launch'))
fs.rmSync(root, { recursive: true, force: true })
const folder = path.join(root, 'roms', 'ps1')
fs.mkdirSync(folder, { recursive: true })

const discs = [1, 2].map((disc) => path.join(folder, `${TITLE} (Disc ${disc}).cue`))
for (const file of discs) fs.writeFileSync(file, 'JOYFRAME multi-disc probe placeholder')

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
    name: 'Multidisc Probe Stub',
    path: process.execPath,
    platformIds: ['ps1'],
    argsTemplate: `"${stub}" "{rom}"`
  })

  if (legacy) {
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

    // Outside roms/, so no scan folds or flags it: a manual entry with one live
    // disc method and deliberately no default, which is the launcher's third
    // fallback branch once its own ROM is deleted.
    const orphanFolder = path.join(root, 'orphan')
    fs.mkdirSync(orphanFolder, { recursive: true })
    const orphanRoms = [1, 2].map((disc) => path.join(orphanFolder, `${ORPHAN} (Disc ${disc}).cue`))
    for (const file of orphanRoms) fs.writeFileSync(file, 'JOYFRAME orphan disc probe placeholder')
    const orphan = insertGame(db, {
      title: ORPHAN,
      platformId: 'ps1',
      source: 'manual',
      sourceId: orphanRoms[0],
      romPath: orphanRoms[0],
      installDir: orphanFolder,
      emulatorId: emulator.id,
      installed: true
    })
    db.prepare(
      'INSERT INTO launch_methods (id, game_id, label, kind, target, args, emulator_id, core, is_default) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(uid(), orphan.id, 'Disc 2', 'rom', orphanRoms[1], '', emulator.id, '', 0)
  }
} finally {
  db.close()
}
console.log(`Seeded the ${legacy ? 'multi-disc recovery' : 'multi-disc launch'} probe at ${root}`)
