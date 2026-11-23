import { DEFAULT_SETTINGS } from '../../shared/types.ts'
import type { AppSettings } from '../../shared/types.ts'
import type { Db } from './db.ts'

export { DEFAULT_SETTINGS }

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      stored[row.key] = row.value
    }
  }
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) }
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
    statement.run(key, JSON.stringify(value))
  }
  return getSettings(db)
}
