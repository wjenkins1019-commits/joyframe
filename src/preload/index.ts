import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { JoyframeApi } from '../shared/types.ts'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: JoyframeApi = {
  init: () => ipcRenderer.invoke('app:init'),
  library: {
    list: (query) => ipcRenderer.invoke('library:list', query),
    get: (id) => ipcRenderer.invoke('library:get', id),
    addManual: (input) => ipcRenderer.invoke('library:add', input),
    update: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    setFavorite: (id, favorite) => ipcRenderer.invoke('library:favorite', id, favorite),
    setHidden: (id, hidden) => ipcRenderer.invoke('library:hidden', id, hidden),
    setCompletion: (id, status) => ipcRenderer.invoke('library:completion', id, status),
    merge: (primaryId, duplicateId) => ipcRenderer.invoke('library:merge', primaryId, duplicateId),
    addMethod: (gameId, method) => ipcRenderer.invoke('library:addMethod', gameId, method),
    removeMethod: (methodId) => ipcRenderer.invoke('library:removeMethod', methodId),
    setDefaultMethod: (methodId) => ipcRenderer.invoke('library:setDefaultMethod', methodId),
    refreshHome: () => ipcRenderer.invoke('library:refreshHome'),
    addPlaytime: (id, seconds) => ipcRenderer.invoke('library:addPlaytime', id, seconds),
    paths: () => ipcRenderer.invoke('library:paths'),
    forgetPath: (target) => ipcRenderer.invoke('library:forgetPath', target)
  },
  scans: {
    pcFolders: (paths) => ipcRenderer.invoke('scan:pc', paths),
    romFolders: (paths) => ipcRenderer.invoke('scan:rom', paths),
    onProgress: (callback) => subscribe('scan:progress', callback)
  },
  steam: {
    detect: () => ipcRenderer.invoke('steam:detect'),
    import: () => ipcRenderer.invoke('steam:import'),
    launch: (gameId) => ipcRenderer.invoke('steam:launch', gameId)
  },
  emulators: {
    list: () => ipcRenderer.invoke('emulators:list'),
    detect: () => ipcRenderer.invoke('emulators:detect'),
    add: (input) => ipcRenderer.invoke('emulators:add', input),
    update: (id, patch) => ipcRenderer.invoke('emulators:update', id, patch),
    remove: (id) => ipcRenderer.invoke('emulators:remove', id),
    test: (id, platformId) => ipcRenderer.invoke('emulators:test', id, platformId)
  },
  launch: {
    game: (gameId) => ipcRenderer.invoke('launch:game', gameId),
    stop: () => ipcRenderer.invoke('launch:stop'),
    retry: () => ipcRenderer.invoke('launch:retry'),
    dismissNotice: () => ipcRenderer.invoke('launch:dismiss'),
    state: () => ipcRenderer.invoke('launch:state'),
    onState: (callback) => subscribe('play:state', callback)
  },
  collections: {
    list: () => ipcRenderer.invoke('collections:list'),
    create: (input) => ipcRenderer.invoke('collections:create', input),
    update: (id, patch) => ipcRenderer.invoke('collections:update', id, patch),
    remove: (id) => ipcRenderer.invoke('collections:remove', id),
    addGame: (collectionId, gameId) => ipcRenderer.invoke('collections:addGame', collectionId, gameId),
    removeGame: (collectionId, gameId) => ipcRenderer.invoke('collections:removeGame', collectionId, gameId),
    reorder: (orderedIds) => ipcRenderer.invoke('collections:reorder', orderedIds)
  },
  sections: {
    list: () => ipcRenderer.invoke('sections:list'),
    update: (id, patch) => ipcRenderer.invoke('sections:update', id, patch),
    reorder: (orderedIds) => ipcRenderer.invoke('sections:reorder', orderedIds),
    create: (title, collectionId) => ipcRenderer.invoke('sections:create', title, collectionId),
    reset: () => ipcRenderer.invoke('sections:reset')
  },
  metadata: {
    refresh: (gameId) => ipcRenderer.invoke('metadata:refresh', gameId),
    searchCandidates: (gameId) => ipcRenderer.invoke('metadata:candidates', gameId),
    setArtwork: (gameId, kind, url) => ipcRenderer.invoke('metadata:setArtwork', gameId, kind, url),
    pickLocalArtwork: (gameId, kind) => ipcRenderer.invoke('metadata:pickArtwork', gameId, kind),
    setLocalFile: (gameId, kind, filePath) => ipcRenderer.invoke('metadata:setLocalFile', gameId, kind, filePath),
    refreshAll: () => ipcRenderer.invoke('metadata:refreshAll')
  },
  saves: {
    list: (gameId) => ipcRenderer.invoke('saves:list', gameId),
    scan: () => ipcRenderer.invoke('saves:scan'),
    remove: (id) => ipcRenderer.invoke('saves:remove', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  },
  stats: {
    get: () => ipcRenderer.invoke('stats:get')
  },
  demo: {
    status: () => ipcRenderer.invoke('demo:status'),
    seed: () => ipcRenderer.invoke('demo:seed'),
    remove: () => ipcRenderer.invoke('demo:remove')
  },
  system: {
    pickFolder: () => ipcRenderer.invoke('system:pickFolder'),
    pickFile: (filters) => ipcRenderer.invoke('system:pickFile', filters),
    revealPath: (target) => ipcRenderer.invoke('system:reveal', target),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
    backup: (options) => ipcRenderer.invoke('system:backup', options),
    backups: () => ipcRenderer.invoke('system:backups'),
    restore: (target) => ipcRenderer.invoke('system:restore', target),
    quit: () => ipcRenderer.invoke('system:quit'),
    setFullScreen: (on) => ipcRenderer.invoke('system:fullscreen', on)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    summary: () => ipcRenderer.invoke('app:summary'),
    markIntroPlayed: () => ipcRenderer.invoke('app:introPlayed')
  }
}

contextBridge.exposeInMainWorld('joyframe', api)
