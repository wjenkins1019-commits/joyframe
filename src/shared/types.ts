/**
 * Shared types between the Electron main process and the React renderer.
 * Keep this module free of runtime imports so it can be loaded by both the
 * bundler and by plain Node (for the smoke-test harness).
 */

export type PlatformFamily =
  | 'PC'
  | 'Nintendo'
  | 'Sony'
  | 'Microsoft'
  | 'Sega'
  | 'Atari'
  | 'Arcade'
  | 'Other'

export interface Platform {
  id: string
  name: string
  shortName: string
  family: PlatformFamily
  /** File extensions mapped to this platform (lowercase, without dot). */
  extensions: string[]
  /** True for PC platforms that run native executables instead of ROMs. */
  native: boolean
  emulatorHint?: string
  sortOrder: number
}

export type GameSource = 'manual' | 'pc-scan' | 'rom-scan' | 'steam' | 'emulator'

export type CompletionStatus = 'unplayed' | 'in-progress' | 'completed' | 'abandoned'

export interface Screenshot {
  thumb?: string
  full: string
  local?: string
}

export interface Game {
  id: string
  title: string
  sortTitle: string
  description: string
  releaseDate: string
  releaseYear: number | null
  developer: string
  publisher: string
  genres: string[]
  platformId: string
  platformName?: string
  source: GameSource
  /** Steam app id, ROM serial, or another provider identifier. */
  sourceId: string
  installDir: string
  executable: string
  launchArgs: string
  emulatorId: string | null
  emulatorCore: string
  romPath: string
  installed: boolean
  favorite: boolean
  hidden: boolean
  rating: number | null
  coverPath: string
  backgroundPath: string
  logoPath: string
  heroUrl: string
  screenshots: Screenshot[]
  videoUrl: string
  videoName: string
  playtimeSeconds: number
  playCount: number
  lastPlayed: string
  addedAt: string
  updatedAt: string
  completion: CompletionStatus
  metadataProvider: string
  metadataConfidence: number
  notes: string
  /** JSON blob with per-game extras (controller profile, resolution, etc.). */
  extra: GameExtra
  /** Number of alternate launch methods attached to this game. */
  launchMethods: LaunchMethod[]
  saveCount?: number
}

export interface GameExtra {
  controllerProfile?: string
  resolution?: string
  displayMode?: string
  graphicsPreset?: string
  audioDevice?: string
  saveStateSlot?: string
  saveStateMode?: 'none' | 'auto' | 'manual'
  previewEnabled?: boolean
  launchOverrides?: Record<string, string>
  coverChoice?: string
  [key: string]: unknown
}

export interface LaunchMethod {
  id: string
  gameId: string
  label: string
  kind: 'executable' | 'steam' | 'emulator' | 'rom' | 'url'
  target: string
  args: string
  emulatorId: string | null
  core: string
  isDefault: boolean
}

export interface Emulator {
  id: string
  name: string
  path: string
  detected: boolean
  platformIds: string[]
  argsTemplate: string
  core: string
  coreDir: string
  saveStateDir: string
  notes: string
  createdAt: string
}

export interface EmulatorPlatformConfig {
  emulatorId: string
  platformId: string
  core: string
  argsTemplate: string
}

export interface Collection {
  id: string
  name: string
  description: string
  coverPath: string
  sortOrder: number
  isFavorite: boolean
  kind: 'manual' | 'smart'
  rule: CollectionRule | null
  gameCount: number
  gameIds: string[]
}

export interface CollectionRule {
  field: 'platform' | 'genre' | 'playtime' | 'favorite' | 'completion' | 'source'
  op: 'is' | 'contains' | 'gt' | 'lt'
  value: string
  match?: 'all' | 'any'
  conditions?: CollectionRule[]
}

export interface HomeSection {
  id: string
  kind: 'builtin' | 'collection' | 'custom'
  title: string
  key: string
  collectionId: string | null
  sortOrder: number
  hidden: boolean
  limit: number
}

export interface GameSave {
  id: string
  gameId: string
  kind: 'native' | 'emulator-state' | 'cloud' | 'manual'
  slot: string
  path: string
  label: string
  timestamp: string
  sizeBytes: number
  emulatorId: string | null
}

export interface PlaySession {
  id: string
  gameId: string
  startedAt: string
  endedAt: string
  seconds: number
  source: string
}

