import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Gamepad2, HardDrive, Plus, Radar, RefreshCw, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useStore } from '../state/store'
import { Badge, Button, Field, Modal, Spinner, Toggle, cx } from './ui'

interface PathEntry {
  path: string
  kind: string
}

export function ScanPanel({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const scan = useStore((state) => state.scan)
  const setScan = useStore((state) => state.setScan)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)
  const settings = useStore((state) => state.settings)
  const updateSettings = useStore((state) => state.updateSettings)
  const [paths, setPaths] = useState<PathEntry[]>([])
  const [busy, setBusy] = useState<'pc' | 'rom' | 'steam' | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const loadPaths = async (): Promise<void> => {
    try {
      setPaths(await api.library.paths())
    } catch {
      setPaths([])
    }
  }

  useEffect(() => {
    if (open) void loadPaths()
  }, [open])

  const addFolder = async (kind: 'pc' | 'rom'): Promise<void> => {
    const folder = await api.system.pickFolder()
    if (!folder) return
    if (paths.some((entry) => entry.path === folder)) {
      notify('That folder is already in the scan list.', 'info')
      return
    }
    setPaths((prev) => [...prev, { path: folder, kind }])
    if (kind === 'pc') await scanPc([folder])
    else await scanRom([folder])
  }

  const scanPc = async (extra: string[] = []): Promise<void> => {
    const folders = [...paths.filter((entry) => entry.kind === 'pc').map((entry) => entry.path), ...extra]
    if (!folders.length) {
      notify('Add a PC games folder first.', 'error')
      return
    }
    setBusy('pc')
    try {
      const result = await api.scans.pcFolders(folders)
      await refresh()
      await loadPaths()
      setLastResult(`PC scan: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped in ${Math.round(result.elapsedMs / 1000)}s.`)
      notify(result.errors.length ? result.errors[0] : `PC scan complete — ${result.added} games added.`, result.errors.length ? 'error' : 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
      setScan(null)
    }
  }

  const scanRom = async (extra: string[] = []): Promise<void> => {
    const folders = [...paths.filter((entry) => entry.kind === 'rom').map((entry) => entry.path), ...extra]
    if (!folders.length) {
      notify('Add a ROM folder first.', 'error')
      return
    }
    setBusy('rom')
    try {
      const result = await api.scans.romFolders(folders)
      await refresh()
      await loadPaths()
      setLastResult(`ROM scan: ${result.added} added, ${result.skipped} skipped in ${Math.round(result.elapsedMs / 1000)}s.`)
      notify(result.errors.length ? result.errors[0] : `ROM scan complete — ${result.added} ROMs added.`, result.errors.length ? 'error' : 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
      setScan(null)
    }
  }

  const importSteam = async (): Promise<void> => {
    setBusy('steam')
    try {
      const result = await api.steam.import()
      await refresh()
      setLastResult(`Steam import: ${result.added} added, ${result.updated} updated.`)
      notify(result.errors.length ? result.errors[0] : `Steam import complete — ${result.added} games added.`, result.errors.length ? 'error' : 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const forget = async (path: string): Promise<void> => {
    await api.library.forgetPath(path)
    await loadPaths()
  }

  const scanning = busy !== null || (scan !== null && scan.phase !== 'done' && scan.phase !== 'error')
  const progressPercent = scan && scan.found > 0 ? Math.min(96, 12 + scan.found * 2) : scan?.phase === 'done' ? 100 : 18

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scan & import"
      subtitle="JOYFRAME indexes files in place — nothing is moved, copied or downloaded."
      width="max-w-3xl"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-black/25 p-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-jf-red" />
              <p className="text-sm font-bold text-white">PC games</p>
              <Badge tone="dark" className="ml-auto">
                {paths.filter((entry) => entry.kind === 'pc').length} folders
              </Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-jf-muted">
              Folders containing installed games. JOYFRAME groups executables by folder and filters out installers,
              redistributables and crash handlers.
            </p>
            <div className="mt-3 space-y-1.5">
              {paths
                .filter((entry) => entry.kind === 'pc')
                .map((entry) => (
                  <div key={entry.path} className="flex items-center gap-2 rounded border border-white/8 bg-white/3 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-white/60">{entry.path}</span>
                    <button className="text-white/25 hover:text-red-400" onClick={() => void forget(entry.path)} aria-label="Forget folder">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void addFolder('pc')} disabled={scanning}>
                Add & scan
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void scanPc()} disabled={scanning}>
                Rescan all
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-black/25 p-4">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-jf-red" />
              <p className="text-sm font-bold text-white">ROM collections</p>
              <Badge tone="dark" className="ml-auto">
                {paths.filter((entry) => entry.kind === 'rom').length} folders
              </Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-jf-muted">
              Platforms are detected from file extensions and folder names. .cue/.bin pairs are grouped, and BIOS or
              firmware files are ignored.
            </p>
            <div className="mt-3 space-y-1.5">
              {paths
                .filter((entry) => entry.kind === 'rom')
                .map((entry) => (
                  <div key={entry.path} className="flex items-center gap-2 rounded border border-white/8 bg-white/3 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-white/60">{entry.path}</span>
                    <button className="text-white/25 hover:text-red-400" onClick={() => void forget(entry.path)} aria-label="Forget folder">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void addFolder('rom')} disabled={scanning}>
                Add & scan
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void scanRom()} disabled={scanning}>
                Rescan all
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/25 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-jf-red/15 text-jf-red">
              <Gamepad2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Steam library</p>
              <p className="text-[11px] text-jf-muted">
                Reads local manifests, installed state and recorded playtime. Steam handles DRM and downloads.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void importSteam()} disabled={scanning} icon={busy === 'steam' ? <Spinner /> : <Radar className="h-3.5 w-3.5" />}>
              {busy === 'steam' ? 'Importing…' : 'Import Steam'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/25 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white">Save state discovery</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setBusy('pc')
                try {
                  const result = await api.saves.scan()
                  notify(`Indexed ${result.found} save files.`, 'success')
                } catch (error) {
                  notify(errorMessage(error), 'error')
                } finally {
                  setBusy(null)
                }
              }}
              disabled={scanning}
            >
              Scan saves now
            </Button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-jf-muted">
            Indexes RetroArch, Dolphin, PCSX2, PPSSPP and sidecar save files matching your ROMs. Files are read-only — JOYFRAME
            never overwrites saves.
          </p>
        </div>

        {(scan || lastResult) && (
          <div className="rounded-xl border border-white/10 bg-[#1a1d22] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-white">
                {scan?.phase === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Spinner />}
                {scan?.message ?? lastResult}
              </p>
              {scan && <Badge tone="dark">{scan.found} found</Badge>}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className={cx('h-full rounded-full bg-jf-red transition-all', scanning && 'animate-pulse-soft')}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {scan?.current && <p className="mt-1.5 truncate font-mono text-[10px] text-white/30">{scan.current}</p>}
            {scan?.errors && scan.errors.length > 0 && (
              <p className="mt-2 rounded border border-red-500/20 bg-red-500/8 px-2 py-1 text-[10px] text-red-200">{scan.errors[0]}</p>
            )}
          </div>
        )}

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-200/85">
          JOYFRAME never bundles or downloads ROMs, BIOS files, firmware or copyrighted artwork. Only add files you own and
          are legally allowed to use.
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-white/8 pt-3">
          <div className="flex items-center gap-4">
            <Field label="Scan folders on startup">
              <Toggle
                label=""
                checked={settings.autoScanOnStartup}
                onChange={(value) => void updateSettings({ autoScanOnStartup: value })}
              />
            </Field>
            <p className="max-w-[280px] text-[10px] text-white/30">
              Background rescan using the folders above. The interface stays responsive.
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void api.system.revealPath(paths[0]?.path ?? '')}>
            Reveal first folder
          </Button>
        </div>
      </div>
    </Modal>
  )
}
