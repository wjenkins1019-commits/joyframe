/**
 * Packaged provider-key restore probe profile.
 *
 * One stored, readable RAWG key. `verify:dist` boots the packaged app on this
 * profile so it can prove the include-keys toggle writes a real key companion,
 * that restoring that backup revives the key after secrets.key has been rotated,
 * and that a plain backup restores the library without installing any key.
 *
 * Run with: node scripts/seed-keys-restore.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { configureSecrets } from '../src/main/services/secrets.ts'
import { setMeta, updateSettings } from '../src/main/services/settings.ts'

const root = path.resolve(process.argv[2] ?? '.keys-restore')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

configureSecrets(path.join(root, 'secrets.key'))
const db = openDatabase(path.join(root, 'joyframe.db'))
try {
  updateSettings(db, {
    rawgApiKey: 'keys-restore-probe',
    playerName: 'probe',
    introMode: 'off'
  })
  // Skip the intro so the first window is the app, not the name gate.
  setMeta(db, 'introPlayed', '1')
} finally {
  db.close()
}
