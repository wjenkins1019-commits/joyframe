import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FolderOpen,
  Plus,
  Radar,
  Save,
  Trash2
} from 'lucide-react'
import type { Emulator } from '@shared/types'
import { api, errorMessage } from '../../lib/api'
import { useStore } from '../../state/store'
import {
  Badge,
  Button,
  ConfirmInline,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  Toggle,
  cx
} from '../ui'

interface TestResult {
  ok: boolean
  message: string
  command: string
}

export function EmulatorsView(): React.JSX.Element {
  const emulators = useStore((state) => state.emulators)
  const platforms = useStore((state) => state.platforms)
  const games = useStore((state) => state.games)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)

  const [detecting, setDetecting] = useState(false)
  const [editor, setEditor] = useState<Partial<Emulator> | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const platformGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>()
    for (const platform of platforms) {
      if (platform.native) continue
      const list = map.get(platform.family) ?? []
      list.push({ id: platform.id, name: platform.shortName })
      map.set(platform.family, list)
    }
    return [...map.entries()]
  }, [platforms])

  const romGameCount = (emulatorId: string): number =>
    games.filter((game) => game.emulatorId === emulatorId).length

  const detect = async (): Promise<void> => {
    setDetecting(true)
    try {
      const found = await api.emulators.detect()
      await refresh()
      notify(
        found.length
          ? `Found ${found.length} emulator${found.length === 1 ? '' : 's'} on this machine.`
          : 'No known emulators found in the common install locations. Add one manually below.',
        found.length ? 'success' : 'info'
      )
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setDetecting(false)
    }
  }

  const test = async (emulator: Emulator): Promise<void> => {
    setTestingId(emulator.id)
    try {
      const result = await api.emulators.test(emulator.id, emulator.platformIds[0])
      setTests((prev) => ({ ...prev, [emulator.id]: result }))
      notify(result.ok ? `${emulator.name} configuration looks valid.` : result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setTestingId(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await api.emulators.remove(id)
      setConfirmRemove(null)
      await refresh()
      notify('Emulator removed from JOYFRAME. The emulator itself is untouched.')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const pickExecutable = async (): Promise<void> => {
    const file = await api.system.pickFile([
      { name: 'Executables', extensions: ['exe', 'app', 'AppImage', 'sh'] }
    ])
    if (file) setEditor((prev) => ({ ...(prev ?? {}), path: file, name: prev?.name || file.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') }))
  }

  const save = async (): Promise<void> => {
    if (!editor?.path) {
      notify('Choose the emulator executable first.', 'error')
      return
    }
    setSaving(true)
    try {
      if (editor.id) {
        await api.emulators.update(editor.id, editor)
      } else {
        await api.emulators.add(editor)
      }
      setEditor(null)
      await refresh()
      notify('Emulator saved.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const togglePlatform = (platformId: string): void => {
    setEditor((prev) => {
      if (!prev) return prev
      const current = prev.platformIds ?? []
      const next = current.includes(platformId)
        ? current.filter((id) => id !== platformId)
        : [...current, platformId]
      return { ...prev, platformIds: next }
    })
  }

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Emulation"
        title="Emulator Ecosystem"
        description="JOYFRAME detects emulators, assigns them to platforms and builds the launch command for every ROM. Your emulator installs, cores and BIOS files stay yours."
        actions={
          <>
            <Button
              variant="secondary"
              icon={detecting ? <Spinner /> : <Radar className="h-4 w-4" />}
              disabled={detecting}
              onClick={() => void detect()}
            >
              {detecting ? 'Scanning…' : 'Detect emulators'}
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditor({ platformIds: [], argsTemplate: '"{rom}"' })}>
              Add emulator
            </Button>
          </>
        }
      />

      {emulators.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-6 w-6" />}
          title="No emulators configured"
          description="Run detection to find RetroArch, Dolphin, PCSX2, DuckStation, PPSSPP, mGBA and more — or add any emulator manually with its executable and launch arguments."
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void detect()} icon={<Radar className="h-4 w-4" />}>
                Detect installed emulators
              </Button>
              <Button variant="secondary" onClick={() => setEditor({ platformIds: [], argsTemplate: '"{rom}"' })}>
                Add manually
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          {emulators.map((emulator) => (
            <div key={emulator.id} className="jf-card rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-white">{emulator.name}</h3>
                    {emulator.detected ? <Badge tone="green">Detected</Badge> : <Badge>Manual</Badge>}
                    <Badge tone="dark">{romGameCount(emulator.id)} games</Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-white/45">{emulator.path}</p>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {emulator.platformIds.map((platformId) => (
                      <span
                        key={platformId}
                        className="rounded border border-white/10 bg-white/6 px-1.5 py-0.5 text-[10px] font-semibold text-white/70"
                      >
                        {platforms.find((p) => p.id === platformId)?.shortName ?? platformId}
                      </span>
                    ))}
                    {emulator.platformIds.length === 0 && <span className="text-[11px] text-amber-300/80">No platforms assigned</span>}
                  </div>

                  <div className="mt-3 grid gap-2 text-[11px] text-jf-muted sm:grid-cols-2">
                    <div>
                      <span className="text-white/35">Launch args</span>
                      <p className="break-all font-mono text-white/70">{emulator.argsTemplate || '"{rom}"'}</p>
                    </div>
                    <div>
                      <span className="text-white/35">Core / core folder</span>
                      <p className="break-all font-mono text-white/70">
                        {emulator.core || '—'}
                        {emulator.coreDir ? ` · ${emulator.coreDir}` : ''}
                      </p>
                    </div>
                    <div>
                      <span className="text-white/35">Fullscreen preset</span>
                      <p className="break-all font-mono text-white/70">
                        {emulator.fullscreenSupported ? emulator.fullscreenArgs : 'No verified flag — set it in the emulator'}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-white/35">Save states</span>
                      <p className="break-all font-mono text-white/70">{emulator.saveStateDir || 'Not configured'}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Toggle
                      label="Start games in fullscreen"
                      description={
                        emulator.fullscreenSupported
                          ? `Adds ${emulator.fullscreenArgs} before the ROM so the game opens fullscreen.`
                          : 'No verified fullscreen flag for this emulator, so launches stay windowed and nothing extra is passed.'
                      }
                      checked={emulator.fullscreenSupported && emulator.fullscreen}
                      disabled={!emulator.fullscreenSupported}
                      onChange={(value) => void api.emulators.update(emulator.id, { fullscreen: value }).then(refresh)}
                    />
                  </div>

                  {tests[emulator.id] && (
                    <div
                      className={cx(
                        'mt-3 rounded-lg border px-3 py-2 text-[11px]',
                        tests[emulator.id].ok
                          ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
                          : 'border-amber-500/25 bg-amber-500/8 text-amber-200'
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        {tests[emulator.id].ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        {tests[emulator.id].message}
                      </div>
                      {tests[emulator.id].command && (
                        <p className="mt-1 break-all font-mono text-[10px] opacity-70">{tests[emulator.id].command}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void test(emulator)}
                    disabled={testingId === emulator.id}
                  >
                    {testingId === emulator.id ? 'Checking…' : 'Test config'}
                  </Button>
                  <IconButton label="Edit emulator" onClick={() => setEditor(emulator)}>
                    <Save className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Reveal executable" onClick={() => void api.system.revealPath(emulator.path)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                  </IconButton>
                  {confirmRemove === emulator.id ? (
                    <ConfirmInline
                      question="Remove?"
                      onConfirm={() => void remove(emulator.id)}
                      onCancel={() => setConfirmRemove(null)}
                    />
                  ) : (
                    <IconButton label="Remove emulator" onClick={() => setConfirmRemove(emulator.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-white/8 bg-black/25 p-5 text-xs leading-relaxed text-jf-muted">
        <p className="mb-2 font-bold uppercase tracking-wider text-white/70">How launching works</p>
        <p>
          Each ROM game stores an emulator, core and argument template. JOYFRAME substitutes <code className="text-white/80">{'{rom}'}</code>,{' '}
          <code className="text-white/80">{'{core}'}</code> and           <code className="text-white/80">{'{game}'}</code> then starts the emulator
          detached so your library stays responsive. Emulators with a known fullscreen flag get it added before the ROM unless you switch that
          off; unrecognised emulators launch exactly as written. Validate a configuration with <strong>Test config</strong> — it checks the executable,
          core file and placeholders without launching a game. Advanced per-game preferences live on each game page.
        </p>
      </div>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.id ? 'Edit emulator' : 'Add emulator'}
        subtitle="Point JOYFRAME at the emulator executable and map it to platforms."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving} icon={<Save className="h-4 w-4" />}>
              {saving ? 'Saving…' : 'Save emulator'}
            </Button>
          </>
        }
      >
        {editor && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <Field label="Name">
                <Input value={editor.name ?? ''} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="RetroArch" />
              </Field>
              <Field label="Executable">
                <div className="flex gap-2">
                  <Input value={editor.path ?? ''} onChange={(event) => setEditor({ ...editor, path: event.target.value })} placeholder="C:\Emulators\RetroArch\retroarch.exe" />
                  <Button variant="secondary" onClick={() => void pickExecutable()} icon={<FolderOpen className="h-4 w-4" />}>
                    Browse
                  </Button>
                </div>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-jf-muted">Platforms</p>
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-white/8 bg-black/25 p-3">
                {platformGroups.map(([family, items]) => (
                  <div key={family}>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">{family}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((platform) => {
                        const active = (editor.platformIds ?? []).includes(platform.id)
                        return (
                          <button
                            key={platform.id}
                            onClick={() => togglePlatform(platform.id)}
                            className={cx(
                              'rounded border px-2 py-0.5 text-[11px] font-semibold transition',
                              active
                                ? 'border-jf-red/60 bg-jf-red/20 text-white'
                                : 'border-white/10 bg-white/4 text-white/55 hover:text-white'
                            )}
                          >
                            {platform.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Launch arguments" hint="Use {rom}, {core}, {game}, {dir} and {stateSlot} placeholders.">
                <Input
                  value={editor.argsTemplate ?? ''}
                  onChange={(event) => setEditor({ ...editor, argsTemplate: event.target.value })}
                  placeholder='-L "{core}" "{rom}"'
                />
              </Field>
              <Field label="Default core" hint="RetroArch core file name, e.g. snes9x_libretro.dll">
                <Input value={editor.core ?? ''} onChange={(event) => setEditor({ ...editor, core: event.target.value })} />
              </Field>
              <Field label="Core folder">
                <Input value={editor.coreDir ?? ''} onChange={(event) => setEditor({ ...editor, coreDir: event.target.value })} placeholder="C:\Emulators\RetroArch\cores" />
              </Field>
              <Field label="Save state folder" hint="JOYFRAME only indexes saves here; it never modifies them.">
                <Input
                  value={editor.saveStateDir ?? ''}
                  onChange={(event) => setEditor({ ...editor, saveStateDir: event.target.value })}
                />
              </Field>
            </div>

            <Field label="Notes">
              <Textarea
                rows={2}
                value={editor.notes ?? ''}
                onChange={(event) => setEditor({ ...editor, notes: event.target.value })}
                placeholder="Controller profile, required BIOS notes, shader setup…"
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
