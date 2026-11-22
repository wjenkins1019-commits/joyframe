-- JOYFRAME 1.0.0 schema, copied verbatim from the shipped build
-- (release/win-unpacked/resources/app.asar, out/main/index.js SCHEMA).
-- This is the DDL that created real users' joyframe.db files. Do not add
-- columns here: the upgrade smoke test opens a profile built from this file
-- with the current code, so a new column in src/main/services/db.ts must ship
-- with a migration there or the test fails.


PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  family TEXT NOT NULL,
  extensions TEXT NOT NULL,
  native INTEGER NOT NULL DEFAULT 0,
  emulator_hint TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL DEFAULT '',
  release_year INTEGER,
  developer TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '[]',
  platform_id TEXT NOT NULL DEFAULT 'windows',
  source TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT NOT NULL DEFAULT '',
  install_dir TEXT NOT NULL DEFAULT '',
  executable TEXT NOT NULL DEFAULT '',
  launch_args TEXT NOT NULL DEFAULT '',
  emulator_id TEXT,
  emulator_core TEXT NOT NULL DEFAULT '',
  rom_path TEXT NOT NULL DEFAULT '',
  installed INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  cover_path TEXT NOT NULL DEFAULT '',
  background_path TEXT NOT NULL DEFAULT '',
  logo_path TEXT NOT NULL DEFAULT '',
  hero_url TEXT NOT NULL DEFAULT '',
  screenshots TEXT NOT NULL DEFAULT '[]',
  video_url TEXT NOT NULL DEFAULT '',
  video_name TEXT NOT NULL DEFAULT '',
  playtime_seconds INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completion TEXT NOT NULL DEFAULT 'unplayed',
  metadata_provider TEXT NOT NULL DEFAULT '',
  metadata_confidence REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source ON games(source, source_id) WHERE source_id <> '';
CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform_id);
CREATE INDEX IF NOT EXISTS idx_games_last_played ON games(last_played);
CREATE INDEX IF NOT EXISTS idx_games_rom ON games(rom_path);

CREATE TABLE IF NOT EXISTS launch_methods (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'executable',
  target TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '',
  emulator_id TEXT,
  core TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_methods_game ON launch_methods(game_id);

CREATE TABLE IF NOT EXISTS emulators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  detected INTEGER NOT NULL DEFAULT 0,
  platform_ids TEXT NOT NULL DEFAULT '[]',
  args_template TEXT NOT NULL DEFAULT '',
  core TEXT NOT NULL DEFAULT '',
  core_dir TEXT NOT NULL DEFAULT '',
  save_state_dir TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emulator_path ON emulators(path);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'manual',
  rule TEXT
);

CREATE TABLE IF NOT EXISTS collection_games (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, game_id)
);

CREATE TABLE IF NOT EXISTS home_sections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'builtin',
  title TEXT NOT NULL,
  key TEXT NOT NULL,
  collection_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  "limit" INTEGER NOT NULL DEFAULT 18
);

CREATE TABLE IF NOT EXISTS game_saves (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'native',
  slot TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  emulator_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saves_path ON game_saves(path);
CREATE INDEX IF NOT EXISTS idx_saves_game ON game_saves(game_id);

CREATE TABLE IF NOT EXISTS play_sessions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_game ON play_sessions(game_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_paths (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'rom',
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovered_files (
  path TEXT PRIMARY KEY,
  platform_id TEXT,
  kind TEXT NOT NULL DEFAULT 'rom',
  first_seen TEXT NOT NULL
);