export interface AppSettings {
  themeAccent: string
  consoleModeOnStartup: boolean
  autoPreviews: boolean
  previewDelay: number
  previewVolume: number
  heroRotation: number
  launchOnSelect: boolean
  showHidden: boolean
  steamPath: string
  metadataProvider: string
  /** Per-platform ROM format order; an absent key uses the built-in default. */
  romFormatPreferences: Record<string, string[]>
  /** 'remote' streams artwork URLs; 'cache' downloads covers into the artwork folder. */
  artworkStorage: 'remote' | 'cache'
  igdbClientId: string
  igdbClientSecret: string
  autoScanOnStartup: boolean
  metadataRefreshDays: number
  backupKeep: number
  playtimeTracking: boolean
  reduceMotion: boolean
  controllerPrompts: 'auto' | 'xbox' | 'playstation' | 'none'
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeAccent: '#D71935',
  consoleModeOnStartup: false,
  autoPreviews: true,
  previewDelay: 1200,
  previewVolume: 0,
  heroRotation: 12,
  launchOnSelect: false,
  showHidden: false,
  steamPath: '',
  metadataProvider: 'steam',
  romFormatPreferences: {},
  artworkStorage: 'remote',
  igdbClientId: '',
  igdbClientSecret: '',
  autoScanOnStartup: false,
  metadataRefreshDays: 30,
  backupKeep: 10,
  playtimeTracking: true,
  reduceMotion: false,
  controllerPrompts: 'auto'
}

export interface DemoStatus {
  installed: boolean
  games: number
  collections: number
  emulators: number
}

export interface StatsSummary {
  totalGames: number
  installedGames: number
  totalPlaytimeSeconds: number
  favoriteCount: number
  completedCount: number
  inProgressCount: number
  unplayedCount: number
  byPlatform: { platformId: string; name: string; count: number; playtime: number }[]
  byGenre: { genre: string; count: number }[]
  bySource: { source: string; count: number }[]
  topGames: { id: string; title: string; playtimeSeconds: number; coverPath: string }[]
  recent: { id: string; title: string; lastPlayed: string; coverPath: string }[]
  last30Days: { day: string; seconds: number }[]
  addedThisMonth: number
}

export interface ScanProgress {
  phase: 'start' | 'scanning' | 'matching' | 'saving' | 'done' | 'error'
  kind: 'pc' | 'rom' | 'steam'
  scanned: number
  found: number
  message: string
  current?: string
  errors?: string[]
}

export interface ScanResult {
  kind: 'pc' | 'rom' | 'steam'
  added: number
  updated: number
  skipped: number
  errors: string[]
  elapsedMs: number
}

export interface SteamDetection {
  found: boolean
  steamPath: string
  libraryFolders: string[]
  installedCount: number
  totalCount: number
}

export interface LaunchResult {
  ok: boolean
  gameId: string
  sessionId: string
  message: string
  tracked: boolean
}

export interface PlayState {
  gameId: string | null
  state: 'idle' | 'launching' | 'running'
  startedAt: string | null
  pid: number | null
  tracked: boolean
}

export interface ArtworkCandidate {
  provider: string
  label: string
  url: string
  width?: number
  height?: number
  kind: 'cover' | 'background' | 'logo' | 'screenshot' | 'banner'
}

export interface MetadataResult {
  ok: boolean
  provider: string
  confidence: number
  message: string
  game?: Partial<Game>
  candidates?: ArtworkCandidate[]
}

export interface ProviderStatus {
  id: string
  name: string
  enabled: boolean
  requiresKey: boolean
  keyConfigured: boolean
  note: string
}

export interface BackupInfo {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
}

export interface AppInfo {
  version: string
  platform: string
  userDataPath: string
  databasePath: string
  artworkDir: string
  electron: string
  node: string
}

export interface InitPayload {
  games: Game[]
  platforms: Platform[]
  collections: Collection[]
  sections: HomeSection[]
  emulators: Emulator[]
  settings: AppSettings
  stats: StatsSummary
  home: HomeRow[]
  info: AppInfo
  playState: PlayState
  lastPlayedGame: Game | null
  providers: ProviderStatus[]
}

export interface HomeRow {
  id: string
  title: string
  key: string
  games: Game[]
  kind: 'builtin' | 'collection' | 'custom'
  collectionId: string | null
}

export type ViewId =
  | 'home'
  | 'library'
  | 'collections'
  | 'steam'
  | 'emulators'
  | 'stats'
  | 'settings'

