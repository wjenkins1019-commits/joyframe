import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Game, HomeRow } from '@shared/types'
import { GameCard } from './GameCard'
import { cx } from './ui'

export function GameRow({
  title,
  games,
  showProgress = false,
  onSeeAll,
  className,
  columns
}: {
  title: string
  games: Game[]
  showProgress?: boolean
  onSeeAll?: () => void
  className?: string
  /** Fit exactly this many cards to the row width; keeps the shelf edge clean. */
  columns?: number
}): React.JSX.Element | null {
  const scroller = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  if (!games.length) return null

  const scroll = (direction: 1 | -1): void => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.82), behavior: 'smooth' })
  }

  return (
    <section
      className={cx('relative', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={title}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-4 px-1">
        <h2 className="jf-row-title text-[15px] font-bold tracking-wide text-white/95">{title}</h2>
        {onSeeAll && (
          <button
            data-nav="1"
            onClick={onSeeAll}
            className="text-[11px] font-semibold uppercase tracking-wider text-jf-muted transition hover:text-white"
          >
            See all
          </button>
        )}
      </div>

      <div className="relative">
        <div
          ref={scroller}
          className={cx('scrollbar-none flex gap-3.5 overflow-x-auto pb-1', columns ? 'pr-0' : 'pr-1')}
          style={{ scrollSnapType: 'x proximity' }}
        >
          {games.map((game) => (
            <div
              key={game.id}
              className={cx(Boolean(columns) && 'min-w-0 shrink-0')}
              style={{
                scrollSnapAlign: 'start',
                ...(columns
                  ? { flex: `0 0 calc((100% - ${(columns - 1) * 14}px) / ${columns})` }
                  : undefined)
              }}
            >
              <GameCard game={game} showProgress={showProgress} fluid={Boolean(columns)} />
            </div>
          ))}
        </div>

        <button
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className={cx(
            'absolute -left-2 top-[40%] z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl backdrop-blur transition',
            hovered ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className={cx(
            'absolute -right-2 top-[40%] z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl backdrop-blur transition',
            hovered ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}

export function HomeRowSection({ row, onSeeAll }: { row: HomeRow; onSeeAll?: () => void }): React.JSX.Element {
  return (
    <GameRow
      title={row.title}
      games={row.games}
      showProgress={row.key === 'continue' || row.key === 'recent'}
      onSeeAll={onSeeAll}
    />
  )
}
