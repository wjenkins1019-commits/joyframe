import type { BrowserWindow } from 'electron'
import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AppInfo,
  AppSettings,
  ArtworkCandidate,
  Collection,
  Emulator,
  Game,
  HomeSection,
  InitPayload,
  LaunchMethod,
  LaunchResult,
  LibraryQuery,
  LibrarySummary,
  ScanProgress,
  ScanResult,
  SettingsPatch,
  SteamDetection
} from '../shared/types.ts'
import { createBackup, listBackups, restoreBackup } from './services/backup.ts'
import type { Db } from './services/db.ts'
import { demoStatus, removeDemoLibrary, seedDemoLibrary } from './services/demo.ts'
import { addEmulator, detectEmulators, listEmulators, removeEmulator, testEmulator, updateEmulator } from './services/emulators.ts'
import { Launcher } from './services/launcher.ts'
import {
  addGamesToCollection,
  buildHomeRows,
  createCollection,
  createSection,
  getStats,
  listCollections,
  listSections,
  removeCollection,
  removeGameFromCollection,
  reorderCollections,
  reorderSections,
  resetSections,
  updateCollection,
  updateSection
} from './services/library.ts'
import {
  artworkCandidates,
  enrichGame,
  refreshAll,
  setArtwork,
  setLocalArtwork
} from './services/metadata.ts'
import { getPlatforms, getGame, insertGame, mergeGames, nowIso, queryGames, uid, updateGameRecord, deleteGame } from './services/repo.ts'
import { markSavesScanned, listSaves, removeSaveRecord, scanSaves, saveSummary } from './services/saves.ts'
import { scanPcFolders, scanRomFolders } from './services/scanner.ts'
import { getMeta, getSettings, publicSettings, setMeta, updateSettings } from './services/settings.ts'
import { detectSteam, importSteamGames, steamLaunchUrl } from './services/steam.ts'
import { registerIpc } from './ipc-helpers.ts'

export interface AppContext {
  db: Db
  window: BrowserWindow | null
  info: AppInfo
  launcher: Launcher
  getDb: () => Db
  setSettings: (settings: AppSettings) => void
}

export function createContext(db: Db, info: AppInfo, launcher: Launcher, setSettings: (s: AppSettings) => void): AppContext {
  return {
    db,
    window: null,
    info,
    launcher,
    getDb: () => db,
    setSettings
  }
}

export { registerIpc }

/** Home shelves honour the hidden-games setting even when one query served every section. */
function visibleGames(games: Game[], showHidden: boolean): Game[] {
  return showHidden ? games : games.filter((game) => !game.hidden)
}

function mostRecentlyPlayed(games: Game[]): Game | null {
  return (
    [...games]
      .filter((g) => g.lastPlayed)
      .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime())[0] ?? null
  )
}

/**
 * Build the parts of the payload a mutation can change, reusing a single game
 * query for collections, statistics and shelves instead of loading the whole
 * library four times.
 */
export function buildSummaryPayload(ctx: AppContext): LibrarySummary {
  const settings = getSettings(ctx.db)
  const games = queryGames(ctx.db, {}, true)
  const collections = listCollections(ctx.db, games)
  return {
    collections,
    stats: getStats(ctx.db, games),
    home: buildHomeRows(ctx.db, settings.showHidden, visibleGames(games, settings.showHidden), collections),
    lastPlayedGame: mostRecentlyPlayed(games)
  }
}

export function buildInitPayload(ctx: AppContext): InitPayload {
  const settings = getSettings(ctx.db)
  const games = queryGames(ctx.db, {}, true)
  const collections = listCollections(ctx.db, games)
  return {
    games,
    platforms: getPlatforms(ctx.db),
    collections,
    sections: listSections(ctx.db),
    emulators: listEmulators(ctx.db),
    settings: publicSettings(settings),
    stats: getStats(ctx.db, games),
    home: buildHomeRows(ctx.db, settings.showHidden, visibleGames(games, settings.showHidden), collections),
    info: ctx.info,
    playState: ctx.launcher.getState(),
    lastPlayedGame: mostRecentlyPlayed(games),
    introPlayed: getMeta(ctx.db, 'introPlayed') === '1'
  }
}

