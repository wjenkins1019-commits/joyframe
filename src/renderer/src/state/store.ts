import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type {
  AppInfo,
  AppSettings,
  Collection,
  CompletionStatus,
  Emulator,
  Game,
  HomeRow,
  HomeSection,
  InitPayload,
  PlayState,
  Platform,
  ProviderStatus,
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
  settings: AppSettings
  stats: StatsSummary
  home: HomeRow[]
  info: AppInfo
  playState: PlayState
  lastPlayed: Game | null
  providers: ProviderStatus[]
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
  setView: (view: ViewId) => void
  setSearch: (value: string) => void
  openDetail: (id: string) => void
  closeDetail: () => void
  setConsoleMode: (on: boolean) => void
  setPreview: (id: string | null) => void
  notify: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  setScan: (progress: ScanProgress | null) => void
  setController: (connected: boolean, name?: string, kind?: 'xbox' | 'playstation' | 'generic') => void
  play: (gameId: string) => Promise<void>
  stopGame: () => Promise<void>
  toggleFavorite: (gameId: string) => Promise<void>
  updateGame: (gameId: string, patch: Partial<Game>) => Promise<Game | null>
  setCompletion: (gameId: string, status: CompletionStatus) => Promise<void>
  addPlaytime: (gameId: string, seconds: number) => Promise<void>
  removeGame: (gameId: string) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshSections: (sections: HomeSection[]) => Promise<void>
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

const fallbackSettings: AppSettings = DEFAULT_SETTINGS

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
    providers: payload.providers,
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
  playState: { gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false },
  lastPlayed: null,
  providers: [],
  view: 'home',
  detailId: null,
  consoleMode: false,
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

  setView: (view) => set({ view, detailId: null }),
  setSearch: (search) => set({ search }),
  openDetail: (id) => set({ detailId: id }),
  closeDetail: () => set({ detailId: null }),
  setConsoleMode: (on) => set({ consoleMode: on }),
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
    set({ playState: { ...get().playState, gameId, state: 'launching' } })
    try {
      const result = await api.launch.game(gameId)
      if (!result.ok) {
        set({ playState: { gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false } })
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
      set({ playState: { gameId: null, state: 'idle', startedAt: null, pid: null, tracked: false } })
      get().notify(errorMessage(error), 'error')
    }
  },

  stopGame: async () => {
    try {
      await api.launch.stop()
      get().notify('Game session ended.', 'info')
      void get().refresh()
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
      void get().refresh()
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  updateGame: async (gameId, patch) => {
    try {
      const updated = await api.library.update(gameId, patch)
      await get().refresh()
      return updated
    } catch (error) {
      get().notify(errorMessage(error), 'error')
      return null
    }
  },

  setCompletion: async (gameId, status) => {
    try {
      await api.library.setCompletion(gameId, status)
      await get().refresh()
      get().notify(`Marked as ${status.replace('-', ' ')}`)
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  addPlaytime: async (gameId, seconds) => {
    try {
      await api.library.addPlaytime(gameId, seconds)
      await get().refresh()
      get().notify(`Added ${Math.round(seconds / 60)} minutes of playtime`)
    } catch (error) {
      get().notify(errorMessage(error), 'error')
    }
  },

  removeGame: async (gameId) => {
    try {
      await api.library.remove(gameId)
      set({ detailId: null })
      await get().refresh()
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
