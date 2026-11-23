import { useEffect, useRef, useState } from 'react'
import { Heart, Play, Timer, Star } from 'lucide-react'
import type { Game } from '@shared/types'
import { formatPlaytime, relativeTime, starsFor } from '../lib/format'
import { useStore } from '../state/store'
import { Cover } from './Art'
import { StreamVideo } from './VideoPlayer'
import { cx, Spinner } from './ui'

export function GameCard({
  game,
  width = 176,
  showProgress = false,
  fluid = false
}: {
  game: Game
  width?: number
  showProgress?: boolean
  fluid?: boolean
}): React.JSX.Element {
  const openDetail = useStore((state) => state.openDetail)
  const setPreview = useStore((state) => state.setPreview)
  const settings = useStore((state) => state.settings)
  const playState = useStore((state) => state.playState)
  const toggleFavorite = useStore((state) => state.toggleFavorite)
  const play = useStore((state) => state.play)
  const [hovered, setHovered] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const timer = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const launching = playState.gameId === game.id && playState.state === 'launching'
  const running = playState.gameId === game.id && playState.state === 'running'
  const stars = starsFor(game.rating)

  useEffect(() => {
    if (hovered && settings.autoPreviews && game.videoUrl) {
      timer.current = window.setTimeout(() => setShowVideo(true), Math.max(300, settings.previewDelay))
    } else {
      setShowVideo(false)
      if (timer.current) window.clearTimeout(timer.current)
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [hovered, settings.autoPreviews, settings.previewDelay, game.videoUrl])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.volume = Math.min(1, Math.max(0, settings.previewVolume))
    videoRef.current.muted = settings.previewVolume <= 0
  }, [showVideo, settings.previewVolume])

  return (
    <div
      data-nav="1"
      data-game-id={game.id}
      role="button"
      tabIndex={-1}
      aria-label={`${game.title}, ${game.platformName ?? game.platformId}`}
      onMouseEnter={() => {
        setHovered(true)
        setPreview(game.id)
      }}
      onMouseLeave={() => {
        setHovered(false)
        setPreview(null)
      }}
      onClick={() => openDetail(game.id)}
      onFocus={() => setPreview(game.id)}
      onDoubleClick={settings.launchOnSelect ? () => void play(game.id) : undefined}
      className={cx('group relative shrink-0 text-left', fluid && 'w-full')}
      style={fluid ? undefined : { width }}
    >
      <div
        className={cx(
          'jf-poster relative overflow-hidden rounded-xl border bg-jf-card transition-all duration-300 ease-out',
          hovered
            ? 'border-white/25 shadow-[0_26px_50px_-22px_rgba(0,0,0,0.95)] -translate-y-1'
            : 'border-white/8 shadow-[0_12px_28px_-18px_rgba(0,0,0,0.9)]',
          (launching || running) && 'ring-2 ring-jf-red/70'
        )}
        style={{ aspectRatio: '2 / 3' }}
      >
        <Cover game={game} />

        {showVideo && game.videoUrl && (
          <StreamVideo
            ref={videoRef}
            url={game.videoUrl}
            className="absolute inset-0 h-full w-full animate-fade object-cover"
            autoPlay
            loop
            muted={settings.previewVolume <= 0}
            playsInline
            onError={() => setShowVideo(false)}
          />
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-black/25 opacity-90" />

        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {launching && (
            <span
              data-launch-state="launching"
              className="flex items-center gap-1 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black"
            >
              <Spinner className="h-2.5 w-2.5" /> Launching
            </span>
          )}
          {running && (
            <span
              data-launch-state="running"
              className="flex items-center gap-1 rounded bg-jf-red px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
            >
              <Play className="h-2.5 w-2.5 fill-current" /> Running
            </span>
          )}
          {!game.installed && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
              Not installed
            </span>
          )}
        </div>

        <button
          onClick={(event) => {
            event.stopPropagation()
            void toggleFavorite(game.id)
          }}
          aria-label={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cx(
            'absolute right-2 top-2 rounded-full p-1.5 backdrop-blur transition',
            game.favorite
              ? 'bg-jf-red text-white opacity-100'
              : 'bg-black/45 text-white/60 opacity-0 hover:text-white group-hover:opacity-100'
          )}
        >
          <Heart className={cx('h-3.5 w-3.5', game.favorite && 'fill-current')} />
        </button>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <span className="rounded border border-white/12 bg-black/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/75 backdrop-blur">
            {game.platformName ?? game.platformId}
          </span>
          {stars !== null && (
            <span className="flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
              <Star className="h-2.5 w-2.5 fill-current" />
              {stars}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 px-0.5">
        <p className="truncate text-[13px] font-semibold leading-tight text-white/92 group-hover:text-white">
          {game.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-jf-muted">
          {showProgress && game.lastPlayed ? (
            <>
              <Timer className="h-3 w-3 shrink-0" />
              {formatPlaytime(game.playtimeSeconds)} · {relativeTime(game.lastPlayed)}
            </>
          ) : game.playtimeSeconds > 0 ? (
            formatPlaytime(game.playtimeSeconds)
          ) : game.releaseYear ? (
            String(game.releaseYear)
          ) : (
            'Never played'
          )}
        </p>
      </div>
    </div>
  )
}
