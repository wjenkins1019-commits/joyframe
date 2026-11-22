import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Image,
  Layers,
  Monitor,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Tv
} from 'lucide-react'
import type { AppSettings, BackupInfo, DemoStatus, HomeSection } from '@shared/types'
import { defaultRomOrder } from '@shared/rom-formats'
import { api, errorMessage } from '../../lib/api'
import { useStore } from '../../state/store'
import {
  Badge,
  Button,
  ConfirmInline,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Spinner,
  Toggle,
  cx
} from '../ui'
import { LogoMark, StudioMark, Wordmark } from '../Logo'
import { ControllerDiagnostics } from '../ControllerDiagnostics'

const ACCENTS = ['#D71935', '#0F86C9', '#7B3FE4', '#18A06B', '#C7861B']

export function SettingsView({ onScan }: { onScan: () => void }): React.JSX.Element {
  const settings = useStore((state) => state.settings)
  const info = useStore((state) => state.info)
  const updateSettings = useStore((state) => state.updateSettings)
  const notify = useStore((state) => state.notify)
  const setConsoleMode = useStore((state) => state.setConsoleMode)
  const sections = useStore((state) => state.sections)
  const platforms = useStore((state) => state.platforms)
  const collections = useStore((state) => state.collections)
  const refreshSections = useStore((state) => state.refreshSections)
  const refresh = useStore((state) => state.refresh)
  const [newSectionCollection, setNewSectionCollection] = useState('')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [libraryPaths, setLibraryPaths] = useState<{ path: string; kind: string }[]>([])
  const [demo, setDemo] = useState<DemoStatus | null>(null)
  const [confirmDemoRemove, setConfirmDemoRemove] = useState(false)

  useEffect(() => setDraft(settings), [settings])

  const loadMaintenance = async (): Promise<void> => {
    try {
      setBackups(await api.system.backups())
      setLibraryPaths(await api.library.paths())
      setDemo(await api.demo.status())
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    void loadMaintenance()
  }, [])

  const commit = (patch: Partial<AppSettings>): void => {
    setDraft((value) => ({ ...value, ...patch }))
    void updateSettings(patch)
  }

  const commitText = (key: keyof AppSettings): void => {
    if (draft[key] !== settings[key]) void updateSettings({ [key]: draft[key] } as Partial<AppSettings>)
  }

  const makeBackup = async (): Promise<void> => {
    setBusy('backup')
    try {
      const backup = await api.system.backup()
      await loadMaintenance()
      notify(`Backup created (${Math.round(backup.sizeBytes / 1024)} KB)`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const restore = async (path: string): Promise<void> => {
    setBusy('restore')
    try {
      await api.system.restore(path)
      notify('Restoring database — JOYFRAME will restart.', 'info')
    } catch (error) {
      notify(errorMessage(error), 'error')
      setBusy(null)
      setRestoreTarget(null)
    }
  }

  const seedDemo = async (): Promise<void> => {
    setBusy('demo-seed')
    try {
      const status = await api.demo.seed()
      setDemo(status)
      await refresh()
      notify(`Demo library installed — ${status.games} games, ${status.collections} collections.`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removeDemo = async (): Promise<void> => {
    setBusy('demo-remove')
    try {
      const status = await api.demo.remove()
      setDemo(status)
      await refresh()
      notify('Demo library removed — your own games were untouched.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const scanSaves = async (): Promise<void> => {
    setBusy('saves')
    try {
      const result = await api.saves.scan()
      notify(`Save-state scan complete — ${result.found} save files indexed.`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const romOrderPlatforms = platforms
    .filter((platform) => !platform.native && platform.extensions.length > 1)
    .map((platform) => ({
      platform,
      order: settings.romFormatPreferences[platform.id] ?? defaultRomOrder(platform.id, platform.extensions),
      overridden: Boolean(settings.romFormatPreferences[platform.id])
    }))

  const moveFormat = (platformId: string, order: string[], index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    void updateSettings({ romFormatPreferences: { ...settings.romFormatPreferences, [platformId]: next } })
  }

  const resetFormat = (platformId: string): void => {
    const next = { ...settings.romFormatPreferences }
    delete next[platformId]
    void updateSettings({ romFormatPreferences: next })
  }

  const reorderSection = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const ordered = [...sections]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(target, 0, moved)
    const result = await api.sections.reorder(ordered.map((section) => section.id))
    await refreshSections(result)
  }

  const patchSection = async (section: HomeSection, patch: Partial<HomeSection>): Promise<void> => {
    const result = await api.sections.update(section.id, patch)
    await refreshSections(result)
  }

  const forgetPath = async (path: string): Promise<void> => {
    try {
      await api.library.forgetPath(path)
      await loadMaintenance()
      notify('Folder removed from scan list. Games already imported were kept.')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Fine-tune how JOYFRAME looks, scans, enriches and launches. Everything is stored locally in SQLite."
        actions={
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void makeBackup()}>
            Back up database
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Appearance" description="Dark mode is the default JOYFRAME look." icon={<Sparkles className="h-4 w-4" />}>
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-jf-muted">Accent colour</p>
            <div className="flex items-center gap-2">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  data-nav="1"
                  aria-label={`Accent ${color}`}
                  onClick={() => commit({ themeAccent: color })}
                  className={cx(
                    'h-8 w-8 rounded-full border-2 transition',
                    draft.themeAccent === color ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'
                  )}
                  style={{ background: color }}
                />
              ))}
              <input
                type="color"
                value={draft.themeAccent}
                onChange={(event) => commit({ themeAccent: event.target.value })}
                className="ml-2 h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                aria-label="Custom accent colour"
              />
              <span className="ml-auto font-mono text-[11px] text-white/40">{draft.themeAccent}</span>
            </div>
          </div>
          <Toggle
            label="Reduce motion"
            description="Disable transitions and hover animations for a calmer, faster interface."
            checked={draft.reduceMotion}
            onChange={(value) => commit({ reduceMotion: value })}
          />
          <Toggle
            label="Show hidden games"
            description="Include games you have hidden in the library, rows and search."
            checked={draft.showHidden}
            onChange={(value) => commit({ showHidden: value })}
          />
        </Section>

        <Section title="Cinematic experience" description="Control hover previews, hero rotation and controller prompts." icon={<Monitor className="h-4 w-4" />}>
          <Toggle
            label="Automatic video previews"
            description="Play a muted trailer after hovering a game card for the preview delay."
            checked={draft.autoPreviews}
            onChange={(value) => commit({ autoPreviews: value })}
          />
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field label={`Preview delay — ${draft.previewDelay} ms`}>
              <input
                type="range"
                min={300}
                max={4000}
                step={100}
                value={draft.previewDelay}
                onChange={(event) => commit({ previewDelay: Number(event.target.value) })}
                className="accent-jf-red"
              />
            </Field>
            <Field label={`Preview volume — ${Math.round(draft.previewVolume * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.previewVolume}
                onChange={(event) => commit({ previewVolume: Number(event.target.value) })}
                className="accent-jf-red"
              />
            </Field>
            <Field label={`Hero rotation — ${draft.heroRotation === 0 ? 'off' : `${draft.heroRotation}s`}`}>
              <input
                type="range"
                min={0}
                max={45}
                step={3}
                value={draft.heroRotation}
                onChange={(event) => commit({ heroRotation: Number(event.target.value) })}
                className="accent-jf-red"
              />
            </Field>
            <Field label="Controller prompts">
              <Select
                value={draft.controllerPrompts}
                onChange={(event) => commit({ controllerPrompts: event.target.value as AppSettings['controllerPrompts'] })}
              >
                <option value="auto">Auto detect</option>
                <option value="xbox">Xbox</option>
                <option value="playstation">PlayStation</option>
                <option value="none">Hidden</option>
              </Select>
            </Field>
          </div>
          <Toggle
            label="Launch on double-click"
            description="Keep single-click for details and double-click to launch from the library."
            checked={draft.launchOnSelect}
            onChange={(value) => commit({ launchOnSelect: value })}
          />
        </Section>

        <Section title="Startup & Console Mode" description="Turn this PC into a living-room console." icon={<Tv className="h-4 w-4" />}>
          <Toggle
            label="Start in Console Mode"
            description="Open full-screen, controller-first and go straight to your games."
            checked={draft.consoleModeOnStartup}
            onChange={(value) => commit({ consoleModeOnStartup: value })}
          />
          <Toggle
            label="Automatically scan on startup"
            description="Rescan saved PC and ROM folders in the background after launch."
            checked={draft.autoScanOnStartup}
            onChange={(value) => commit({ autoScanOnStartup: value })}
          />
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Tv className="h-3.5 w-3.5" />}
              onClick={() => {
                setConsoleMode(true)
                void api.system.setFullScreen(true).catch(() => undefined)
              }}
            >
              Enter Console Mode now
            </Button>
          </div>
        </Section>

        <ControllerDiagnostics />

        <Section
          title="Home layout"
          description="Reorder, rename or hide dashboard rows, and surface any collection on the home page."
          icon={<Layers className="h-4 w-4" />}
        >
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {sections.map((section, index) => (
              <div key={section.id} className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/25 px-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <button
                    data-nav="1"
                    aria-label={`Move ${section.title} up`}
                    disabled={index === 0}
                    onClick={() => void reorderSection(index, -1)}
                    className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    data-nav="1"
                    aria-label={`Move ${section.title} down`}
                    disabled={index === sections.length - 1}
                    onClick={() => void reorderSection(index, 1)}
                    className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <input
                  key={`${section.id}-${section.title}`}
                  defaultValue={section.title}
                  aria-label={`Rename ${section.title}`}
                  onBlur={(event) => {
                    const title = event.target.value.trim()
                    if (title && title !== section.title) void patchSection(section, { title })
                  }}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-medium text-white/85 focus:bg-black/40"
                />
                <Badge tone="dark">{section.kind === 'collection' ? 'COLLECTION' : section.key}</Badge>
                <button
                  data-nav="1"
                  aria-label={`${section.hidden ? 'Show' : 'Hide'} ${section.title}`}
                  onClick={() => void patchSection(section, { hidden: !section.hidden })}
                  className={section.hidden ? 'text-white/25 hover:text-white' : 'text-white/60 hover:text-white'}
                >
                  {section.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              value={newSectionCollection}
              onChange={(event) => setNewSectionCollection(event.target.value)}
              className="h-9 max-w-[220px] flex-1 text-xs"
            >
              <option value="">Add a collection row…</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              disabled={!newSectionCollection}
              onClick={async () => {
                const collection = collections.find((entry) => entry.id === newSectionCollection)
                if (!collection) return
                const result = await api.sections.create(collection.name, collection.id)
                await refreshSections(result)
                setNewSectionCollection('')
                notify(`${collection.name} added to your home layout`, 'success')
              }}
            >
              Add row
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={async () => {
                const result = await api.sections.reset()
                await refreshSections(result)
                notify('Home layout reset to the built-in rows')
              }}
            >
              Reset layout
            </Button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Titles save when you click away. Hidden rows stay in this list so you can bring them back at any time.
          </p>
        </Section>

        <Section title="Metadata & artwork" description="Providers that enrich your library with descriptions and art." icon={<Image className="h-4 w-4" />}>
          <div className="space-y-3">
            <Field label="Preferred provider">
              <Select value={draft.metadataProvider} onChange={(event) => commit({ metadataProvider: event.target.value })}>
                <option value="steam">Steam Store (keyless)</option>
                <option value="igdb">IGDB (requires Twitch credentials)</option>
              </Select>
            </Field>
            <Toggle
              label="Store artwork on this PC"
              description="Off keeps posters, backdrops and screenshots as remote URLs, so scraping art costs no disk space. Trailers always stream from the provider."
              checked={draft.artworkStorage === 'cache'}
              onChange={(value) => commit({ artworkStorage: value ? 'cache' : 'remote' })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="IGDB client ID">
                <Input
                  value={draft.igdbClientId}
                  onChange={(event) => setDraft({ ...draft, igdbClientId: event.target.value })}
                  onBlur={() => commitText('igdbClientId')}
                  placeholder="Twitch application client ID"
                />
              </Field>
              <Field label="IGDB client secret">
                <Input
                  type="password"
                  value={draft.igdbClientSecret}
                  onChange={(event) => setDraft({ ...draft, igdbClientSecret: event.target.value })}
                  onBlur={() => commitText('igdbClientSecret')}
                  placeholder="Stored locally"
                />
              </Field>
            </div>
            <div className="rounded-lg border border-white/8 bg-black/25 p-3 text-[11px] leading-relaxed text-jf-muted">
              <p className="font-semibold text-white/75">Provider notes</p>
              <p className="mt-1">
                Steam Store metadata, trailers and screenshot art work without a key for Steam titles. IGDB requires a free
                Twitch developer application and also supplies art for retro and non-Steam titles. ScreenScraper needs developer
                credentials issued by that project and is not enabled in this build — you can always import your own artwork.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={async () => {
                  setBusy('refreshAll')
                  try {
                    const result = await api.metadata.refreshAll()
                    notify(`Refreshed ${result.updated} games (${result.failed} without matches).`, 'success')
                  } catch (error) {
                    notify(errorMessage(error), 'error')
                  } finally {
                    setBusy(null)
                  }
                }}
                disabled={busy === 'refreshAll'}
              >
                {busy === 'refreshAll' ? 'Refreshing…' : 'Refresh all metadata'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setBusy('saves')
                  try {
                    const result = await api.saves.scan()
                    notify(`Indexed ${result.found} save files.`, 'success')
                  } catch (error) {
                    notify(errorMessage(error), 'error')
                  } finally {
                    setBusy(null)
                  }
                }}
                disabled={busy === 'saves'}
              >
                Scan save states
              </Button>
            </div>
            <Field label="Metadata refresh interval (days)" hint="Used as a reminder threshold for manual refreshes.">
              <Input
                type="number"
                min={1}
                value={draft.metadataRefreshDays}
                onChange={(event) => setDraft({ ...draft, metadataRefreshDays: Number(event.target.value) })}
                onBlur={() => commitText('metadataRefreshDays')}
              />
            </Field>
          </div>
        </Section>

        <Section title="Steam" description="Steam handles accounts, DRM and installs — JOYFRAME only reads local data." icon={<Gamepad2 className="h-4 w-4" />}>
          <Field label="Steam installation folder" hint="Leave empty to auto-detect from the Windows registry.">
            <div className="flex gap-2">
              <Input
                value={draft.steamPath}
                onChange={(event) => setDraft({ ...draft, steamPath: event.target.value })}
                onBlur={() => commitText('steamPath')}
                placeholder="C:\Program Files (x86)\Steam"
              />
              <Button
                variant="secondary"
                icon={<FolderOpen className="h-4 w-4" />}
                onClick={async () => {
                  const folder = await api.system.pickFolder()
                  if (folder) commit({ steamPath: folder })
                }}
              >
                Browse
              </Button>
            </div>
          </Field>
          <p className="mt-3 text-[11px] leading-relaxed text-jf-muted">
            Importing uses <code className="text-white/70">libraryfolders.vdf</code>, <code className="text-white/70">appmanifest_*.acf</code> and your
            local <code className="text-white/70">localconfig.vdf</code> playtime. Steam must stay installed.
          </p>
        </Section>

        <Section title="Library & scanning" description="Folders JOYFRAME watches, plus playtime and backup behaviour." icon={<Database className="h-4 w-4" />}>
          <div className="mb-3 space-y-1.5">
            {libraryPaths.length === 0 && <p className="text-xs text-jf-muted">No scan folders saved yet.</p>}
            {libraryPaths.map((entry) => (
              <div key={entry.path} className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2">
                <Badge tone="dark">{entry.kind.toUpperCase()}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/70">{entry.path}</span>
                <button
                  className="text-[10px] font-semibold uppercase tracking-wide text-white/35 hover:text-red-400"
                  onClick={() => void forgetPath(entry.path)}
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onScan}>
              Manage & scan folders
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void scanSaves()} disabled={busy === 'saves'}>
              Scan saves
            </Button>
          </div>
          <div className="mt-4 rounded-lg border border-white/8 bg-black/25 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-jf-muted">ROM format preference</p>
            <p className="mt-1 text-[11px] leading-relaxed text-jf-muted">
              When one folder holds the same game in several formats, a scan imports only the first format available in
              this order. Changes apply to the next scan; platforms you never touch keep their built-in order.
            </p>
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {romOrderPlatforms.map(({ platform, order, overridden }) => (
                <div
                  key={platform.id}
                  className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-2 py-1.5"
                >
                  <span className="w-24 shrink-0 truncate text-[11px] font-semibold text-white/80" title={platform.name}>
                    {platform.shortName}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {order.map((ext, index) => (
                      <span
                        key={ext}
                        className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/75"
                      >
                        <button
                          data-nav="1"
                          aria-label={`Move ${ext} earlier for ${platform.name}`}
                          disabled={index === 0}
                          onClick={() => moveFormat(platform.id, order, index, -1)}
                          className="px-0.5 text-white/35 hover:text-white disabled:opacity-20"
                        >
                          ‹
                        </button>
                        {ext}
                        <button
                          data-nav="1"
                          aria-label={`Move ${ext} later for ${platform.name}`}
                          disabled={index === order.length - 1}
                          onClick={() => moveFormat(platform.id, order, index, 1)}
                          className="px-0.5 text-white/35 hover:text-white disabled:opacity-20"
                        >
                          ›
                        </button>
                      </span>
                    ))}
                  </div>
                  {overridden && (
                    <button
                      data-nav="1"
                      onClick={() => resetFormat(platform.id)}
                      className="text-[10px] font-semibold uppercase tracking-wide text-white/35 hover:text-white"
                    >
                      Reset
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Backups to keep">
              <Input
                type="number"
                min={1}
                max={50}
                value={draft.backupKeep}
                onChange={(event) => setDraft({ ...draft, backupKeep: Number(event.target.value) })}
                onBlur={() => commitText('backupKeep')}
              />
            </Field>
            <div className="flex items-end">
              <Toggle
                label="Track playtime"
                description="Measure sessions for games JOYFRAME launches."
                checked={draft.playtimeTracking}
                onChange={(value) => commit({ playtimeTracking: value })}
              />
            </div>
          </div>
        </Section>

        <Section title="Data, backups & recovery" description="Your database and artwork cache live on this machine only." icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-2 rounded-lg border border-white/8 bg-black/25 p-3 font-mono text-[10.5px] text-white/60">
            <p className="break-all">DB · {info.databasePath}</p>
            <p className="break-all">Art · {info.artworkDir}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              onClick={() => void api.system.revealPath(info.databasePath)}
            >
              Reveal database
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={busy === 'backup' ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
              onClick={() => void makeBackup()}
              disabled={busy === 'backup'}
            >
              Back up now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={async () => {
                await loadMaintenance()
                notify(`${backups.length} backups available`, 'info')
              }}
            >
              Refresh list
            </Button>
          </div>

          <div className="mt-4 max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {backups.length === 0 && <p className="text-xs text-jf-muted">No backups yet. One is created automatically on startup.</p>}
            {backups.map((backup) => (
              <div key={backup.path} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-white/80">{backup.name}</p>
                  <p className="text-[10px] text-white/35">
                    {new Date(backup.createdAt).toLocaleString()} · {Math.round(backup.sizeBytes / 1024)} KB
                  </p>
                </div>
                {restoreTarget === backup.path ? (
                  <ConfirmInline
                    question="Replace current library?"
                    confirmLabel="Restore & restart"
                    onConfirm={() => void restore(backup.path)}
                    onCancel={() => setRestoreTarget(null)}
                  />
                ) : (
                  <button
                    data-nav="1"
                    className="text-[10px] font-bold uppercase tracking-wide text-white/45 hover:text-white"
                    onClick={() => setRestoreTarget(backup.path)}
                    disabled={busy === 'restore'}
                  >
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Restoring replaces the current database with the selected backup and relaunches JOYFRAME. A safety copy is taken
            automatically before the swap.
          </div>
        </Section>

        <Section
          title="Demo library"
          description="A sample multi-platform library for showcasing and testing — no importing needed."
          icon={<Sparkles className="h-4 w-4" />}
        >
          <p className="text-[11px] leading-relaxed text-jf-muted">
            Seeds 15 games across PC, retro consoles and PlayStation (plus a demo emulator, two collections and
            spread-out playtime) so the dashboard, console mode and stats have something to show. Demo games live
            alongside your own library and are always marked — removal deletes only demo content.
          </p>
          {demo?.installed ? (
            <p className="mt-2 text-[11px] text-white/70">
              Installed: {demo.games} games · {demo.collections} collections · {demo.emulators} emulator
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-white/40">No demo content installed.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void seedDemo()}
              icon={busy === 'demo-seed' ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={busy !== null}
            >
              {demo?.installed ? 'Re-seed demo library' : 'Install demo library'}
            </Button>
            {demo?.installed &&
              (confirmDemoRemove ? (
                <ConfirmInline
                  question="Remove the demo games, collections and emulator?"
                  confirmLabel="Remove demo"
                  onConfirm={() => {
                    setConfirmDemoRemove(false)
                    void removeDemo()
                  }}
                  onCancel={() => setConfirmDemoRemove(false)}
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDemoRemove(true)}
                  disabled={busy !== null}
                >
                  Remove demo library
                </Button>
              ))}
          </div>
        </Section>

        <Section title="About JOYFRAME" description="Every Game. One Universe." icon={<Save className="h-4 w-4" />}>
          <div className="flex items-center gap-4">
            <LogoMark size={56} />
            <div>
              <Wordmark size={20} />
              <p className="mt-1 text-[11px] text-jf-muted">Version {info.version || '1.0.0'}</p>
              <div className="mt-2 flex items-center gap-2">
                <StudioMark size={24} />
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-jf-muted">A 965 Media creation</p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-jf-muted">
            <div>
              <span className="text-white/35">Electron</span>
              <p className="font-mono text-white/70">{info.electron}</p>
            </div>
            <div>
              <span className="text-white/35">Node</span>
              <p className="font-mono text-white/70">{info.node}</p>
            </div>
            <div>
              <span className="text-white/35">Platform</span>
              <p className="font-mono text-white/70">{info.platform}</p>
            </div>
            <div>
              <span className="text-white/35">Storage</span>
              <p className="font-mono text-white/70">SQLite (local)</p>
            </div>
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-white/30">
            JOYFRAME never bundles ROMs, BIOS files, firmware or game downloads. Provide your own legally obtained files.
            Steam, emulator and metadata services remain the property of their respective owners.
          </p>
        </Section>
      </div>
    </div>
  )
}
