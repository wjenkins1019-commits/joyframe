import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type {
  AppInfo,
  PublicSettings,
  SettingsPatch,
  Collection,
  CompletionStatus,
  Emulator,
  Game,
  HomeRow,
  HomeSection,
  InitPayload,
  PlayState,
  Platform,
  ScanProgress,
  StatsSummary,
  ViewId
} from '@shared/types'
import { api, errorMessage } from '../lib/api'

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
}

interface JoyframeState {
  ready: boolean
  loading: boolean
  error: string | null
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
  lastPlayed: Game | null
  introPlayed: boolean
  view: ViewId
  detailId: string | null
  consoleMode: boolean
  toasts: Toast[]
  scan: ScanProgress | null
  previewGameId: string | null
  search: string
  controller: { connected: boolean; name: string; kind: 'xbox' | 'playstation' | 'generic' }

  init: () => Promise<void>
  refresh: () => Promise<void>
  refreshSummary: () => Promise<void>
  setView: (view: ViewId) => void
  setSearch: (value: string) => void
  openDetail: (id: string) => void
  closeDetail: () => void
  setConsoleMode: (on: boolean) => void
  creditsOpen: boolean
  openCredits: () => void
  closeCredits: () => void
  setPreview: (id: string | null) => void
  notify: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  setScan: (progress: ScanProgress | null) => void
  setController: (connected: boolean, name?: string, kind?: 'xbox' | 'playstation' | 'generic') => void
  play: (gameId: string) => Promise<void>
  stopGame: () => Promise<void>
  retryLaunch: () => Promise<void>
  dismissLaunchNotice: () => Promise<void>
  toggleFavorite: (gameId: string) => Promise<void>
  updateGame: (gameId: string, patch: Partial<Game>) => Promise<Game | null>
  setCompletion: (gameId: string, status: CompletionStatus) => Promise<void>
  addPlaytime: (gameId: string, seconds: number) => Promise<void>
  removeGame: (gameId: string) => Promise<void>
  updateSettings: (patch: SettingsPatch) => Promise<void>
  refreshSections: (sections: HomeSection[]) => Promise<void>
}

function emptyPlayState(): PlayState {
  return {
    gameId: null,
    state: 'idle',
    startedAt: null,
    pid: null,
    tracked: false,
    observing: false,
    observeUntil: null,
    notice: null
  }
}

const emptyStats: StatsSummary = {
  totalGames: 0,
  installedGames: 0,
  totalPlaytimeSeconds: 0,
  favoriteCount: 0,
  completedCount: 0,
  inProgressCount: 0,
  unplayedCount: 0,
  byPlatform: [],
  byGenre: [],
  bySource: [],
  topGames: [],
  recent: [],
  last30Days: [],
  addedThisMonth: 0
}

const emptyInfo: AppInfo = {
  version: '',
  platform: 'win32',
  userDataPath: '',
  databasePath: '',
  artworkDir: '',
  electron: '',
  node: ''
}

const { rawgApiKey: _rawgApiKey, igdbClientSecret: _igdbClientSecret, ...publicDefaults } = DEFAULT_SETTINGS
const fallbackSettings: PublicSettings = {
  ...publicDefaults,
  rawgKeyConfigured: false,
  igdbSecretConfigured: false
}

let toastCounter = 0

function applyPayload(set: (partial: Partial<JoyframeState>) => void, payload: InitPayload): void {
  set({
    games: payload.games,
    platforms: payload.platforms,
    collections: payload.collections,
    sections: payload.sections,
    emulators: payload.emulators,
    settings: payload.settings,
    stats: payload.stats,
    home: payload.home,
    info: payload.info,
    playState: payload.playState,
    lastPlayed: payload.lastPlayedGame,
    introPlayed: payload.introPlayed,
    ready: true,
    loading: false,
    error: null
  })
}

