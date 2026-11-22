import { useEffect, useMemo, useState } from 'react'
import { Info, Play, Star } from 'lucide-react'
import type { Game } from '@shared/types'
import { formatPlaytime, relativeTime } from '../lib/format'
import { useStore } from '../state/store'
import { Backdrop, GameLogo } from './Art'
import { Badge, Button, cx } from './ui'
import { TrailerOverlay } from './VideoPlayer'

export function Hero({ pool }: { pool: Game[] }): React.JSX.Element | null {
  const lastPlayed = useStore((state) => state.lastPlayed)
  const settings = useStore((state) => state.settings)
  const play = useStore((state) => state.play)
  const openDetail = useStore((state) => state.openDetail)
  const setPreview = useStore((state) => state.setPreview)
  const platforms = useStore((state) => state.platforms)
  const [index, setIndex] = useState(0)
  const [trailer, setTrailer] = useState<string | null>(null)

  const featured = useMemo(() => {
    const seen = new Set<string>()
    const list = pool
      .filter((game) => {
        if (seen.has(game.id)) return false
        seen.add(game.id)
        return Boolean(game.backgroundPath || game.heroUrl || game.coverPath)
      })
      .sort((a, b) => {
        const score = (game: Game): number =>
          (game.favorite ? 60 : 0) +
          (game.rating ?? 0) / 2 +
          (game.lastPlayed ? 30 : 0) +
          (game.backgroundPath ? 20 : 0)
        return score(b) - score(a)
      })
      .slice(0, 6)
    return list
  }, [pool])

  useEffect(() => {
    if (index >= featured.length) setIndex(0)
  }, [featured.length, index])

  useEffect(() => {
    if (!featured.length || settings.heroRotation <= 0) return
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % featured.length),
      settings.heroRotation * 1000
    )
    return () => window.clearInterval(timer)
  }, [featured.length, settings.heroRotation])

  const game = featured[index] ?? featured[0]

  useEffect(() => {
    if (!game) return
    setPreview(game.id)
    return () => setPreview(null)
  }, [game?.id, setPreview])

  if (!game) return null

  const platformName = platforms.find((p) => p.id === game.platformId)?.name ?? game.platformName ?? game.platformId
  const isResume = lastPlayed?.id === game.id

  return (
    <section
      className="relative -mx-8 -mt-4 mb-8 overflow-hidden"
      onMouseEnter={() => setPreview(game.id)}
      aria-label="Featured game"
    >
      <div className="absolute inset-0">
        <Backdrop game={game} className="h-full w-full object-cover" />
        <div className="absolute inset-0 jf-grad-hero" />
      </div>

      <div className="relative flex min-h-[440px] flex-col justify-end px-8 pb-10 pt-24 lg:min-h-[500px]">
        <div key={game.id} className="max-w-[640px] animate-rise">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="red">Featured</Badge>
            {game.favorite && (
              <Badge tone="amber">
                <Star className="h-2.5 w-2.5 fill-current" /> Favorite
              </Badge>
            )}
            {game.installed ? <Badge tone="green">Installed</Badge> : <Badge>Not installed</Badge>}
          </div>

          <div className="min-h-[64px]">
            <GameLogo game={game} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-white/70">
            {game.releaseYear && <span>{game.releaseYear}</span>}
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>{platformName}</span>
            {game.genres.slice(0, 2).map((genre) => (
              <span key={genre} className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {genre}
              </span>
            ))}
            {game.playtimeSeconds > 0 && (
              <>
                <span className="h-1 w-1 rounded-full bg-white/30" />
                <span>{formatPlaytime(game.playtimeSeconds)} played</span>
              </>
            )}
            {game.lastPlayed && (
              <>
                <span className="h-1 w-1 rounded-full bg-white/30" />
                <span>{relativeTime(game.lastPlayed)}</span>
              </>
            )}
          </div>

          <p className="mt-3 max-w-xl line-clamp-3 text-[13.5px] leading-relaxed text-white/72">
            {game.description || 'No description yet. Refresh metadata or add your own notes from the game page.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Button
              size="lg"
              variant="primary"
              icon={<Play className="h-5 w-5 fill-current" />}
              onClick={() => void play(game.id)}
            >
              {isResume ? 'Resume' : 'Play'}
            </Button>
            <Button size="lg" variant="secondary" icon={<Info className="h-4 w-4" />} onClick={() => openDetail(game.id)}>
              More info
            </Button>
            {game.videoUrl && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => setTrailer(game.videoUrl)}
              >
                Watch trailer
              </Button>
            )}
          </div>
        </div>

        {featured.length > 1 && (
          <div className="absolute bottom-8 right-8 flex items-center gap-2">
            {featured.map((entry, dotIndex) => (
              <button
                key={entry.id}
                data-nav="1"
                aria-label={`Feature ${entry.title}`}
                onClick={() => setIndex(dotIndex)}
                className={cx(
                  'h-1.5 rounded-full transition-all duration-300',
                  dotIndex === index ? 'w-8 bg-jf-red' : 'w-3 bg-white/30 hover:bg-white/60'
                )}
              />
            ))}
          </div>
        )}
      </div>

      {trailer && <TrailerOverlay url={trailer} title={game.title} onClose={() => setTrailer(null)} />}
    </section>
  )
}
