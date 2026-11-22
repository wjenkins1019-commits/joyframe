import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Layers, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { Collection, CollectionRule, Game } from '@shared/types'
import { api, errorMessage } from '../../lib/api'
import { gradientFor } from '../../lib/format'
import { gamesByIds } from '../../lib/games'
import { useStore } from '../../state/store'
import { GameCard } from '../GameCard'
import { SmartImage } from '../Art'
import {
  Badge,
  Button,
  ConfirmInline,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Textarea
} from '../ui'

function CollectionCard({
  collection,
  games,
  onOpen
}: {
  collection: Collection
  games: Game[]
  onOpen: () => void
}): React.JSX.Element {
  const collage = games.slice(0, 4)
  return (
    <div
      data-nav="1"
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      className="group cursor-pointer overflow-hidden rounded-xl border border-white/8 bg-jf-card transition hover:border-white/25 hover:shadow-2xl"
    >
      <div className="relative grid h-[150px] grid-cols-4 overflow-hidden">
        {collage.length === 0 && (
          <div className="col-span-4 flex items-center justify-center" style={{ background: gradientFor(collection.name) }}>
            <Layers className="h-8 w-8 text-white/25" />
          </div>
        )}
        {collage.map((game) => (
          <SmartImage key={game.id} src={game.coverPath} alt={game.title} className="h-full w-full" fallbackSeed={game.title} />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3">
          <p className="truncate text-sm font-bold text-white">{collection.name}</p>
          <p className="text-[11px] text-white/55">
            {collection.kind === 'smart' ? 'Smart collection' : 'Collection'} · {collection.gameIds.length} games
          </p>
        </div>
      </div>
    </div>
  )
}

function RuleEditor({
  rule,
  onChange
}: {
  rule: CollectionRule | null
  onChange: (rule: CollectionRule | null) => void
}): React.JSX.Element {
  const base: CollectionRule = rule ?? { field: 'genre', op: 'contains', value: '' }
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-jf-muted">Automatic rule</p>
        <button
          className="text-[11px] font-semibold text-jf-redtext hover:text-white"
          onClick={() => onChange(rule ? null : base)}
        >
          {rule ? 'Use manual selection' : 'Use smart rule'}
        </button>
      </div>
      {rule ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={rule.field}
            onChange={(event) => onChange({ ...rule, field: event.target.value as CollectionRule['field'] })}
            className="h-9 rounded-lg border border-white/10 bg-[#1b1e23] px-2 text-xs text-white"
          >
            <option value="genre">Genre</option>
            <option value="platform">Platform</option>
            <option value="completion">Completion</option>
            <option value="favorite">Favorite</option>
            <option value="source">Source</option>
            <option value="playtime">Playtime (minutes)</option>
          </select>
          <select
            value={rule.op}
            onChange={(event) => onChange({ ...rule, op: event.target.value as CollectionRule['op'] })}
            className="h-9 rounded-lg border border-white/10 bg-[#1b1e23] px-2 text-xs text-white"
          >
            <option value="contains">contains</option>
            <option value="is">is</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
          </select>
          <Input
            value={rule.value}
            onChange={(event) => onChange({ ...rule, value: event.target.value })}
            placeholder="RPG, snes, completed…"
            className="h-9 text-xs"
          />
        </div>
      ) : (
        <p className="text-xs text-white/40">Games are added to this collection manually.</p>
      )}
    </div>
  )
}

export function CollectionsView(): React.JSX.Element {
  const collections = useStore((state) => state.collections)
  const games = useStore((state) => state.games)
  const showHidden = useStore((state) => state.settings.showHidden)
  const refresh = useStore((state) => state.refresh)
  const notify = useStore((state) => state.notify)

  const [selected, setSelected] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rule, setRule] = useState<CollectionRule | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const collection = collections.find((entry) => entry.id === selected) ?? null
  // Smart members are resolved by the main process (see listCollections), so
  // the shelf only maps stored ids to games and hides hidden titles.
  const collectionGames = useMemo(() => {
    if (!collection) return []
    return gamesByIds(collection.gameIds, games, showHidden)
  }, [collection, games, showHidden])

  const openCreate = (): void => {
    setEditing(null)
    setName('')
    setDescription('')
    setRule(null)
    setEditorOpen(true)
  }

  const openEdit = (entry: Collection): void => {
    setEditing(entry)
    setName(entry.name)
    setDescription(entry.description)
    setRule(entry.rule)
    setEditorOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      notify('Give the collection a name', 'error')
      return
    }
    try {
      if (editing) {
        await api.collections.update(editing.id, { name, description, rule })
        notify('Collection updated', 'success')
      } else {
        await api.collections.create({ name, description, rule: rule ?? undefined })
        notify(`Created ${name}`, 'success')
      }
      setEditorOpen(false)
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await api.collections.remove(id)
      if (selected === id) setSelected(null)
      setConfirmDelete(null)
      await refresh()
      notify('Collection removed')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const addToCollection = async (gameId: string): Promise<void> => {
    if (!collection) return
    try {
      await api.collections.addGame(collection.id, gameId)
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const removeFromCollection = async (gameId: string): Promise<void> => {
    if (!collection) return
    try {
      await api.collections.removeGame(collection.id, gameId)
      await refresh()
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  if (collection) {
    const notInCollection = games.filter(
      (game) =>
        !collectionGames.some((entry) => entry.id === game.id) &&
        game.title.toLowerCase().includes(addSearch.toLowerCase())
    )
    return (
      <div className="pb-20">
        <button
          data-nav="1"
          onClick={() => setSelected(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-jf-muted hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All collections
        </button>

        <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/8">
          <div className="absolute inset-0 grid grid-cols-4 opacity-30">
            {collectionGames.slice(0, 4).map((game) => (
              <SmartImage key={game.id} src={game.coverPath} alt={game.title} className="h-full w-full" fallbackSeed={game.title} />
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-[#15171b] via-[#15171b]/85 to-[#15171b]/40" />
          <div className="relative flex flex-wrap items-end justify-between gap-4 px-7 py-8">
            <div>
              <Badge tone="red">{collection.kind === 'smart' ? 'Smart collection' : 'Collection'}</Badge>
              <h1 className="mt-2 text-3xl font-black text-white">{collection.name}</h1>
              <p className="mt-1 max-w-xl text-sm text-jf-muted">
                {collection.description || 'No description yet.'}
              </p>
              <p className="mt-2 text-xs text-white/40">{collectionGames.length} games</p>
            </div>
            <div className="flex items-center gap-2">
              <Button data-nav="1" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => openEdit(collection)}>
                Edit
              </Button>
              {confirmDelete === collection.id ? (
                <ConfirmInline
                  question="Delete this collection?"
                  onConfirm={() => void remove(collection.id)}
                  onCancel={() => setConfirmDelete(null)}
                />
              ) : (
                <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(collection.id)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white/70">Games in this collection</h2>
          {collection.kind === 'smart' && collection.rule ? (
            <p className="text-[11px] text-white/35">Members update automatically from the smart rule.</p>
          ) : (
            <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
              Add games
            </Button>
          )}
        </div>

        {collectionGames.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6" />}
            title="This collection is empty"
            description="Add games from your library to build the row that appears on your dashboard."
            action={
              collection.kind === 'smart' && collection.rule ? undefined : (
                <Button variant="primary" onClick={() => setAddOpen(true)} icon={<Plus className="h-4 w-4" />}>
                  Add games
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-x-4 gap-y-7">
            {collectionGames.map((game) => (
              <div key={game.id} className="group relative">
                <GameCard game={game} fluid />
                <button
                  onClick={() => void removeFromCollection(game.id)}
                  className="absolute right-2 top-2 z-10 hidden rounded-full bg-black/80 p-1.5 text-white/70 hover:text-red-400 group-hover:block"
                  aria-label={`Remove ${game.title} from collection`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Modal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          title="Add games to collection"
          subtitle={collection.name}
          width="max-w-3xl"
        >
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <Input
              autoFocus
              value={addSearch}
              onChange={(event) => setAddSearch(event.target.value)}
              placeholder="Search your library…"
              className="pl-9"
            />
          </div>
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {notInCollection.slice(0, 60).map((game) => (
              <button
                key={game.id}
                data-nav="1"
                onClick={() => void addToCollection(game.id)}
                className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 p-2 text-left transition hover:border-jf-red/40 hover:bg-white/8"
              >
                <SmartImage
                  src={game.coverPath}
                  alt={game.title}
                  className="h-14 w-10 shrink-0 rounded"
                  fallbackSeed={game.title}
                  showInitials={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{game.title}</p>
                  <p className="truncate text-[10px] text-jf-muted">{game.platformName ?? game.platformId}</p>
                </div>
                <Plus className="h-4 w-4 shrink-0 text-jf-muted" />
              </button>
            ))}
            {notInCollection.length === 0 && (
              <p className="col-span-2 py-6 text-center text-xs text-jf-muted">Everything matching is already in this collection.</p>
            )}
          </div>
        </Modal>

        <Modal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          title={editing ? 'Edit collection' : 'New collection'}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" icon={<Check className="h-4 w-4" />} onClick={() => void save()}>
                Save collection
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" autoFocus />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A short description shown on the collection page"
              rows={2}
            />
            <RuleEditor rule={rule} onChange={setRule} />
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Your shelves"
        title="Collections"
        description="Curated groups that appear as rows on your dashboard. Build them by hand or let smart rules fill them automatically."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            New collection
          </Button>
        }
      />

      {collections.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title="No collections yet"
          description="Create childhood favorites, couch co-op nights, games to finish — anything you want on your shelves."
          action={
            <Button variant="primary" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
              Create your first collection
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {collections.map((entry) => {
            const list = gamesByIds(entry.gameIds, games, showHidden)
            return (
              <div key={entry.id} className="group relative">
                <CollectionCard collection={entry} games={list} onOpen={() => setSelected(entry.id)} />
                <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <IconButton
                    label="Edit collection"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      openEdit(entry)
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </IconButton>
                  <IconButton
                    label="Delete collection"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      setConfirmDelete(entry.id)
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </IconButton>
                </div>
                {confirmDelete === entry.id && (
                  <div className="absolute inset-x-2 bottom-2 z-20">
                    <ConfirmInline
                      question={`Delete ${entry.name}?`}
                      onConfirm={() => void remove(entry.id)}
                      onCancel={() => setConfirmDelete(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit collection' : 'New collection'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={<Check className="h-4 w-4" />} onClick={() => void save()}>
              Save collection
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" autoFocus />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A short description shown on the collection page"
            rows={2}
          />
          <RuleEditor rule={rule} onChange={setRule} />
        </div>
      </Modal>
    </div>
  )
}
