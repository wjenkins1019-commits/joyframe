import { useEffect, useRef, useState } from 'react'
import { FolderSearch, Plus, Search, Square, X } from 'lucide-react'
import { useCountdown } from '../lib/countdown'
import { useStore } from '../state/store'
import { cx, IconButton, Spinner } from './ui'

function useElapsed(startedAt: string | null): string {
  const [, force] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function TopBar({
  onAddGame,
  onScan,
  hidden = false
}: {
  onAddGame: () => void
  onScan: () => void
  hidden?: boolean
}): React.JSX.Element {
  const search = useStore((state) => state.search)
  const setSearch = useStore((state) => state.setSearch)
  const setView = useStore((state) => state.setView)
  const playState = useStore((state) => state.playState)
  const games = useStore((state) => state.games)
  const stopGame = useStore((state) => state.stopGame)
  const platform = useStore((state) => state.info.platform)
  const inputRef = useRef<HTMLInputElement>(null)
  const elapsed = useElapsed(playState.startedAt)
  const launchRemaining = useCountdown(playState.state === 'launching' ? playState.observeUntil : null)

  const runningGame = games.find((game) => game.id === playState.gameId)

  return (
    <header
      className={cx(
        'drag-region relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-white/6 bg-[#080a0d]/45 px-5 backdrop-blur-2xl backdrop-saturate-150',
        platform === 'win32' && 'pr-[150px]',
        hidden && 'hidden'
      )}
    >
      <div className="no-drag relative w-full max-w-[420px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input
          ref={inputRef}
          data-search-input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            if (event.target.value.trim()) setView('library')
          }}
          onFocus={() => setView('library')}
          placeholder="Search your universe… (/)"
          className="h-9 w-full rounded-lg border border-white/10 bg-black/30 pl-9 pr-8 text-[13px] text-white placeholder:text-white/30 transition focus:border-jf-red/60 focus:bg-black/45 focus:ring-2 focus:ring-jf-red/20"
        />
        {search && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/40 hover:text-white"
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="no-drag ml-auto flex items-center gap-2">
        {playState.state !== 'idle' && runningGame && (
          <div
            data-launch-state={playState.state}
            className={cx(
              'flex items-center gap-2.5 rounded-full border py-1 pl-3 pr-1',
              playState.state === 'launching' ? 'border-amber-400/35 bg-amber-400/12' : 'border-jf-red/35 bg-jf-red/12'
            )}
          >
            {playState.state === 'launching' ? (
              <Spinner className="h-3.5 w-3.5 text-amber-300" />
            ) : (
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-jf-red/70" />
                <span className="relative h-2 w-2 rounded-full bg-jf-red" />
              </span>
            )}
            {playState.state === 'launching' && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">Launching</span>
            )}
            <span className="max-w-[180px] truncate text-xs font-semibold text-white">{runningGame.title}</span>
            {playState.state === 'launching' ? (
              <span className="font-mono text-[11px] text-white/45">
                {launchRemaining === null ? 'waiting for the game' : `${launchRemaining}s left`}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-white/60">{elapsed}</span>
            )}
            <IconButton
              label={playState.state === 'launching' ? 'Cancel launch' : 'Stop game'}
              size="sm"
              onClick={() => void stopGame()}
            >
              {playState.state === 'launching' ? <X className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            </IconButton>
          </div>
        )}

        <button
          data-nav="1"
          onClick={onScan}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/85 transition hover:bg-white/12 hover:text-white"
        >
          <FolderSearch className="h-4 w-4" />
          Scan library
        </button>
        <button
          data-nav="1"
          onClick={onAddGame}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-jf-red px-3 text-xs font-bold text-white shadow-[0_8px_24px_-10px_rgba(215,25,53,0.9)] transition hover:bg-[#e8203f]"
        >
          <Plus className="h-4 w-4" />
          Add game
        </button>
      </div>
    </header>
  )
}