export const useStore = create<JoyframeState>((set, get) => ({
  ready: false,
  loading: true,
  error: null,
  games: [],
  platforms: [],
  collections: [],
  sections: [],
  emulators: [],
  settings: fallbackSettings,
  stats: emptyStats,
  home: [],
  info: emptyInfo,
  playState: {
    gameId: null,
    state: 'idle',
    startedAt: null,
    pid: null,
    tracked: false,
    observing: false,
    observeUntil: null,
    notice: null
  },
  lastPlayed: null,
  introPlayed: false,
  view: 'home',
  detailId: null,
  consoleMode: false,
  creditsOpen: false,
  toasts: [],
  scan: null,
  previewGameId: null,
  search: '',
  controller: { connected: false, name: '', kind: 'xbox' },

  init: async () => {
    set({ loading: true, error: null })
    try {
      const payload = await api.init()
      applyPayload(set, payload)
      if (payload.settings.consoleModeOnStartup) {
        set({ consoleMode: true })
        void api.system.setFullScreen(true).catch(() => undefined)
      }
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  refresh: async () => {
    try {
      const payload = await api.init()
      applyPayload(set, payload)
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  // Per-game mutations only change one game plus the derived shelves and
  // statistics. Rebuilding those is far cheaper than re-sending the library.
  refreshSummary: async () => {
    try {
      const summary = await api.app.summary()
      set({
        collections: summary.collections,
        stats: summary.stats,
        home: summary.home,
        lastPlayed: summary.lastPlayedGame
      })
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  setView: (view) => set({ view, detailId: null }),
  setSearch: (search) => set({ search }),
  openDetail: (id) => set({ detailId: id }),
  closeDetail: () => set({ detailId: null }),
  setConsoleMode: (on) => set({ consoleMode: on }),
  openCredits: () => set({ creditsOpen: true }),
  closeCredits: () => set({ creditsOpen: false }),
  setPreview: (id) => set({ previewGameId: id }),

  notify: (message, tone = 'info') => {
    const id = `toast-${++toastCounter}`
    set({ toasts: [...get().toasts, { id, message, tone }] })
    window.setTimeout(() => {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
    }, tone === 'error' ? 7000 : 4200)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  setScan: (scan) => set({ scan }),
  setController: (connected, name = '', kind = 'xbox') =>
    set({ controller: { connected, name: name || 'Controller', kind } }),

  play: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    if (get().playState.state !== 'idle') {
      get().notify('A game is already running. Stop it first.', 'error')
      return
    }
    const wasConsole = get().consoleMode
    set({
      playState: {
        ...get().playState,
        gameId,
        state: 'launching',
        startedAt: new Date().toISOString(),
        pid: null,
        tracked: false,
        observing: false,
        observeUntil: null,
        notice: null
      }
    })
    try {
      const result = await api.launch.game(gameId)
      if (!result.ok) {
        set({ playState: emptyPlayState() })
        get().notify(result.message, 'error')
        return
      }
      get().notify(result.message, 'success')
      void get().refresh()
      if (wasConsole) {
        // Get out of the way of the game but keep Console Mode ready.
        window.setTimeout(() => undefined, 0)
      }
    } catch (error) {
      set({ playState: emptyPlayState() })
      get().notify(errorMessage(error), 'error')
    }
  },

  stopGame: async () => {
    try {
      const wasLaunching = get().playState.state === 'launching'
      await api.launch.stop()
      get().notify(wasLaunching ? 'Launch cancelled.' : 'Game session ended.', 'info')
      void get().refresh()
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  retryLaunch: async () => {
    const notice = get().playState.notice
    if (!notice) return
    set({
      playState: {
        ...emptyPlayState(),
        gameId: notice.gameId,
        state: 'launching',
        startedAt: new Date().toISOString()
      }
    })
    try {
      const result = await api.launch.retry()
      if (!result.ok) {
        await get().refresh()
        get().notify(result.message, 'error')
        return
      }
      get().notify(result.message, 'success')
      void get().refresh()
    } catch (error) {
      await get().refresh()
      get().notify(errorMessage(error), 'error')
    }
  },

  dismissLaunchNotice: async () => {
    try {
      set({ playState: await api.launch.dismissNotice() })
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  toggleFavorite: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    try {
      const updated = await api.library.setFavorite(gameId, !game.favorite)
      set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
      get().notify(updated.favorite ? `Added ${updated.title} to Favorites` : `Removed ${updated.title} from Favorites`)
      void get().refreshSummary()
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  updateGame: async (gameId, patch) => {
    try {
      const updated = await api.library.update(gameId, patch)
      set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
      await get().refreshSummary()
      return updated
    } catch (error) {
      get().notify(errorMessage(error), 'error')
      return null
    }
  },

  setCompletion: async (gameId, status) => {
    try {
      const updated = await api.library.setCompletion(gameId, status)
      set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
      await get().refreshSummary()
      get().notify(`Marked as ${status.replace('-', ' ')}`)
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  addPlaytime: async (gameId, seconds) => {
    try {
      const updated = await api.library.addPlaytime(gameId, seconds)
      set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
      await get().refreshSummary()
      get().notify(`Added ${Math.round(seconds / 60)} minutes of playtime`)
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  removeGame: async (gameId) => {
    try {
      await api.library.remove(gameId)
      set({ detailId: null, games: get().games.filter((g) => g.id !== gameId) })
      await get().refreshSummary()
      get().notify('Game removed from the library. Files on disk were not touched.')
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  updateSettings: async (patch) => {
    try {
      const settings = await api.settings.update(patch)
      set({ settings })
      void get().refresh()
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  refreshSections: async (sections) => {
    set({ sections })
    try {
      const home = await api.library.refreshHome()
      set({ home })
    } catch {
      /* ignore */
    }
  }
}))

export const selectGameById = (id: string | null): Game | undefined => {
  if (!id) return undefined
  return useStore.getState().games.find((game) => game.id === id)
}
