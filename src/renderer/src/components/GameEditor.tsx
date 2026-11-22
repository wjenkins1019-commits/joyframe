import { useEffect, useState } from 'react'
import { FolderOpen, Image as ImageIcon, Save } from 'lucide-react'
import type { Game } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useStore } from '../state/store'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'

interface FormState {
  title: string
  platformId: string
  description: string
  releaseYear: string
  developer: string
  publisher: string
  genres: string
  rating: string
  installed: boolean
  executable: string
  installDir: string
  romPath: string
  emulatorId: string
  emulatorCore: string
  launchArgs: string
  notes: string
}

const emptyForm: FormState = {
  title: '',
  platformId: 'windows',
  description: '',
  releaseYear: '',
  developer: '',
  publisher: '',
  genres: '',
  rating: '',
  installed: true,
  executable: '',
  installDir: '',
  romPath: '',
  emulatorId: '',
  emulatorCore: '',
  launchArgs: '',
  notes: ''
}

function toForm(game: Game): FormState {
  return {
    title: game.title,
    platformId: game.platformId,
    description: game.description,
    releaseYear: game.releaseYear ? String(game.releaseYear) : '',
    developer: game.developer,
    publisher: game.publisher,
    genres: game.genres.join(', '),
    rating: game.rating !== null ? String(game.rating) : '',
    installed: game.installed,
    executable: game.executable,
    installDir: game.installDir,
    romPath: game.romPath,
    emulatorId: game.emulatorId ?? '',
    emulatorCore: game.emulatorCore,
    launchArgs: game.launchArgs,
    notes: game.notes
  }
}

