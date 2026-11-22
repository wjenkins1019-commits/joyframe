import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ViewId } from '@shared/types'
import { LogoMark, StudioMark, Wordmark } from './components/Logo'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { BackdropLayer } from './components/BackdropLayer'
import { HomeView } from './components/views/Home'
import { LibraryView } from './components/views/Library'
import { CollectionsView } from './components/views/Collections'
import { SteamView } from './components/views/Steam'
import { EmulatorsView } from './components/views/Emulators'
import { StatsView } from './components/views/Stats'
import { SettingsView } from './components/views/Settings'
import { ConsoleMode } from './components/ConsoleMode'
import { GameDetail } from './components/GameDetail'
import { GameEditor } from './components/GameEditor'
import { ScanPanel } from './components/ScanPanel'
import { ControllerBar, Toasts } from './components/Chrome'
import { Button, cx } from './components/ui'
import { useSpatialNavigation } from './lib/navigation'
import { useStore } from './state/store'

const VIEW_ORDER: ViewId[] = ['home', 'library', 'collections', 'steam', 'emulators', 'stats']

function LoadingScreen(): React.JSX.Element {
  const info = useStore((state) => state.info)
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-jf-bg">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(215,25,53,0.22),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_90%,rgba(215,25,53,0.12),transparent_40%)]" />
      <div className="relative flex flex-col items-center animate-rise">
        <LogoMark size={92} className="drop-shadow-[0_24px_60px_rgba(215,25,53,0.45)]" />
        <div className="mt-7">
          <Wordmark size={34} tagline />
        </div>
        <div className="mt-10 h-0.5 w-52 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse-soft rounded-full bg-jf-red" />
        </div>
        <p className="mt-4 text-[11px] uppercase tracking-[0.3em] text-white/25">Indexing your universe</p>
        {info.version && <p className="mt-10 font-mono text-[10px] text-white/15">v{info.version}</p>}
        <div className="mt-3 flex items-center gap-2">
          <StudioMark size={22} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/30">A 965 Media creation</p>
        </div>
      </div>
    </div>
  )
}

