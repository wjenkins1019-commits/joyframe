/**
 * JOYFRAME demo seeder for the visual QA pass.
 *
 * Builds a throwaway user-data directory (.demo/) with a rich offline library.
 * All content comes from the in-app demo service (src/main/services/demo.ts),
 * so the QA fixtures and the Settings "demo library" action can never drift.
 *
 * Run with: node scripts/seed-demo.ts [directory]
 * `verify:dist` passes its own profile so the two checks never share one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { seedDemoLibrary } from '../src/main/services/demo.ts'

const root = path.resolve(process.argv[2] ?? '.demo')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(path.join(root, 'artwork'), { recursive: true })

const db = openDatabase(path.join(root, 'joyframe.db'))
const status = seedDemoLibrary(db, root, path.join(root, 'artwork'))
db.close()

console.log(
  `Seeded ${status.games} games, ${status.collections} collections, ${status.emulators} emulator into ${root}`
)