export function GameEditor({
  open,
  onClose,
  game
}: {
  open: boolean
  onClose: () => void
  game: Game | null
}): React.JSX.Element {
  const platforms = useStore((state) => state.platforms)
  const emulators = useStore((state) => state.emulators)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [coverFile, setCoverFile] = useState('')
  const [backgroundFile, setBackgroundFile] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(game ? toForm(game) : emptyForm)
    setCoverFile('')
    setBackgroundFile('')
  }, [open, game?.id])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const pick = async (kind: 'exe' | 'folder' | 'rom' | 'image'): Promise<string | null> => {
    if (kind === 'folder') return api.system.pickFolder()
    if (kind === 'image') {
      return api.system.pickFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }])
    }
    return api.system.pickFile([
      kind === 'exe'
        ? { name: 'Executables', extensions: ['exe', 'app', 'sh'] }
        : { name: 'Game files', extensions: ['iso', 'bin', 'cue', 'chd', 'nes', 'sfc', 'n64', 'gba', 'zip', 'rvz', 'gdi'] }
    ])
  }

  const save = async (): Promise<void> => {
    if (!form.title.trim()) {
      notify('A title is required.', 'error')
      return
    }
    setSaving(true)
    try {
      const patch: Partial<Game> = {
        title: form.title.trim(),
        platformId: form.platformId,
        description: form.description,
        releaseYear: form.releaseYear ? Number(form.releaseYear) : null,
        developer: form.developer,
        publisher: form.publisher,
        genres: form.genres
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        rating: form.rating ? Number(form.rating) : null,
        installed: form.installed,
        executable: form.executable,
        installDir: form.installDir,
        romPath: form.romPath,
        emulatorId: form.emulatorId || null,
        emulatorCore: form.emulatorCore,
        launchArgs: form.launchArgs,
        notes: form.notes
      }

      let saved: Game
      if (game) {
        saved = await api.library.update(game.id, patch)
        notify('Game updated', 'success')
      } else {
        saved = await api.library.addManual({ ...patch, source: form.romPath ? 'rom-scan' : 'manual' })
        notify(`${saved.title} added to your library`, 'success')
      }

      if (coverFile) {
        await api.metadata.setLocalFile(saved.id, 'cover', coverFile)
        setCoverFile('')
      }
      if (backgroundFile) {
        await api.metadata.setLocalFile(saved.id, 'background', backgroundFile)
        setBackgroundFile('')
      }

      await refresh()
      onClose()
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={game ? 'Edit game' : 'Add a game'}
      subtitle={game ? 'Update metadata, launch paths and per-game defaults.' : 'Anything you own — a PC executable, a ROM, or a store shortcut.'}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : game ? 'Save changes' : 'Add game'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
          <Field label="Title">
            <Input value={form.title} onChange={(event) => set('title', event.target.value)} placeholder="Game title" autoFocus />
          </Field>
          <Field label="Platform">
            <Select value={form.platformId} onChange={(event) => set('platformId', event.target.value)}>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Optional — metadata refresh can fill this in." />
        </Field>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Release year">
            <Input value={form.releaseYear} onChange={(event) => set('releaseYear', event.target.value)} placeholder="1998" inputMode="numeric" />
          </Field>
          <Field label="Developer">
            <Input value={form.developer} onChange={(event) => set('developer', event.target.value)} />
          </Field>
          <Field label="Publisher">
            <Input value={form.publisher} onChange={(event) => set('publisher', event.target.value)} />
          </Field>
          <Field label="Rating">
            <Input value={form.rating} onChange={(event) => set('rating', event.target.value)} placeholder="0–100" inputMode="numeric" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Genres" hint="Comma separated — used by smart collections and rows.">
            <Input value={form.genres} onChange={(event) => set('genres', event.target.value)} placeholder="Action, RPG" />
          </Field>
          <Field label="Install state">
            <Select value={form.installed ? 'yes' : 'no'} onChange={(event) => set('installed', event.target.value === 'yes')}>
              <option value="yes">Installed / owned</option>
              <option value="no">Not installed</option>
            </Select>
          </Field>
        </div>

        <div className="rounded-lg border border-white/8 bg-black/25 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">Launch configuration</p>
          <div className="space-y-3">
            <Field label="Executable" hint="For PC games and standalone launchers.">
              <div className="flex gap-2">
                <Input value={form.executable} onChange={(event) => set('executable', event.target.value)} placeholder="C:\Games\Game\game.exe" />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const file = await pick('exe')
                    if (file) {
                      set('executable', file)
                      if (!form.installDir) set('installDir', file.replace(/[\\/][^\\/]+$/, ''))
                    }
                  }}
                  icon={<FolderOpen className="h-4 w-4" />}
                >
                  Browse
                </Button>
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Install folder">
                <div className="flex gap-2">
                  <Input value={form.installDir} onChange={(event) => set('installDir', event.target.value)} />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const folder = await pick('folder')
                      if (folder) set('installDir', folder)
                    }}
                    icon={<FolderOpen className="h-4 w-4" />}
                  />
                </div>
              </Field>
              <Field label="ROM / game file">
                <div className="flex gap-2">
                  <Input value={form.romPath} onChange={(event) => set('romPath', event.target.value)} placeholder="For emulated games" />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const file = await pick('rom')
                      if (file) set('romPath', file)
                    }}
                    icon={<FolderOpen className="h-4 w-4" />}
                  />
                </div>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
              <Field label="Emulator">
                <Select value={form.emulatorId} onChange={(event) => set('emulatorId', event.target.value)}>
                  <option value="">None / use executable</option>
                  {emulators.map((emulator) => (
                    <option key={emulator.id} value={emulator.id}>
                      {emulator.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Emulator core">
                <Input value={form.emulatorCore} onChange={(event) => set('emulatorCore', event.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Launch arguments" hint="Overrides the emulator template for this game.">
                <Input value={form.launchArgs} onChange={(event) => set('launchArgs', event.target.value)} placeholder='-L "{core}" "{rom}"' />
              </Field>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cover artwork" hint="Imported into the local artwork cache.">
            <div className="flex gap-2">
              <Input value={coverFile} readOnly placeholder="No file selected" />
              <Button
                variant="secondary"
                icon={<ImageIcon className="h-4 w-4" />}
                onClick={async () => {
                  const file = await pick('image')
                  if (file) setCoverFile(file)
                }}
              >
                Choose
              </Button>
            </div>
          </Field>
          <Field label="Background artwork">
            <div className="flex gap-2">
              <Input value={backgroundFile} readOnly placeholder="No file selected" />
              <Button
                variant="secondary"
                icon={<ImageIcon className="h-4 w-4" />}
                onClick={async () => {
                  const file = await pick('image')
                  if (file) setBackgroundFile(file)
                }}
              >
                Choose
              </Button>
            </div>
          </Field>
        </div>

        <Field label="Personal notes">
          <Textarea rows={2} value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Where you left off, controller setup, mods…" />
        </Field>
      </div>
    </Modal>
  )
}
