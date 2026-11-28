#!/usr/bin/env node
/**
 * Store a RAWG API key in the live JOYFRAME profile from a file.
 *
 *   node scripts/set-rawg-key.mjs <path-to-key-file>
 *
 * The file should hold just the key (surrounding quotes and newlines are
 * trimmed). The key is checked against the RAWG API first and nothing is saved
 * unless RAWG accepts it, so a wrong or truncated key fails here instead of
 * just flipping `rawgKeyConfigured` to true. It is then sealed with the
 * profile's `secrets.key` exactly as Settings → Metadata does it, and this
 * script never prints the value — only its length and whether the saved row
 * decrypts back to it.
 *
 * Quit JOYFRAME first: the database is opened directly, and an open app holds
 * it locked.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/main/services/db.ts'
import { configureSecrets } from '../src/main/services/secrets.ts'
import { getSettings, updateSettings } from '../src/main/services/settings.ts'
import { rawgKeyAccepted, rawgKeyProbeUrl } from '../src/shared/rawg.ts'

/**
 * Ask RAWG for a single result with this key, using the same probe and
 * acceptance rule as Settings → Metadata. Returns null when the key works, or a
 * short reason why it does not. Never includes the key itself. The wording here
 * is deliberately this script's own; only the wire contract is shared.
 */
async function checkRawgKey(key) {
  const url = rawgKeyProbeUrl(key)
  let response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'JOYFRAME/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    })
  } catch (error) {
    return error?.name === 'TimeoutError'
      ? 'RAWG API timed out after 15s'
      : 'RAWG API could not be reached (network error)'
  }
  if (response.ok) {
    // A JSON body with results proves this is really RAWG answering, not a
    // captive portal or proxy returning its own page.
    try {
      const body = await response.json()
      if (rawgKeyAccepted(body)) return null
    } catch {
      /* fall through */
    }
    return 'RAWG API answered HTTP 200 with no game results'
  }
  if (response.status === 401 || response.status === 403) {
    return `RAWG rejected the key (HTTP ${response.status}): wrong, truncated or not a RAWG API key`
  }
  if (response.status === 429) {
    return 'RAWG API rate limit hit (HTTP 429), try again in a minute'
  }
  return `RAWG API returned HTTP ${response.status}`
}

function profileDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'joyframe')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'joyframe')
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'joyframe')
}

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/set-rawg-key.mjs <path-to-key-file>')
  process.exit(2)
}

let stats
try {
  stats = fs.statSync(file)
} catch {
  console.error(`key file not found: ${file}`)
  process.exit(2)
}
if (!stats.isFile()) {
  console.error(`key file is not a regular file: ${file}`)
  process.exit(2)
}

let contents
try {
  contents = fs.readFileSync(file, 'utf8')
} catch (error) {
  // Report the errno code only: the file may hold a secret.
  console.error(`could not read key file ${file}: ${error?.code ?? 'read error'}`)
  process.exit(2)
}

const key = contents
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim()
if (!key) {
  console.error('key file is empty')
  process.exit(2)
}
if (/\s/.test(key)) {
  console.error('key file should contain only the key: whitespace found inside the value')
  process.exit(2)
}

const rejected = await checkRawgKey(key)
if (rejected) {
  console.error(`error: ${rejected} — key not verified, nothing saved`)
  process.exit(1)
}
console.log('RAWG API accepted the key')

const profile = profileDir()
const dbFile = path.join(profile, 'joyframe.db')
if (!fs.existsSync(dbFile)) {
  console.error(`profile database not found: ${dbFile}`)
  process.exit(2)
}
configureSecrets(path.join(profile, 'secrets.key'))

let db
try {
  db = openDatabase(dbFile)
} catch (error) {
  console.error(`could not open ${dbFile} — quit JOYFRAME and try again: ${error.message}`)
  process.exit(1)
}

try {
  updateSettings(db, { rawgApiKey: key })
  // The stored row is encrypted, so reading it back is the strongest check:
  // it must decrypt to exactly what the file held. The value is never printed.
  const roundTrips = getSettings(db).rawgApiKey === key
  console.log(`profile: ${dbFile}`)
  console.log(`key length: ${key.length}`)
  console.log(`saved and decrypts back to the same value: ${roundTrips}`)
  if (!roundTrips) process.exitCode = 1
} finally {
  db.close()
}