export function broadcast(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

export function createHandlers(ctx: AppContext) {
  const emitProgress = (progress: ScanProgress): void => broadcast(ctx.window, 'scan:progress', progress)

  const metadataDeps = () => {
    const settings = getSettings(ctx.db)
    return {
      db: ctx.db,
      settings,
      artworkDir: ctx.info.artworkDir,
      cacheArtwork: settings.artworkStorage === 'cache'
    }
  }

  const handlers: Record<string, (...args: never[]) => unknown> = {
    'app:init': () => {
      const payload = buildInitPayload(ctx)
      if (process.env.JOYFRAME_DEBUG) {
        console.log(
          `[joyframe] init — ${payload.games.length} games, ${payload.collections.length} collections, ${payload.emulators.length} emulators`
        )
      }
      return payload
    },
    'app:info': () => ctx.info,
    'app:summary': () => buildSummaryPayload(ctx),
    'app:introPlayed': () => {
      setMeta(ctx.db, 'introPlayed', '1')
    },

    'library:list': (query: LibraryQuery) => queryGames(ctx.db, query ?? {}, getSettings(ctx.db).showHidden),
    'library:get': (id: string) => getGame(ctx.db, id),
    'library:add': (input: Partial<Game>) => {
      const game = insertGame(ctx.db, {
        ...input,
        title: input.title?.trim() || 'Untitled Game',
        source: input.source ?? 'manual',
        platformId: input.platformId ?? 'windows'
      })
      return game
    },
    'library:update': (id: string, patch: Partial<Game>) => updateGameRecord(ctx.db, id, patch),
    'library:remove': (id: string) => deleteGame(ctx.db, id),
    'library:favorite': (id: string, favorite: boolean) => updateGameRecord(ctx.db, id, { favorite }),
    'library:hidden': (id: string, hidden: boolean) => updateGameRecord(ctx.db, id, { hidden }),
    'library:completion': (id: string, status: Game['completion']) => updateGameRecord(ctx.db, id, { completion: status }),
    'library:merge': (primaryId: string, duplicateId: string): Game => mergeGames(ctx.db, primaryId, duplicateId),
    'library:addMethod': (gameId: string, method: Partial<LaunchMethod>) => {
      const isFirst =
        (ctx.db.prepare('SELECT COUNT(*) AS c FROM launch_methods WHERE game_id = ?').get(gameId) as { c: number }).c ===
        0
      ctx.db
        .prepare(
          'INSERT INTO launch_methods (id, game_id, label, kind, target, args, emulator_id, core, is_default) VALUES (?,?,?,?,?,?,?,?,?)'
        )
        .run(
          uid(),
          gameId,
          method.label ?? 'Launch method',
          method.kind ?? 'executable',
          method.target ?? '',
          method.args ?? '',
          method.emulatorId ?? null,
          method.core ?? '',
          method.isDefault || isFirst ? 1 : 0
        )
      return getGame(ctx.db, gameId)
    },
    'library:removeMethod': (methodId: string) => {
      const row = ctx.db.prepare('SELECT game_id FROM launch_methods WHERE id = ?').get(methodId) as
        | { game_id: string }
        | undefined
      ctx.db.prepare('DELETE FROM launch_methods WHERE id = ?').run(methodId)
      return row ? getGame(ctx.db, row.game_id) : null
    },
    'library:setDefaultMethod': (methodId: string) => {
      const row = ctx.db.prepare('SELECT game_id FROM launch_methods WHERE id = ?').get(methodId) as
        | { game_id: string }
        | undefined
      if (!row) throw new Error('Launch method not found')
      ctx.db.prepare('UPDATE launch_methods SET is_default = 0 WHERE game_id = ?').run(row.game_id)
      ctx.db.prepare('UPDATE launch_methods SET is_default = 1 WHERE id = ?').run(methodId)
      return getGame(ctx.db, row.game_id)
    },
    'library:refreshHome': () => buildHomeRows(ctx.db, getSettings(ctx.db).showHidden),
    'library:paths': () =>
      ctx.db.prepare('SELECT path, kind FROM library_paths ORDER BY kind ASC, path ASC').all(),
    'library:forgetPath': (target: string) =>
      Number(ctx.db.prepare('DELETE FROM library_paths WHERE path = ?').run(target).changes) > 0,
    'library:addPlaytime': (id: string, seconds: number) => {
      const game = getGame(ctx.db, id)
      if (!game) throw new Error('Game not found')
      return updateGameRecord(ctx.db, id, {
        playtimeSeconds: Math.max(0, game.playtimeSeconds + Math.round(seconds)),
        lastPlayed: seconds > 0 ? nowIso() : game.lastPlayed
      })
    },

    'scan:pc': async (paths: string[]): Promise<ScanResult> => scanPcFolders(ctx.db, paths, emitProgress),
    'scan:rom': async (paths: string[]): Promise<ScanResult> => {
      const settings = getSettings(ctx.db)
      let snapshotTaken = false
      return scanRomFolders(ctx.db, paths, emitProgress, undefined, settings.romFormatPreferences, {
        // The first rescan that would permanently fold entries takes a backup
        // first, so a mis-grouped multi-disc set can be restored.
        beforeFirstMerge: async () => {
          if (snapshotTaken) return
          snapshotTaken = true
          await createBackup(
            ctx.db,
            path.join(path.dirname(ctx.info.databasePath), 'backups'),
            settings.backupKeep,
            'pre-merge'
          )
        }
      })
    },

    'steam:detect': async (): Promise<SteamDetection> => {
      const settings = getSettings(ctx.db)
      const detection = await detectSteam(ctx.db, settings.steamPath)
      if (detection.found && !settings.steamPath) {
        const next = updateSettings(ctx.db, { steamPath: detection.steamPath })
        ctx.setSettings(next)
      }
      return detection
    },
    'steam:import': async (): Promise<ScanResult> => {
      const settings = getSettings(ctx.db)
      const result = await importSteamGames(ctx.db, emitProgress, settings.steamPath)
      if (result.steamPath && !settings.steamPath) {
        ctx.setSettings(updateSettings(ctx.db, { steamPath: result.steamPath }))
      }
      return result
    },
    'steam:launch': async (gameId: string): Promise<LaunchResult> => {
      const url = steamLaunchUrl(gameId, ctx.db)
      if (!url) throw new Error('This is not a Steam game')
      return ctx.launcher.launch(gameId)
    },

    'emulators:list': () => listEmulators(ctx.db),
    'emulators:detect': async (): Promise<Emulator[]> => detectEmulators(ctx.db),
    'emulators:add': (input: Partial<Emulator>) => addEmulator(ctx.db, input),
    'emulators:update': (id: string, patch: Partial<Emulator>) => updateEmulator(ctx.db, id, patch),
    'emulators:remove': (id: string) => removeEmulator(ctx.db, id),
    'emulators:test': (id: string, platformId?: string) => testEmulator(ctx.db, id, platformId),

    'launch:game': (gameId: string) => ctx.launcher.launch(gameId),
    'launch:stop': () => ctx.launcher.stop(),
    'launch:retry': () => ctx.launcher.retry(),
    'launch:dismiss': () => ctx.launcher.dismissNotice(),
    'launch:state': () => ctx.launcher.getState(),

    'collections:list': () => listCollections(ctx.db),
    'collections:create': (input: Partial<Collection>) => createCollection(ctx.db, input),
    'collections:update': (id: string, patch: Partial<Collection>) => updateCollection(ctx.db, id, patch),
    'collections:remove': (id: string) => removeCollection(ctx.db, id),
    'collections:addGame': (collectionId: string, gameId: string) => {
      addGamesToCollection(ctx.db, collectionId, [gameId])
      return listCollections(ctx.db).find((c) => c.id === collectionId)
    },
    'collections:removeGame': (collectionId: string, gameId: string) => {
      removeGameFromCollection(ctx.db, collectionId, gameId)
      return listCollections(ctx.db).find((c) => c.id === collectionId)
    },
    'collections:reorder': (orderedIds: string[]) => reorderCollections(ctx.db, orderedIds),

    'sections:list': () => listSections(ctx.db),
    'sections:update': (id: string, patch: Partial<HomeSection>) => updateSection(ctx.db, id, patch),
    'sections:reorder': (orderedIds: string[]) => reorderSections(ctx.db, orderedIds),
    'sections:create': (title: string, collectionId: string) => createSection(ctx.db, title, collectionId),
    'sections:reset': () => resetSections(ctx.db),

    'metadata:refresh': (gameId: string) => enrichGame(metadataDeps(), gameId, true),
    'metadata:candidates': async (gameId: string) => {
      const game = getGame(ctx.db, gameId)
      if (!game) throw new Error('Game not found')
      return artworkCandidates(game)
    },
    'metadata:setArtwork': (gameId: string, kind: ArtworkCandidate['kind'], url: string) =>
      setArtwork(metadataDeps(), gameId, kind, url),
    'metadata:pickArtwork': async (gameId: string, kind: ArtworkCandidate['kind']) => {
      if (!ctx.window) return null
      const result = await dialog.showOpenDialog(ctx.window, {
        title: 'Choose artwork',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      return setLocalArtwork(metadataDeps(), gameId, kind, result.filePaths[0])
    },
    'metadata:setLocalFile': (gameId: string, kind: ArtworkCandidate['kind'], filePath: string) =>
      setLocalArtwork(metadataDeps(), gameId, kind, filePath),
    'metadata:refreshAll': () => refreshAll(metadataDeps()),

    'saves:list': (gameId: string) => listSaves(ctx.db, gameId),
    'saves:scan': async () => {
      const result = await scanSaves(ctx.db)
      markSavesScanned(ctx.db)
      return result
    },
    'saves:remove': (id: string) => removeSaveRecord(ctx.db, id),

    'settings:get': () => publicSettings(getSettings(ctx.db)),
    'settings:update': (patch: SettingsPatch) => {
      const next = updateSettings(ctx.db, patch)
      ctx.setSettings(next)
      return publicSettings(next)
    },

    'stats:get': () => getStats(ctx.db),

    'demo:status': () => demoStatus(ctx.db),
    'demo:seed': () => seedDemoLibrary(ctx.db, ctx.info.userDataPath, ctx.info.artworkDir),
    'demo:remove': () => removeDemoLibrary(ctx.db, ctx.info.userDataPath, ctx.info.artworkDir),

    'system:pickFolder': async () => {
      if (!ctx.window) return null
      const result = await dialog.showOpenDialog(ctx.window, {
        title: 'Select a folder',
        properties: ['openDirectory']
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    'system:pickFile': async (filters?: { name: string; extensions: string[] }[]) => {
      if (!ctx.window) return null
      const result = await dialog.showOpenDialog(ctx.window, {
        title: 'Select a file',
        properties: ['openFile'],
        filters: filters?.length ? filters : [{ name: 'Executables', extensions: ['exe'] }]
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    'system:reveal': (target: string) => {
      if (fs.existsSync(target)) shell.showItemInFolder(target)
    },
    'system:openExternal': async (url: string) => {
      if (!/^(https?:|steam:|mailto:)/i.test(url)) throw new Error('Only web, Steam and mail links can be opened')
      await shell.openExternal(url)
    },
    'system:backup': () => createBackup(ctx.db, path.join(path.dirname(ctx.info.databasePath), 'backups'), 10, 'manual'),
    'system:backups': () => listBackups(path.join(path.dirname(ctx.info.databasePath), 'backups')),
    'system:restore': async (target: string) => {
      restoreBackup(ctx.db, ctx.info.databasePath, target)
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 400)
      return true
    },
    'system:quit': () => {
      ctx.launcher.shutdown()
      app.quit()
    },
    'system:fullscreen': (on: boolean) => {
      ctx.window?.setFullScreen(on)
      return true
    }
  }

  return handlers
}

export function saveSummaryHandler(ctx: AppContext) {
  void saveSummary(ctx.db)
}

export type { LaunchMethod, HomeSection, ScanResult, ScanProgress, SteamDetection, ArtworkCandidate }