function ErrorScreen(): React.JSX.Element {
  const error = useStore((state) => state.error)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-jf-bg px-10 text-center">
      <LogoMark size={60} />
      <AlertTriangle className="h-6 w-6 text-amber-400" />
      <h1 className="text-xl font-bold text-white">JOYFRAME could not start</h1>
      <p className="max-w-xl whitespace-pre-wrap text-sm text-jf-muted">{error}</p>
      <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>
        Try again
      </Button>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const ready = useStore((state) => state.ready)
  const loading = useStore((state) => state.loading)
  const error = useStore((state) => state.error)
  const view = useStore((state) => state.view)
  const settings = useStore((state) => state.settings)
  const consoleMode = useStore((state) => state.consoleMode)
  const notify = useStore((state) => state.notify)
  const [addOpen, setAddOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const bootstrapped = useRef(false)
  const autoScanned = useRef(false)

  useSpatialNavigation()

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    void useStore.getState().init()
  }, [])

  // Live main-process events.
  useEffect(() => {
    if (!window.joyframe) return
    const offPlay = window.joyframe.launch.onState((state) => {
      const previous = useStore.getState().playState
      useStore.setState({ playState: state })
      if (state.state === 'idle' && previous.state !== 'idle') {
        void useStore.getState().refresh()
      }
    })
    const offScan = window.joyframe.scans.onProgress((progress) => {
      useStore.getState().setScan(progress)
    })
    return () => {
      offPlay()
      offScan()
    }
  }, [])

  // Accent colour is a CSS custom property, so Tailwind utilities follow it.
  useEffect(() => {
    document.documentElement.style.setProperty('--color-jf-red', settings.themeAccent)
  }, [settings.themeAccent])

  useEffect(() => {
    if (!ready) return
    console.log(`[joyframe] UI ready — ${useStore.getState().games.length} games in library`)
  }, [ready])

  // Back / view-cycle / console events from the controller hook.
  useEffect(() => {
    // Modal layers never reach here: the spatial-navigation back handler
    // closes them first (see onBack in lib/navigation.ts).
    const back = (): void => {
      if (useStore.getState().detailId) {
        useStore.getState().closeDetail()
        return
      }
      if (useStore.getState().consoleMode) {
        useStore.getState().setConsoleMode(false)
        void window.joyframe.system.setFullScreen(false).catch(() => undefined)
        return
      }
      if (useStore.getState().view !== 'home') useStore.getState().setView('home')
    }
    const cycle = (direction: 1 | -1) => (): void => {
      const current = useStore.getState().view
      const index = VIEW_ORDER.indexOf(current)
      const next = VIEW_ORDER[(index + direction + VIEW_ORDER.length) % VIEW_ORDER.length]
      useStore.getState().setView(next)
    }
    const toggleConsole = (): void => {
      const next = !useStore.getState().consoleMode
      useStore.getState().setConsoleMode(next)
      void window.joyframe.system.setFullScreen(next).catch(() => undefined)
    }
    window.addEventListener('jf:back', back)
    window.addEventListener('jf:next-view', cycle(1))
    window.addEventListener('jf:prev-view', cycle(-1))
    window.addEventListener('jf:toggle-console', toggleConsole)
    return () => {
      window.removeEventListener('jf:back', back)
      window.removeEventListener('jf:next-view', cycle(1))
      window.removeEventListener('jf:prev-view', cycle(-1))
      window.removeEventListener('jf:toggle-console', toggleConsole)
    }
  }, [])

  // Background rescan on startup when enabled and folders are known.
  useEffect(() => {
    if (!ready || autoScanned.current || !settings.autoScanOnStartup) return
    autoScanned.current = true
    void (async () => {
      try {
        const paths = await window.joyframe.library.paths()
        const pc = paths.filter((entry) => entry.kind === 'pc').map((entry) => entry.path)
        const rom = paths.filter((entry) => entry.kind === 'rom').map((entry) => entry.path)
        if (!pc.length && !rom.length) return
        notify('Rescanning your library in the background…', 'info')
        if (pc.length) await window.joyframe.scans.pcFolders(pc)
        if (rom.length) await window.joyframe.scans.romFolders(rom)
        await useStore.getState().refresh()
      } catch {
        /* silent — startup scan is best-effort */
      }
    })()
  }, [ready, settings.autoScanOnStartup, notify])

  if (loading && !ready) return <LoadingScreen />
  if (error) return <ErrorScreen />
  if (!ready) return <LoadingScreen />

  return (
    <div className={cx('relative flex h-full w-full overflow-hidden bg-jf-bg', settings.reduceMotion && 'reduce-motion')}>
      {!consoleMode && <BackdropLayer />}
      <Sidebar hidden={consoleMode} />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar hidden={consoleMode} onAddGame={() => setAddOpen(true)} onScan={() => setScanOpen(true)} />

        <main
          data-jf-view={view}
          className={cx('scrollbar-none relative min-h-0 flex-1 overflow-y-auto', consoleMode ? '' : 'px-8 pt-6')}
        >
          {view === 'home' && (
            <HomeView onScan={() => setScanOpen(true)} onAddGame={() => setAddOpen(true)} />
          )}
          {view === 'library' && <LibraryView onAddGame={() => setAddOpen(true)} onScan={() => setScanOpen(true)} />}
          {view === 'collections' && <CollectionsView />}
          {view === 'steam' && <SteamView />}
          {view === 'emulators' && <EmulatorsView />}
          {view === 'stats' && <StatsView />}
          {view === 'settings' && <SettingsView onScan={() => setScanOpen(true)} />}
        </main>
      </div>

      {consoleMode && <ConsoleMode />}

      <GameDetail />
      <ControllerBar />
      <Toasts />

      <GameEditor open={addOpen} onClose={() => setAddOpen(false)} game={null} />
      <ScanPanel open={scanOpen} onClose={() => setScanOpen(false)} />

    </div>
  )
}
