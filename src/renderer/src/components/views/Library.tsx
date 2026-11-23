import { useMemo, useState } from 'react'
import { Filter, Plus, SlidersHorizontal, X } from 'lucide-react'
import type { Game } from '@shared/types'
import { useStore } from '../../state/store'
import { GameCard } from '../GameCard'
import { DataSourceNote } from '../Credits'
import { Badge, Button, EmptyState, PageHeader, Select, cx } from '../ui'

type SortKey = 'title' | 'lastPlayed' | 'added' | 'playtime' | 'releaseYear' | 'rating'

function sortGames(games: Game[], sort: SortKey, direction: 'asc' | 'desc'): Game[] {
  const list = [...games]
  list.sort((a, b) => {
    let result = 0
    switch (sort) {
      case 'lastPlayed':
        result = new Date(a.lastPlayed || 0).getTime() - new Date(b.lastPlayed || 0).getTime()
        break
      case 'added':
        result = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
        break
      case 'playtime':
        result = a.playtimeSeconds - b.playtimeSeconds
        break
      case 'releaseYear':
        result = (a.releaseYear ?? 0) - (b.releaseYear ?? 0)
        break
      case 'rating':
        result = (a.rating ?? 0) - (b.rating ?? 0)
        break
      default:
        result = a.title.localeCompare(b.title)
    }
    return direction === 'asc' ? result : -result
  })
  return list
}

export function LibraryView({ onAddGame, onScan }: { onAddGame: () => void; onScan: () => void }): React.JSX.Element {
  const games = useStore((state) => state.games)
  const settings = useStore((state) => state.settings)
  const platforms = useStore((state) => state.platforms)
  const search = useStore((state) => state.search)
  const setSearch = useStore((state) => state.setSearch)

  const [platformId, setPlatformId] = useState('')
  const [genre, setGenre] = useState('')
  const [source, setSource] = useState('')
  const [installed, setInstalled] = useState('')
  const [played, setPlayed] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('title')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')

  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const game of games) for (const value of game.genres) set.add(value)
    return [...set].sort()
  }, [games])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = games.filter((game) => {
      if (query) {
        const haystack = `${game.title} ${game.developer} ${game.publisher} ${game.genres.join(' ')} ${
          game.platformName ?? ''
        } ${game.releaseYear ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (platformId && game.platformId !== platformId) return false
      if (genre && !game.genres.some((value) => value.toLowerCase() === genre.toLowerCase())) return false
      if (source && game.source !== source) return false
      if (installed === 'installed' && !game.installed) return false
      if (installed === 'uninstalled' && game.installed) return false
      if (played === 'played' && !game.lastPlayed) return false
      if (played === 'never' && game.lastPlayed) return false
      if (favoritesOnly && !game.favorite) return false
      if (!settings.showHidden && game.hidden) return false
      return true
    })
    return sortGames(list, sort, direction)
  }, [games, settings.showHidden, search, platformId, genre, source, installed, played, favoritesOnly, sort, direction])

  const activeFilters =
    (platformId ? 1 : 0) + (genre ? 1 : 0) + (source ? 1 : 0) + (installed ? 1 : 0) + (played ? 1 : 0) + (favoritesOnly ? 1 : 0)

  const reset = (): void => {
    setPlatformId('')
    setGenre('')
    setSource('')
    setInstalled('')
    setPlayed('')
    setFavoritesOnly(false)
    setSearch('')
  }

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Universal library"
        title="All Games"
        description={`${games.length} games across every source — Steam, PC, emulators and ROM collections.`}
        actions={
          <>
            <Button variant="secondary" icon={<Filter className="h-4 w-4" />} onClick={onScan}>
              Scan
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onAddGame}>
              Add game
            </Button>
          </>
        }
      />

      <div className="jf-panel mb-6 rounded-xl p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, developer, publisher, genre…"
              className="h-9 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[13px] text-white placeholder:text-white/30 focus:border-jf-red/60 focus:ring-2 focus:ring-jf-red/20"
            />
          </div>

          <Select value={platformId} onChange={(event) => setPlatformId(event.target.value)} className="h-9 w-auto min-w-[140px]">
            <option value="">All platforms</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </Select>

          <Select value={genre} onChange={(event) => setGenre(event.target.value)} className="h-9 w-auto min-w-[120px]">
            <option value="">All genres</option>
            {genres.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>

          <Select value={source} onChange={(event) => setSource(event.target.value)} className="h-9 w-auto min-w-[120px]">
            <option value="">Any source</option>
            <option value="steam">Steam</option>
            <option value="pc-scan">PC scan</option>
            <option value="rom-scan">ROM scan</option>
            <option value="manual">Manual</option>
          </Select>

          <Select value={installed} onChange={(event) => setInstalled(event.target.value)} className="h-9 w-auto min-w-[120px]">
            <option value="">Install state</option>
            <option value="installed">Installed</option>
            <option value="uninstalled">Not installed</option>
          </Select>

          <Select value={played} onChange={(event) => setPlayed(event.target.value)} className="h-9 w-auto min-w-[110px]">
            <option value="">Play state</option>
            <option value="played">Played</option>
            <option value="never">Never played</option>
          </Select>

          <button
            data-nav="1"
            onClick={() => setFavoritesOnly((value) => !value)}
            className={cx(
              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition',
              favoritesOnly
                ? 'border-jf-red/50 bg-jf-red/15 text-white'
                : 'border-white/10 bg-white/5 text-jf-muted hover:text-white'
            )}
          >
            Favorites
          </button>

          <div className="ml-auto flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-white/30" />
            <Select
              value={sort}
              onChange={(event) => {
                const next = event.target.value as SortKey
                setSort(next)
                setDirection(next === 'title' ? 'asc' : 'desc')
              }}
              className="h-9 w-auto min-w-[130px]"
            >
              <option value="title">Title</option>
              <option value="lastPlayed">Last played</option>
              <option value="added">Recently added</option>
              <option value="playtime">Playtime</option>
              <option value="releaseYear">Release year</option>
              <option value="rating">Rating</option>
            </Select>
            <button
              data-nav="1"
              onClick={() => setDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-bold text-white/70 hover:text-white"
              title="Toggle sort direction"
            >
              {direction === 'asc' ? '↑' : '↓'}
            </button>
            {activeFilters > 0 && (
              <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={reset}>
                Clear {activeFilters}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2 px-0.5 text-[11px] text-white/35">
          <Badge tone="dark">{filtered.length} results</Badge>
          <span>Drag-free grid · double-click a poster to launch instantly</span>
          <DataSourceNote className="ml-auto hidden sm:block" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No games match those filters"
          description="Try clearing filters, or scan another folder to add more titles."
          action={
            <Button variant="secondary" onClick={reset}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-x-4 gap-y-7">
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} fluid />
          ))}
        </div>
      )}
    </div>
  )
}
