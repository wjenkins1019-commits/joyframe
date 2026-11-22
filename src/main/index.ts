import { app, BrowserWindow, Menu, dialog, net, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AppInfo, AppSettings, PlayState } from '../shared/types.ts'
import { buildInitPayload, createContext, createHandlers, type AppContext } from './ipc.ts'
import { registerIpc } from './ipc-helpers.ts'
import { resolveArtworkPath } from './services/artwork.ts'
import { createBackup } from './services/backup.ts'
import { openDatabase, type Db } from './services/db.ts'
import { Launcher } from './services/launcher.ts'
import { getSettings } from './services/settings.ts'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let ctx: AppContext | null = null
let db: Db | null = null
let launcher: Launcher | null = null
let settingsState: AppSettings | null = null
let info: AppInfo
let shuttingDown = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jf-art',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(bootstrap).catch(handleFatal)
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)

  const userData = app.getPath('userData')
  const artworkDir = path.join(userData, 'artwork')
  const backupDir = path.join(userData, 'backups')
  const dbFile = path.join(userData, 'joyframe.db')
  fs.mkdirSync(artworkDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  info = {
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: userData,
    databasePath: dbFile,
    artworkDir,
    electron: process.versions.electron ?? '',
    node: process.versions.node ?? ''
  }

  if (process.env.JOYFRAME_DEBUG) console.log(`[joyframe] userData: ${userData}`)

  const database = openDatabase(dbFile)
  db = database
  settingsState = getSettings(database)

  launcher = new Launcher(database, {
    emit: (state: PlayState) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('play:state', state)
    },
    openExternal: async (url: string) => {
      if (!/^(https?:|steam:|mailto:)/i.test(url)) throw new Error('Blocked unsupported protocol')
      await shell.openExternal(url)
    },
    settings: () => settingsState as AppSettings
  })

  ctx = createContext(database, info, launcher, (next) => {
    settingsState = next
  })

  protocol.handle('jf-art', (request) => {
    const file = resolveArtworkPath(artworkDir, request.url)
    if (!file || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })

  registerIpc(createHandlers(ctx))

  createWindow()

  // Rotate an automatic backup on startup once the library has content.
  try {
    const count = database.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }
    if (count.c > 0) {
      await createBackup(database, backupDir, settingsState.backupKeep, 'startup')
    }
  } catch (error) {
    console.warn('Startup backup failed:', (error as Error).message)
    logToFile(`startup backup failed: ${(error as Error).message}`)
  }
}

function createWindow(): void {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon-512.png')

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#15171B',
    title: 'JOYFRAME',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#15171B', symbolColor: '#A5A9B2', height: 44 }
        : undefined,
    webPreferences: {
      preload: path.join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  if (ctx) ctx.window = mainWindow

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (process.env.JOYFRAME_DEBUG) console.log('[joyframe] window ready')
  })

  if (process.env.JOYFRAME_DEBUG) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[joyframe] failed to load ${url}: ${code} ${description}`)
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[joyframe] renderer gone: ${details.reason}`)
      logToFile(`renderer process gone: ${details.reason}`)
    })
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[joyframe] renderer loaded')
      setTimeout(() => {
        void mainWindow?.webContents
          .executeJavaScript(
            `(() => ({
              navItems: document.querySelectorAll('[data-nav="1"]').length,
              cards: document.querySelectorAll('[data-game-id]').length,
              rows: Array.from(document.querySelectorAll('section[aria-label]')).map((el) => el.getAttribute('aria-label')).slice(0, 30),
              hero: document.querySelector('section[aria-label="Featured game"]')?.innerText.split('\\n').slice(0, 6) ?? null,
              firstPaint: document.body.innerText.slice(0, 160)
            }))()`
          )
          .then((report) => console.log('[joyframe] DOM', JSON.stringify(report)))
          .catch((error) => console.error('[joyframe] DOM probe failed', error))
      }, 2600)
    })
  }

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (ctx) ctx.window = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(moduleDir, '../renderer/index.html'))
  }
}

app.on('window-all-closed', () => {
  launcher?.shutdown()
  app.quit()
})

app.on('before-quit', () => {
  if (shuttingDown) return
  shuttingDown = true
  launcher?.shutdown()
  try {
    db?.close()
  } catch {
    /* already closed */
  }
})

function logToFile(message: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'joyframe.log'), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* logging must never crash the app */
  }
}

process.on('uncaughtException', (error) => {
  logToFile(`uncaught exception: ${error.stack ?? error.message}`)
})

process.on('unhandledRejection', (reason) => {
  logToFile(`unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
})

function handleFatal(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  console.error('JOYFRAME failed to start:', message)
  logToFile(`startup failure: ${message}`)
  dialog.showErrorBox('JOYFRAME failed to start', message)
  app.quit()
}

export { buildInitPayload }
