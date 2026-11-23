import { DEFAULT_SETTINGS } from '../../shared/types.ts'
import type { AppSettings, PublicSettings } from '../../shared/types.ts'
import type { Db } from './db.ts'
import { isSealed, openSecret, sealSecret } from './secrets.ts'

export { DEFAULT_SETTINGS }

const SECRET_KEYS = ['rawgApiKey', 'igdbClientSecret'] as const
type SecretKey = (typeof SECRET_KEYS)[number]

function isSecretKey(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key)
}

function parseStored(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    stored[row.key] = parseStored(row.value)
    if (isSecretKey(row.key) && typeof stored[row.key] === 'string' && stored[row.key]) {
      stored[row.key] = openSecret(stored[row.key] as string)
    }
  }
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) }
}

/** Settings safe to hand to the renderer: secrets become configured flags. */
export function publicSettings(settings: AppSettings): PublicSettings {
  const { rawgApiKey, igdbClientSecret, ...rest } = settings
  return {
    ...rest,
    rawgKeyConfigured: Boolean(rawgApiKey),
    igdbSecretConfigured: Boolean(igdbClientSecret)
  }
}

/**
 * Encrypt any secret rows written by an older build. Runs once at startup;
 * encrypted rows are left alone and an empty value stays empty.
 */
export function migrateSecrets(db: Db): void {
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${SECRET_KEYS.map(() => '?').join(',')})`)
    .all(...SECRET_KEYS) as { key: string; value: string }[]
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?')
  for (const row of rows) {
    const stored = parseStored(row.value)
    if (typeof stored !== 'string' || !stored || isSealed(stored)) continue
    update.run(JSON.stringify(sealSecret(stored)), row.key)
  }
}

/** Small key/value flags (not user settings) kept in the meta table. */
export function getMeta(db: Db, key: string): string {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : ''
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}

export function updateSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const statement = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const stored = isSecretKey(key) ? sealSecret(String(value)) : value
    statement.run(key, JSON.stringify(stored))
  }
  return getSettings(db)
}
