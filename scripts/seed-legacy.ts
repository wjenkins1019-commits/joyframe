/**
 * JOYFRAME 1.0.0 profile seeder.
 *
 * Builds a profile database exactly as the shipped 1.0.0 build left it: the
 * schema from scripts/fixtures/schema-1.0.0.sql plus content a used library
 * would have. The upgrade smoke check and `verify:dist` both open this profile
 * with newer code, so the fixture and the checks can never drift apart.
 *
 * Run with: node scripts/seed-legacy.ts [directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const SCHEMA = fs.readFileSync(fileURLToPath(new URL('./fixtures/schema-1.0.0.sql', import.meta.url)), 'utf8')

/** Two visible games (one PC, one ROM, both played) and one hidden game. */
const ROWS = `
  INSERT INTO platforms (id, name, short_name, family, extensions, native, emulator_hint, sort_order)
    VALUES ('windows', 'PC (Windows)', 'PC', 'PC', '["exe"]', 1, '', 0),
           ('snes', 'Super Nintendo', 'SNES', 'Nintendo', '["sfc"]', 0, 'Snes9x', 11);
  INSERT INTO games (id, title, sort_title, platform_id, source, source_id, favorite, hidden, genres,
    playtime_seconds, play_count, last_played, added_at, updated_at, completion, cover_path)
    VALUES ('legacy-chrono', 'Chrono Trigger', 'chrono trigger', 'snes', 'rom-scan', '', 1, 0, '["RPG"]',
            3600, 2, '2025-11-01T10:00:00.000Z', '2025-01-02T00:00:00.000Z', '2025-11-01T10:00:00.000Z', 'completed', ''),
           ('legacy-hades', 'Hades', 'hades', 'windows', 'pc-scan', '', 0, 0, '["Action"]',
            7200, 3, '2025-10-20T18:00:00.000Z', '2025-02-02T00:00:00.000Z', '2025-10-20T18:00:00.000Z', 'in-progress', ''),
           ('legacy-hidden', 'Old Prototype', 'old prototype', 'windows', 'manual', '', 0, 1, '[]',
            0, 0, '', '2024-12-01T00:00:00.000Z', '2024-12-01T00:00:00.000Z', 'unplayed', '');
  INSERT INTO launch_methods (id, game_id, label, kind, target, args, emulator_id, core, is_default)
    VALUES ('legacy-method', 'legacy-chrono', 'Snes9x (legacy)', 'executable', 'C:/emus/snes9x.exe', '"{rom}"', NULL, '', 1);
  INSERT INTO collections (id, name, description, sort_order, is_favorite, kind)
    VALUES ('legacy-shelf', 'Legacy Shelf', 'Made before the upgrade', 0, 1, 'manual');
  INSERT INTO collection_games (collection_id, game_id, sort_order) VALUES ('legacy-shelf', 'legacy-chrono', 1);
  INSERT INTO game_saves (id, game_id, kind, slot, path, label, timestamp, size_bytes)
    VALUES ('legacy-save', 'legacy-chrono', 'emulator-state', '1', 'C:/states/chrono.state1', 'Slot 1', '2025-11-01T09:00:00.000Z', 4096);
  INSERT INTO play_sessions (id, game_id, started_at, ended_at, seconds, source)
    VALUES ('legacy-session', 'legacy-chrono', '2025-11-01T09:00:00.000Z', '2025-11-01T10:00:00.000Z', 3600, 'spawn');
  INSERT INTO settings (key, value) VALUES ('previewDelay', '900');
`

/** Replace `directory` with a fresh 1.0.0 profile; returns the database path. */
export function seedLegacyProfile(directory: string): string {
  const root = path.resolve(directory)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.join(root, 'artwork'), { recursive: true })
  const file = path.join(root, 'joyframe.db')
  const db = new DatabaseSync(file)
  try {
    db.exec(SCHEMA)
    db.exec(ROWS)
  } finally {
    db.close()
  }
  return file
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = seedLegacyProfile(process.argv[2] ?? '.legacy')
  console.log(`Seeded the 1.0.0 profile (3 games, 1 hidden) at ${file}`)
}
