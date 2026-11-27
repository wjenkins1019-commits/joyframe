import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  Clock,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Image as ImageIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from 'lucide-react'
import type {
  Collection,
  CompletionStatus,
  Emulator,
  Game,
  GameSave,
  LaunchMethod,
  Platform
} from '@shared/types'
import { api } from '../lib/api'
import { DataSourceNote } from './Credits'
import { formatDate, formatPlaytime, relativeTime } from '../lib/format'
import { Badge, Button, ConfirmInline, Field, Input, Select, Textarea } from './ui'

export interface ProfileState {
  emulatorId: string
  emulatorCore: string
  launchArgs: string
  controllerProfile: string
  resolution: string
  displayMode: string
  saveStateMode: 'none' | 'auto' | 'manual'
  saveStateSlot: string
  launchRomDirectly: boolean
}

export interface MethodForm {
  label: string
  kind: LaunchMethod['kind']
  target: string
  args: string
  emulatorId: string
  core: string
}

function InfoRow({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-xs">
      <span className="shrink-0 text-white/35">{label}</span>
      <span className="min-w-0 break-words text-right text-white/80">{value || '—'}</span>
    </div>
  )
}

function Card({
  title,
  icon,
  action,
  children
}: {
  title: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="jf-card rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export interface DetailCardsProps {
  game: Game
  platform: Platform | undefined
  emulator: Emulator | undefined
  emulators: Emulator[]
  memberOf: Collection[]
  isMetadataStale: boolean
  metadataUpdatedAt: string
  busy: string | null
  saves: GameSave[]
  profile: ProfileState | null
  profileSaved: boolean
  methodForm: MethodForm | null
  confirmDelete: boolean
  refreshMetadata: () => void
  setLightbox: Dispatch<SetStateAction<string | null>>
  setTrailer: Dispatch<SetStateAction<string | null>>
  setCompletion: (gameId: string, status: CompletionStatus) => void
  addPlaytime: (gameId: string, seconds: number) => void
  setSaves: Dispatch<SetStateAction<GameSave[]>>
  setProfile: Dispatch<SetStateAction<ProfileState | null>>
  saveProfile: () => void
  setMethodForm: Dispatch<SetStateAction<MethodForm | null>>
  addMethod: () => void
  setDefaultMethod: (methodId: string) => void
  removeMethod: (methodId: string) => void
  refreshSaves: (scan?: boolean) => void
  revealFiles: () => void
  hideGame: () => void
  setEditorOpen: Dispatch<SetStateAction<boolean>>
  setArtworkOpen: Dispatch<SetStateAction<boolean>>
  setConfirmDelete: Dispatch<SetStateAction<boolean>>
  removeGame: (gameId: string) => void
  refresh: () => void
}

export function DetailCards(props: DetailCardsProps): React.JSX.Element {
  const {
    game,
    platform,
    emulator,
    emulators,
    memberOf,
    isMetadataStale,
    metadataUpdatedAt,
    busy,
    saves,
    profile,
    profileSaved,
    methodForm,
    confirmDelete,
    refreshMetadata,
    setLightbox,
    setTrailer,
    setCompletion,
    addPlaytime,
    setSaves,
    setProfile,
    saveProfile,
    setMethodForm,
    addMethod,
    setDefaultMethod,
    removeMethod,
    refreshSaves,
    revealFiles,
    hideGame,
    setEditorOpen,
    setArtworkOpen,
    setConfirmDelete,
    removeGame,
    refresh
  } = props

  return (
    <div className="relative z-10 mx-auto grid max-w-[1180px] gap-5 px-8 pb-24 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card title="About this game">
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/72">
            {game.description || 'No description yet. Refresh metadata, or add details by editing the game.'}
          </p>
          {game.notes && (
            <div className="mt-3 rounded-lg border border-white/8 bg-black/25 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">Your notes</p>
              <p className="whitespace-pre-line text-xs leading-relaxed text-white/65">{game.notes}</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {game.metadataProvider && (
              <Badge tone="dark">
                Metadata: {game.metadataProvider} · {Math.round(game.metadataConfidence * 100)}%
              </Badge>
            )}
            {game.metadataProvider === 'rawg' && (
              <a
                href="https://rawg.io"
                onClick={(event) => {
                  event.preventDefault()
                  void api.system.openExternal('https://rawg.io')
                }}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/55 transition hover:text-white/85"
              >
                Data and images by RAWG
              </a>
            )}
            {isMetadataStale && (
              <button
                data-nav="1"
                onClick={() => void refreshMetadata()}
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-200/90 transition hover:bg-amber-500/20"
              >
                May be stale · updated {relativeTime(metadataUpdatedAt)} — refresh
              </button>
            )}
            {memberOf.map((collection) => (
              <Badge key={collection.id}>{collection.name}</Badge>
            ))}
          </div>
          <DataSourceNote className="mt-3" />
        </Card>

        {game.screenshots.length > 0 && (
          <Card title="Screenshots">
            <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {game.screenshots.map((shot, index) => (
                <button
                  key={`${shot.full}-${index}`}
                  data-nav="1"
                  className="h-[120px] w-[200px] shrink-0 overflow-hidden rounded-lg border border-white/10"
                  onClick={() => setLightbox(shot.local ?? shot.full)}
                >
                  <img src={shot.local ?? shot.full} alt={`${game.title} screenshot ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </Card>
        )}

        {game.videoUrl && (
          <Card title="Trailer & gameplay">
            {/* The page header already streams this trailer as a muted preview.
                A second <video> on the same HLS manifest stalls both. */}
            <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/30 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{game.videoName || 'Preview video'}</p>
                <p className="mt-0.5 text-[11px] text-white/40">Previewing above while you browse this page.</p>
              </div>
              <Button data-nav="1" size="sm" variant="secondary" onClick={() => setTrailer(game.videoUrl)}>
                Play trailer
              </Button>
            </div>
          </Card>
        )}

        <Card title="Playtime & progress" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Playtime', value: formatPlaytime(game.playtimeSeconds) },
              { label: 'Sessions', value: String(game.playCount) },
              { label: 'Last played', value: game.lastPlayed ? relativeTime(game.lastPlayed) : 'Never' },
              { label: 'Added', value: formatDate(game.addedAt) }
            ].map((entry) => (
              <div key={entry.label} className="rounded-lg border border-white/8 bg-black/25 p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">{entry.label}</p>
                <p className="mt-1 text-sm font-bold text-white">{entry.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Completion status" className="w-44">
              <Select
                value={game.completion}
                onChange={(event) => void setCompletion(game.id, event.target.value as CompletionStatus)}
              >
                <option value="unplayed">Unplayed</option>
                <option value="in-progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="abandoned">Abandoned</option>
              </Select>
            </Field>
            <div className="flex items-center gap-1.5 pb-0.5">
              <span className="mr-1 text-[11px] text-white/35">Manual playtime</span>
              <Button size="sm" variant="secondary" onClick={() => void addPlaytime(game.id, 15 * 60)}>
                +15m
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void addPlaytime(game.id, 60 * 60)}>
                +1h
              </Button>
            </div>
          </div>
        </Card>

        <Card
          title="Launch methods"
          icon={<Gamepad2 className="h-3.5 w-3.5" />}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() =>
                setMethodForm({ label: '', kind: game.emulatorId ? 'emulator' : 'executable', target: '', args: '', emulatorId: game.emulatorId ?? '', core: '' })
              }
            >
              Add
            </Button>
          }
        >
          <div className="space-y-2">
            {game.launchMethods.length === 0 && (
              <p className="text-xs text-jf-muted">
                No alternate launch methods. JOYFRAME uses the launch configuration above
                {game.emulatorId ? ` (${emulator?.name ?? 'emulator'})` : game.executable ? ` (${game.executable})` : ''}.
              </p>
            )}
            {game.launchMethods.map((method) => (
              <div key={method.id} className="rounded-lg border border-white/8 bg-black/25 p-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={method.isDefault ? 'red' : 'dark'}>
                    {method.isDefault ? 'Default' : method.kind === 'rom' ? 'Disc' : method.kind}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white/85">
                    {method.label || method.kind}
                  </span>
                  {!method.isDefault && (
                    <button className="text-[10px] font-bold uppercase text-white/35 hover:text-white" onClick={() => void setDefaultMethod(method.id)}>
                      Set default
                    </button>
                  )}
                  <button className="text-white/30 hover:text-red-400" aria-label="Remove launch method" onClick={() => void removeMethod(method.id)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-white/40">
                  {method.kind === 'steam' ? `steam://rungameid/${method.target}` : `${method.target} ${method.args}`}
                  {method.emulatorId ? ` · emulator ${emulators.find((entry) => entry.id === method.emulatorId)?.name ?? ''}` : ''}
                </p>
              </div>
            ))}
          </div>

          {methodForm && (
            <div className="mt-3 space-y-2 rounded-lg border border-jf-red/25 bg-black/30 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  placeholder="Label (e.g. RetroArch · Snes9x)"
                  value={methodForm.label}
                  onChange={(event) => setMethodForm({ ...methodForm, label: event.target.value })}
                />
                <Select
                  value={methodForm.kind}
                  onChange={(event) => setMethodForm({ ...methodForm, kind: event.target.value as LaunchMethod['kind'] })}
                >
                  <option value="executable">Executable</option>
                  <option value="emulator">Emulator</option>
                  <option value="steam">Steam app</option>
                  <option value="url">Protocol / URL</option>
                </Select>
                <Input
                  placeholder={methodForm.kind === 'steam' ? 'Steam App ID' : 'Target path'}
                  value={methodForm.target}
                  onChange={(event) => setMethodForm({ ...methodForm, target: event.target.value })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                <Input
                  placeholder="Arguments"
                  value={methodForm.args}
                  onChange={(event) => setMethodForm({ ...methodForm, args: event.target.value })}
                />
                <Select
                  value={methodForm.emulatorId}
                  onChange={(event) => setMethodForm({ ...methodForm, emulatorId: event.target.value })}
                >
                  <option value="">No emulator</option>
                  {emulators.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Input
                    placeholder="Core"
                    value={methodForm.core}
                    onChange={(event) => setMethodForm({ ...methodForm, core: event.target.value })}
                  />
                  <Button variant="primary" onClick={() => void addMethod()}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Details">
          <InfoRow label="Platform" value={platform?.name ?? game.platformId} />
          <InfoRow label="Developer" value={game.developer} />
          <InfoRow label="Publisher" value={game.publisher} />
          <InfoRow label="Released" value={game.releaseDate || game.releaseYear || '—'} />
          <InfoRow label="Genres" value={game.genres.join(', ')} />
          <InfoRow label="Rating" value={game.rating !== null ? `${game.rating} / 100` : '—'} />
          <InfoRow label="Source" value={game.source} />
          <InfoRow label="Installed" value={game.installed ? 'Yes' : 'No'} />
          <InfoRow label="Emulator" value={emulator?.name ?? '—'} />
          <InfoRow label="Core" value={game.emulatorCore} />
          <InfoRow label="Executable" value={<span className="break-all font-mono text-[10px]">{game.executable}</span>} />
          <InfoRow label="ROM" value={<span className="break-all font-mono text-[10px]">{game.romPath}</span>} />
          <InfoRow label="Install folder" value={<span className="break-all font-mono text-[10px]">{game.installDir}</span>} />
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={revealFiles} block>
              View files
            </Button>
          </div>
        </Card>

        <Card
          title="Save states"
          icon={<Save className="h-3.5 w-3.5" />}
          action={
            <Button size="sm" variant="ghost" onClick={() => void refreshSaves(true)} disabled={busy === 'scan-saves'}>
              {busy === 'scan-saves' ? 'Scanning…' : 'Scan'}
            </Button>
          }
        >
          {saves.length === 0 ? (
            <p className="text-xs leading-relaxed text-jf-muted">
              No save files indexed for this game. Point the emulator's save-state folder in Emulators, then scan. JOYFRAME
              only indexes saves — it never overwrites them.
            </p>
          ) : (
            <div className="space-y-2">
              {saves.map((save) => (
                <div key={save.id} className="flex items-start gap-2 rounded-lg border border-white/8 bg-black/25 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80">
                      <Badge tone={save.kind === 'emulator-state' ? 'red' : 'dark'}>{save.kind === 'emulator-state' ? 'State' : 'Native'}</Badge>
                      {save.label}
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/35">
                      {relativeTime(save.timestamp)} · {Math.max(1, Math.round(save.sizeBytes / 1024))} KB
                    </p>
                    <p className="truncate font-mono text-[9.5px] text-white/25">{save.path}</p>
                  </div>
                  <button
                    aria-label="Remove from save index"
                    title="Remove from index (file is kept)"
                    className="text-white/25 hover:text-red-400"
                    onClick={async () => {
                      await api.saves.remove(save.id)
                      setSaves(await api.saves.list(game.id))
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 rounded border border-amber-500/20 bg-amber-500/8 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/80">
            Resuming directly from a state depends on the emulator. JOYFRAME never assumes save-state compatibility and will
            not modify existing saves.
          </p>
        </Card>

        {profile && (
          <Card title="Per-game profile" icon={<Gamepad2 className="h-3.5 w-3.5" />}>
            <div className="space-y-2.5">
              <Field label="Preferred emulator">
                <Select value={profile.emulatorId} onChange={(event) => setProfile({ ...profile, emulatorId: event.target.value })}>
                  <option value="">Use default / executable</option>
                  {emulators.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Core">
                  <Input value={profile.emulatorCore} onChange={(event) => setProfile({ ...profile, emulatorCore: event.target.value })} />
                </Field>
                <Field label="State slot">
                  <Input value={profile.saveStateSlot} onChange={(event) => setProfile({ ...profile, saveStateSlot: event.target.value })} placeholder="0" />
                </Field>
              </div>
              <Field label="Launch arguments">
                <Input value={profile.launchArgs} onChange={(event) => setProfile({ ...profile, launchArgs: event.target.value })} placeholder="Overrides emulator args" />
              </Field>
              <label className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 text-[11px] leading-relaxed text-jf-muted">
                <input
                  type="checkbox"
                  data-nav="1"
                  checked={profile.launchRomDirectly}
                  onChange={(event) => setProfile({ ...profile, launchRomDirectly: event.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-jf-red"
                />
                <span>
                  <span className="font-semibold text-white/80">Launch the ROM directly</span>
                  <span className="block">
                    Passes the ROM to the emulator even when the arguments never mention <code>{'{rom}'}</code>. Turn it off to open
                    the emulator on its own.
                  </span>
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Controller profile">
                  <Input value={profile.controllerProfile} onChange={(event) => setProfile({ ...profile, controllerProfile: event.target.value })} placeholder="e.g. Xbox pad" />
                </Field>
                <Field label="Resolution">
                  <Input value={profile.resolution} onChange={(event) => setProfile({ ...profile, resolution: event.target.value })} placeholder="1920x1080" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Display mode">
                  <Select value={profile.displayMode} onChange={(event) => setProfile({ ...profile, displayMode: event.target.value })}>
                    <option value="">Default</option>
                    <option value="windowed">Windowed</option>
                    <option value="borderless">Borderless</option>
                    <option value="fullscreen">Fullscreen</option>
                  </Select>
                </Field>
                <Field label="Save-state behaviour">
                  <Select
                    value={profile.saveStateMode}
                    onChange={(event) => setProfile({ ...profile, saveStateMode: event.target.value as ProfileState['saveStateMode'] })}
                  >
                    <option value="none">Do not manage</option>
                    <option value="auto">Automatic (emulator)</option>
                    <option value="manual">Manual slots</option>
                  </Select>
                </Field>
              </div>
              <Field label="Personal notes" className="pt-1">
                <Textarea
                  rows={2}
                  value={game.notes}
                  onChange={(event) => {
                    const notes = event.target.value
                    void api.library.update(game.id, { notes }).then(() => refresh())
                  }}
                  placeholder="Notes are saved automatically"
                />
              </Field>
              <Button variant="primary" size="sm" block icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveProfile()} disabled={busy === 'profile'}>
                {profileSaved ? 'Profile saved' : 'Save profile'}
              </Button>
            </div>
          </Card>
        )}

        <Card title="Library management">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditorOpen(true)} icon={<Pencil className="h-3.5 w-3.5" />}>
              Edit details
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setArtworkOpen(true)} icon={<ImageIcon className="h-3.5 w-3.5" />}>
              Change artwork
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void hideGame()} icon={<EyeOff className="h-3.5 w-3.5" />}>
              Hide game
            </Button>
          </div>
          <div className="mt-3">
            {confirmDelete ? (
              <ConfirmInline
                question={`Remove ${game.title} from JOYFRAME?`}
                confirmLabel="Remove from library"
                onConfirm={() => void removeGame(game.id)}
                onCancel={() => setConfirmDelete(false)}
              />
            ) : (
              <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>
                Remove from library
              </Button>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Removing a game only deletes its JOYFRAME entry. Executables, ROMs and saves on disk are never deleted.
          </p>
        </Card>
      </div>
    </div>
  )
}