export interface LibraryQuery {
  search?: string
  platformId?: string
  genre?: string
  source?: string
  installed?: 'installed' | 'uninstalled' | null
  played?: 'played' | 'never' | null
  favorite?: boolean | null
  sort?: 'title' | 'lastPlayed' | 'added' | 'playtime' | 'releaseYear' | 'rating'
  direction?: 'asc' | 'desc'
  collectionId?: string
  limit?: number
}

export interface JoyframeApi {
  init(): Promise<InitPayload>
  library: {
    list(query?: LibraryQuery): Promise<Game[]>
    get(id: string): Promise<Game | null>
    addManual(input: Partial<Game>): Promise<Game>
    update(id: string, patch: Partial<Game>): Promise<Game>
    remove(id: string): Promise<boolean>
    setFavorite(id: string, favorite: boolean): Promise<Game>
    setHidden(id: string, hidden: boolean): Promise<Game>
    setCompletion(id: string, status: CompletionStatus): Promise<Game>
    merge(primaryId: string, duplicateId: string): Promise<Game>
    addMethod(gameId: string, method: Partial<LaunchMethod>): Promise<Game>
    removeMethod(methodId: string): Promise<Game>
    setDefaultMethod(methodId: string): Promise<Game>
    refreshHome(): Promise<HomeRow[]>
    addPlaytime(id: string, seconds: number): Promise<Game>
    paths(): Promise<{ path: string; kind: string }[]>
    forgetPath(path: string): Promise<boolean>
  }
  scans: {
    pcFolders(paths: string[]): Promise<ScanResult>
    romFolders(paths: string[]): Promise<ScanResult>
    onProgress(cb: (p: ScanProgress) => void): () => void
  }
  steam: {
    detect(): Promise<SteamDetection>
    import(): Promise<ScanResult>
    launch(gameId: string): Promise<LaunchResult>
  }
  emulators: {
    list(): Promise<Emulator[]>
    detect(): Promise<Emulator[]>
    add(input: Partial<Emulator>): Promise<Emulator>
    update(id: string, patch: Partial<Emulator>): Promise<Emulator>
    remove(id: string): Promise<boolean>
    test(id: string, platformId?: string): Promise<{ ok: boolean; message: string; command: string }>
  }
  launch: {
    game(gameId: string): Promise<LaunchResult>
    stop(): Promise<boolean>
    state(): Promise<PlayState>
    onState(cb: (state: PlayState) => void): () => void
  }
  collections: {
    list(): Promise<Collection[]>
    create(input: Partial<Collection>): Promise<Collection>
    update(id: string, patch: Partial<Collection>): Promise<Collection>
    remove(id: string): Promise<boolean>
    addGame(collectionId: string, gameId: string): Promise<Collection>
    removeGame(collectionId: string, gameId: string): Promise<Collection>
    reorder(orderedIds: string[]): Promise<Collection[]>
  }
  sections: {
    list(): Promise<HomeSection[]>
    update(id: string, patch: Partial<HomeSection>): Promise<HomeSection[]>
    reorder(orderedIds: string[]): Promise<HomeSection[]>
    create(title: string, collectionId: string): Promise<HomeSection[]>
    reset(): Promise<HomeSection[]>
  }
  metadata: {
    providers(): Promise<ProviderStatus[]>
    refresh(gameId: string): Promise<MetadataResult>
    searchCandidates(gameId: string): Promise<ArtworkCandidate[]>
    setArtwork(gameId: string, kind: ArtworkCandidate['kind'], url: string): Promise<Game>
    pickLocalArtwork(gameId: string, kind: ArtworkCandidate['kind']): Promise<Game | null>
    setLocalFile(gameId: string, kind: ArtworkCandidate['kind'], filePath: string): Promise<Game>
    refreshAll(): Promise<{ updated: number; failed: number }>
  }
  saves: {
    list(gameId: string): Promise<GameSave[]>
    scan(): Promise<{ found: number }>
    remove(id: string): Promise<boolean>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  stats: {
    get(): Promise<StatsSummary>
  }
  demo: {
    status(): Promise<DemoStatus>
    seed(): Promise<DemoStatus>
    remove(): Promise<DemoStatus>
  }
  system: {
    pickFolder(): Promise<string | null>
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    revealPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    backup(): Promise<BackupInfo>
    backups(): Promise<BackupInfo[]>
    restore(path: string): Promise<boolean>
    quit(): Promise<void>
    setFullScreen(on: boolean): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
  }
}

declare global {
  interface Window {
    joyframe: JoyframeApi
  }
}
