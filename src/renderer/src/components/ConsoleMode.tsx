import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Delete, Gamepad2, Play, Search, Star, Tv, X } from 'lucide-react'
import type { Game } from '@shared/types'
import { formatPlaytime, relativeTime } from '../lib/format'
import { visibleGames } from '../lib/games'
import { useFocusReturn, useModalLayer } from '../lib/navigation'
import { useStore } from '../state/store'
import { Backdrop, GameLogo } from './Art'
import { GameCard } from './GameCard'
import { GameRow } from './GameRow'
import { Badge, Button, IconButton, cx } from './ui'

const KEY_ROWS = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ1234', '567890 -.']

function useClock(): string {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20000)
    return () => window.clearInterval(timer)
  }, [])
  return now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function ConsoleSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const games = useStore((state) => state.games)
  const showHidden = useStore((state) => state.settings.showHidden)
  const [query, setQuery] = useState('')
  const layerRef = useModalLayer()
  const results = useMemo(() => {
    if (!query.trim()) return []
    const value = query.toLowerCase()
    return games
      .filter(
        (game) =>
          (showHidden || !game.hidden) &&
          `${game.title} ${game.developer} ${game.platformName ?? ''}`.toLowerCase().includes(value)
      )
      .slice(0, 12)
  }, [games, query, showHidden])

  const press = (key: string): void => {
    if (key === 'DEL') setQuery((value) => value.slice(0, -1))
    else if (key === 'SPACE') setQuery((value) => `${value} `)
    else setQuery((value) => value + key.toLowerCase())
  }

  return (
    <div ref={layerRef} data-jf-modal="1" className="fixed inset-0 z-[88] flex flex-col bg-[#0f1114]/98 animate-fade">
      <div className="flex items-center gap-4 px-10 py-6">
        <Search className="h-6 w-6 text-jf-red" />
        <div className="flex-1 border-b-2 border-jf-red/60 pb-2 text-3xl font-bold tracking-wide text-white">
          {query || <span className="text-white/25">Search your universe…</span>}
          <span className="ml-0.5 inline-block h-7 w-0.5 animate-pulse-soft bg-jf-red align-middle" />
        </div>
        <IconButton label="Close search" onClick={onClose} data-jf-modal-close="1">
          <X className="h-5 w-5" />
        </IconButton>
      </div>

      <div className="flex flex-1 gap-8 overflow-hidden px-10 pb-10">
        <div className="w-[420px] shrink-0">
          <div className="grid gap-2">
            {KEY_ROWS.map((row, index) => (
              <div key={index} className="flex gap-2">
                {row.split('').map((char) => (
                  <button
                    key={char}
                    data-nav="1"
                    onClick={() => press(char)}
                    className="h-12 flex-1 rounded-lg border border-white/12 bg-white/6 text-base font-bold text-white transition hover:bg-jf-red"
                  >
                    {char}
                  </button>
                ))}
                {index === 3 && (
                  <button
                    data-nav="1"
                    onClick={() => press('DEL')}
                    className="flex h-12 w-16 items-center justify-center rounded-lg border border-white/12 bg-white/6 text-white transition hover:bg-jf-red"
                    aria-label="Backspace"
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <button
                data-nav="1"
                onClick={() => press('SPACE')}
                className="h-12 flex-1 rounded-lg border border-white/12 bg-white/6 text-sm font-bold text-white hover:bg-white/12"
              >
                Space
              </button>
              <button
                data-nav="1"
                onClick={() => setQuery('')}
                className="h-12 w-28 rounded-lg border border-white/12 bg-white/6 text-sm font-bold text-white hover:bg-white/12"
              >
                Clear
              </button>
              <button
                data-nav="1"
                onClick={onClose}
                className="h-12 w-28 rounded-lg bg-jf-red text-sm font-bold text-white hover:bg-[#e8203f]"
              >
                Done
              </button>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/35">
            Use the D-pad and A to type. Results update instantly from your local library. B or Escape returns without
            clearing your filters.
          </p>
        </div>

        <div className="grid min-w-0 flex-1 auto-rows-min grid-cols-3 gap-4 overflow-y-auto scrollbar-none xl:grid-cols-4">
          {results.map((game) => (
            <GameCard key={game.id} game={game} fluid />
          ))}
          {query && results.length === 0 && (
            <div className="col-span-3 py-16 text-center text-sm text-white/35 xl:col-span-4">
              Nothing matches “{query}”. Try a different spelling.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConsoleHero({ game }: { game: Game }): React.JSX.Element {
  const play = useStore((state) => state.play)
  const openDetail = useStore((state) => state.openDetail)
  const lastPlayed = useStore((state) => state.lastPlayed)
  const isResume = lastPlayed?.id === game.id

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10">
      <div className="absolute inset-0">
        <Backdrop game={game} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0f1114] via-[#0f1114]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1114] via-transparent to-transparent" />
      </div>
      <div className="relative flex min-h-[300px] flex-col justify-end px-10 pb-8 pt-16">
        <div className="max-w-2xl">
          <GameLogo game={game} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="red">Featured</Badge>
            {game.releaseYear && <span>{game.releaseYear}</span>}
            <span>{game.platformName ?? game.platformId}</span>
            {game.playtimeSeconds > 0 && <span>{formatPlaytime(game.playtimeSeconds)}</span>}
            {game.lastPlayed && <span>{relativeTime(game.lastPlayed)}</span>}
          </div>
          <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-white/65">
            {game.description || 'Ready to play.'}
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button size="lg" variant="primary" icon={<Play className="h-5 w-5 fill-current" />} onClick={() => void play(game.id)}>
              {isResume ? 'Resume' : 'Play'}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => openDetail(game.id)}>
              Details
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function ConsoleMode(): React.JSX.Element {
  const home = useStore((state) => state.home)
  const games = useStore((state) => state.games)
  const playState = useStore((state) => state.playState)
  const lastPlayed = useStore((state) => state.lastPlayed)
  const setConsoleMode = useStore((state) => state.setConsoleMode)
  const setView = useStore((state) => state.setView)
  const controller = useStore((state) => state.controller)
  const [searchOpen, setSearchOpen] = useState(false)
  const focusRef = useFocusReturn()
  const clock = useClock()

  const showHidden = useStore((state) => state.settings.showHidden)
  const visible = useMemo(() => visibleGames(games, showHidden), [games, showHidden])
  const streaming = useMemo(() => {
    const pool = visible.filter((game) => game.backgroundPath || game.heroUrl)
    return (pool.length ? pool : visible).slice(0, 8)
  }, [visible])

  const [heroIndex, setHeroIndex] = useState(0)
  useEffect(() => {
    if (streaming.length < 2) return
    const timer = window.setInterval(() => setHeroIndex((value) => (value + 1) % streaming.length), 18000)
    return () => window.clearInterval(timer)
  }, [streaming.length])

  const hero =
    streaming[heroIndex] ??
    (lastPlayed && (showHidden || !lastPlayed.hidden) ? lastPlayed : undefined) ??
    visible[0]
  const running = games.find((game) => game.id === playState.gameId && playState.state !== 'idle')

  const exit = (): void => {
    setConsoleMode(false)
    void window.joyframe.system.setFullScreen(false).catch(() => undefined)
  }

  const rows = home.slice(0, 7)

  return (
    <div
      ref={focusRef}
      data-jf-console="1"
      className="jf-console-enter fixed inset-0 z-40 flex flex-col overflow-y-auto bg-[#0a0c10]"
    >
      <div className="pointer-events-none fixed inset-0 opacity-30">
        {hero && <Backdrop game={hero} className="h-full w-full scale-110 object-cover blur-2xl" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f1114]/85 via-[#0f1114]/92 to-[#0f1114]" />
      </div>

      <header className="relative z-10 flex items-center gap-5 px-10 py-6">
        <div className="flex items-center gap-2.5">
          <Tv className="h-5 w-5 text-jf-red" />
          <span className="text-sm font-black tracking-[0.25em] text-white">JOYFRAME</span>
          <Badge tone="red">Console</Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {running && (
            <span className="flex items-center gap-2 rounded-full border border-jf-red/40 bg-jf-red/15 px-3 py-1 text-xs font-semibold text-white">
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-jf-red" />
              {running.title}
            </span>
          )}
          <button
            data-nav="1"
            onClick={() => setSearchOpen(true)}
            className="flex h-10 items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 text-xs font-semibold text-white/80 transition hover:bg-white/12"
          >
            <Search className="h-4 w-4" /> Search
          </button>
          <button
            data-nav="1"
            onClick={() => {
              setView('collections')
              exit()
            }}
            className="flex h-10 items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 text-xs font-semibold text-white/80 transition hover:bg-white/12"
          >
            <Star className="h-4 w-4" /> Shelves
          </button>
          <span className="ml-2 font-mono text-sm text-white/40">{clock}</span>
          <IconButton label="Exit console mode" onClick={exit}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <main className="relative z-10 flex-1 space-y-7 px-10 pb-16">
        {hero && <ConsoleHero game={hero} />}

        {rows.map((row) => (
          <GameRow
            key={row.id}
            title={row.title}
            games={row.games}
            showProgress={row.key === 'continue' || row.key === 'recent'}
          />
        ))}

        {rows.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/4 p-10 text-center">
            <Gamepad2 className="mx-auto h-8 w-8 text-jf-red" />
            <p className="mt-3 text-lg font-bold text-white">Your console is waiting</p>
            <p className="mt-1 text-sm text-white/50">Import games from the desktop interface, then come back here.</p>
            <Button className="mt-5" variant="primary" onClick={exit}>
              Back to Desktop Mode
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5 text-[11px] text-white/30">
          <span className={cx('flex items-center gap-2', controller.connected && 'text-emerald-300/70')}>
            <Gamepad2 className="h-3.5 w-3.5" />
            {controller.connected ? controller.name : 'No controller detected — keyboard arrows work too'}
          </span>
          <span>D-pad navigate · A select · B back · Y favorite · Start switches modes</span>
        </div>
      </main>

      {searchOpen && <ConsoleSearch onClose={() => setSearchOpen(false)} />}

    </div>
  )
}
