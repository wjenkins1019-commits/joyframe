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

/** Built-in UI palettes. Accent colour remains separately editable. */
export type ThemeId = 'crimson' | 'midnight' | 'violet' | 'forest' | 'mono'

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
  /** Pass the ROM to the emulator even when its arguments never mention it. Default on. */
  launchRomDirectly?: boolean
  /** Set by a rescan when the ROM file is no longer on disk; cleared when it returns. */
  missingRom?: boolean
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
  /** Start ROM launches straight into fullscreen (per-emulator opt-in). */
  fullscreen: boolean
  /** Whether a fullscreen flag exists — verified preset or user-supplied. */
  fullscreenSupported: boolean
  /** The flag(s) actually added, for display; '' when unsupported. */
  fullscreenArgs: string
  /** User override that replaces the built-in preset when non-empty. */
  customFullscreenArgs: string
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
  theme: ThemeId
  themeAccent: string
  /** Shown in the welcome intro and used to personalize the app. */
  playerName: string
  /** Global default for handing a ROM to the emulator; per-game extras override it. */
  launchRomsDirectly: boolean
  /** Minimize the library while a game runs so only the game is visible. */
  minimizeWhilePlaying: boolean
  consoleModeOnStartup: boolean
  /** Whether the animated startup ident plays every launch, once, or never. */
  introMode: 'always' | 'first-run' | 'off'
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
  /** Free RAWG API key, used for non-Steam descriptions, genres and artwork. */
  rawgApiKey: string
  /**
   * Derived, never stored: a sealed secret row exists but this machine's
   * secrets.key cannot open it — a profile restored or copied without that
   * file. The key reads as empty, so Settings asks for it again instead of
   * calling it unset.
   */
  rawgKeyUnreadable: boolean
  igdbSecretUnreadable: boolean
  autoScanOnStartup: boolean
  metadataRefreshDays: number
  backupKeep: number
  playtimeTracking: boolean
  reduceMotion: boolean
  controllerPrompts: 'auto' | 'xbox' | 'playstation' | 'none'
}

/**
 * Settings as the renderer sees them. Provider secrets stay in the main
 * process and are represented only by whether one is stored.
 */
export interface PublicSettings extends Omit<AppSettings, 'rawgApiKey' | 'igdbClientSecret'> {
  rawgKeyConfigured: boolean
  igdbSecretConfigured: boolean
}

/** Writable settings. Secrets are write-only and never read back. */
export type SettingsPatch = Partial<Omit<AppSettings, 'rawgApiKey' | 'igdbClientSecret'>> & {
  rawgApiKey?: string
  igdbClientSecret?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'crimson',
  themeAccent: '#D71935',
  playerName: '',
  launchRomsDirectly: true,
  minimizeWhilePlaying: true,
  consoleModeOnStartup: false,
  introMode: 'always',
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
  rawgApiKey: '',
  rawgKeyUnreadable: false,
  igdbSecretUnreadable: false,
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
  /** Stale sidecar entries folded into surviving games (ROM scans). */
  removed: number
  /** Library entries whose ROM file is gone (ROM scans). */
  missing: number
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

export interface LaunchNotice {
  gameId: string
  title: string
  /** 'timeout' means the protocol launch never produced a game process. */
  reason: 'timeout' | 'error'
  message: string
  at: string
}

export interface PlayState {
  gameId: string | null
  /** 'launching' while a protocol launch is still being observed. */
  state: 'idle' | 'launching' | 'running'
  startedAt: string | null
  pid: number | null
  tracked: boolean
  /** True only for protocol launches waiting for their process to appear. */
  observing: boolean
  /** ISO deadline of the bounded observation window, while observing. */
  observeUntil: string | null
  /** Set when a launch gave up; the UI offers Retry / Cancel. */
  notice: LaunchNotice | null
  /** True when this is a session adopted from the previous run after a crash. */
  recovered?: boolean
}

export interface ArtworkCandidate {
  provider: string
  label: string
  url: string
  width?: number
  height?: number
  kind: 'cover' | 'background' | 'logo' | 'screenshot' | 'banner'
}

export type MetadataFailureReason = 'no-match' | 'rate-limit' | 'auth' | 'offline' | 'budget' | 'server'

export interface MetadataResult {
  ok: boolean
  provider: string
  confidence: number
  message: string
  /** Set on failures so bulk refresh can report why a game was skipped. */
  reason?: MetadataFailureReason
  game?: Partial<Game>
  candidates?: ArtworkCandidate[]
}

/** Outcome of "refresh all metadata", grouped by why games did not update. */
export interface MetadataRefreshSummary {
  updated: number
  failed: number
  skipped: number
  noMatch: number
  /** Providers throttled this run; waiting and retrying may help. */
  rateLimited: number
  /** Games that hit a spent provider allowance, separate from a throttle. */
  budget: number
  authFailed: number
  offline: number
  /** Provider reachable but answering 5xx. */
  serverErrors: number
}

export interface BackupInfo {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
  /** True when a companion `.key` file travels with the database. */
  includesSecrets: boolean
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
  settings: PublicSettings
  stats: StatsSummary
  home: HomeRow[]
  info: AppInfo
  playState: PlayState
  lastPlayedGame: Game | null
  /** True once this profile has shown a startup intro. */
  introPlayed: boolean
}

/**
 * The slice of the init payload a mutation can change. Refreshing this after
 * a per-game edit avoids re-sending the whole 2,000-game library.
 */
export interface LibrarySummary {
  collections: Collection[]
  stats: StatsSummary
  home: HomeRow[]
  lastPlayedGame: Game | null
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
    /** Re-run the launch named by the pending notice. */
    retry(): Promise<LaunchResult>
    /** Clear the pending launch notice without launching. */
    dismissNotice(): Promise<PlayState>
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
    refresh(gameId: string): Promise<MetadataResult>
    searchCandidates(gameId: string): Promise<ArtworkCandidate[]>
    setArtwork(gameId: string, kind: ArtworkCandidate['kind'], url: string): Promise<Game>
    pickLocalArtwork(gameId: string, kind: ArtworkCandidate['kind']): Promise<Game | null>
    setLocalFile(gameId: string, kind: ArtworkCandidate['kind'], filePath: string): Promise<Game>
    refreshAll(): Promise<MetadataRefreshSummary>
  }
  saves: {
    list(gameId: string): Promise<GameSave[]>
    scan(): Promise<{ found: number }>
    remove(id: string): Promise<boolean>
  }
  settings: {
    get(): Promise<PublicSettings>
    update(patch: SettingsPatch): Promise<PublicSettings>
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
    /** `includeSecrets` also writes the profile's secrets.key beside the backup. */
    backup(options?: { includeSecrets?: boolean }): Promise<BackupInfo>
    backups(): Promise<BackupInfo[]>
    restore(path: string): Promise<boolean>
    quit(): Promise<void>
    setFullScreen(on: boolean): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    summary(): Promise<LibrarySummary>
    /** Remember that this profile has seen the startup intro. */
    markIntroPlayed(): Promise<void>
  }
}

declare global {
  interface Window {
    joyframe: JoyframeApi
  }
}
