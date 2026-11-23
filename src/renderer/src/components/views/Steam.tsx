import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Gamepad2, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react'
import type { SteamDetection } from '@shared/types'
import { api, errorMessage } from '../../lib/api'
import { describeRefresh } from '../../lib/refresh-summary'
import { useStore } from '../../state/store'
import { GameCard } from '../GameCard'
import { Badge, Button, CheckLine, EmptyState, PageHeader, Spinner } from '../ui'

export function SteamView(): React.JSX.Element {
  const games = useStore((state) => state.games)
  const settings = useStore((state) => state.settings)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)
  const updateSettings = useStore((state) => state.updateSettings)
  const setView = useStore((state) => state.setView)
  const [detection, setDetection] = useState<SteamDetection | null>(null)
  const [busy, setBusy] = useState<'detect' | 'import' | 'metadata' | null>(null)

  const steamGames = games.filter((game) => game.source === 'steam')

  useEffect(() => {
    setBusy('detect')
    api.steam
      .detect()
      .then(setDetection)
      .catch((error) => notify(errorMessage(error), 'error'))
      .finally(() => setBusy(null))
  }, [])

  const runDetection = async (): Promise<void> => {
    setBusy('detect')
    try {
      setDetection(await api.steam.detect())
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const runImport = async (): Promise<void> => {
    setBusy('import')
    try {
      const result = await api.steam.import()
      await refresh()
      await runDetection()
      if (result.errors.length) {
        notify(result.errors[0], 'error')
      } else {
        notify(`Steam import finished — ${result.added} added, ${result.updated} updated.`, 'success')
      }
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const chooseSteamFolder = async (): Promise<void> => {
    const folder = await api.system.pickFolder()
    if (!folder) return
    await updateSettings({ steamPath: folder })
    await runDetection()
  }

  const refreshMetadata = async (): Promise<void> => {
    setBusy('metadata')
    try {
      const result = await api.metadata.refreshAll()
      await refresh()
      const report = describeRefresh(result)
      notify(report.message, report.tone)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Steam"
        title="Steam Library"
        description="JOYFRAME reads your local Steam installation and app manifests. Steam stays installed and handles authentication, DRM and downloads — JOYFRAME just organizes and launches."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void runDetection()}>
              Re-detect
            </Button>
            <Button
              variant="primary"
              icon={busy === 'import' ? <Spinner /> : <DownloadIcon />}
              disabled={busy !== null}
              onClick={() => void runImport()}
            >
              {busy === 'import' ? 'Importing…' : 'Import Steam library'}
            </Button>
          </>
        }
      />

      <div className="mb-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="jf-card rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-jf-red/15 text-jf-red">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Installation</p>
              <p className="text-[11px] text-jf-muted">
                {detection?.found ? 'Steam found on this machine' : 'No Steam installation detected yet'}
              </p>
            </div>
            <div className="ml-auto">
              {detection?.found ? (
                <Badge tone="green">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                </Badge>
              ) : (
                <Badge tone="amber">
                  <AlertTriangle className="h-2.5 w-2.5" /> Not found
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-lg border border-white/8 bg-black/25 p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <span className="text-jf-muted">Steam folder</span>
              <span className="max-w-[70%] break-all text-right font-mono text-[11px] text-white/80">
                {detection?.steamPath || settings.steamPath || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-jf-muted">Libraries found</span>
              <span className="text-white/80">{detection?.libraryFolders.length ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-jf-muted">Installed Steam apps</span>
              <span className="text-white/80">{detection?.installedCount ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-jf-muted">Imported into JOYFRAME</span>
              <span className="text-white/80">{steamGames.length}</span>
            </div>
            {detection && detection.libraryFolders.length > 0 && (
              <div className="border-t border-white/8 pt-2">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Library folders</p>
                {detection.libraryFolders.map((folder) => (
                  <p key={folder} className="truncate font-mono text-[10px] text-white/50">
                    {folder}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void chooseSteamFolder()}>
              Choose Steam folder
            </Button>
            {detection?.steamPath && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void api.system.revealPath(detection.steamPath)}
              >
                Reveal on disk
              </Button>
            )}
          </div>
        </div>

        <div className="jf-card rounded-xl p-5">
          <p className="text-sm font-bold text-white">What gets imported</p>
          <div className="mt-3 space-y-2.5">
            <CheckLine>Every app manifest across all your Steam library folders.</CheckLine>
            <CheckLine>Installed and uninstalled titles, with install state and folder.</CheckLine>
            <CheckLine>Playtime and last-played dates read from Steam's local config.</CheckLine>
            <CheckLine>Library covers, hero art and logos from Steam's public CDN, cached locally.</CheckLine>
            <CheckLine>Launching delegates to Steam itself, so DRM and updates keep working.</CheckLine>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={busy === 'metadata' ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={busy !== null || steamGames.length === 0}
              onClick={() => void refreshMetadata()}
            >
              Refresh artwork & metadata
            </Button>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-white/30">
            Steam playtime is imported as a snapshot. JOYFRAME also tracks its own sessions while it is running.
          </p>
        </div>
      </div>

      {steamGames.length === 0 ? (
        <EmptyState
          icon={<Gamepad2 className="h-6 w-6" />}
          title={detection?.found ? 'Steam is ready to import' : 'Steam not found'}
          description={
            detection?.found
              ? 'Run the import to pull your Steam library into JOYFRAME.'
              : 'Install Steam, or point JOYFRAME at your Steam folder, then re-detect.'
          }
          action={
            detection?.found ? (
              <Button variant="primary" onClick={() => void runImport()} disabled={busy !== null}>
                Import now
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void chooseSteamFolder()}>
                Choose Steam folder
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/70">Steam games in your universe</h2>
            <button
              className="text-[11px] font-semibold uppercase tracking-wider text-jf-muted hover:text-white"
              onClick={() => setView('library')}
            >
              Open full library
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-x-4 gap-y-7">
            {steamGames.map((game) => (
              <GameCard key={game.id} game={game} fluid />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DownloadIcon(): React.JSX.Element {
  return <RefreshCw className="h-4 w-4" />
}
