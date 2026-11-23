import { useMemo } from 'react'
import { Clock, Gamepad2, Heart, Trophy, Zap } from 'lucide-react'
import { formatPlaytime, percent, relativeTime } from '../../lib/format'
import { useStore } from '../../state/store'
import { SmartImage } from '../Art'
import { DataSourceNote } from '../Credits'
import { Badge, EmptyState, PageHeader, cx } from '../ui'

function Kpi({
  label,
  value,
  hint,
  icon,
  accent
}: {
  label: string
  value: string
  hint?: string
  icon: React.ReactNode
  accent?: boolean
}): React.JSX.Element {
  return (
    <div className={cx('jf-card rounded-xl p-4', accent && 'border-jf-red/25 bg-gradient-to-br from-[#2d1219] to-[#23262c]')}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">{label}</p>
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', accent ? 'bg-jf-red/20 text-jf-red' : 'bg-white/6 text-white/50')}>
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-jf-muted">{hint}</p>}
    </div>
  )
}

export function StatsView(): React.JSX.Element {
  const stats = useStore((state) => state.stats)
  const games = useStore((state) => state.games)
  const platforms = useStore((state) => state.platforms)
  const openDetail = useStore((state) => state.openDetail)

  const maxDay = useMemo(() => Math.max(1, ...stats.last30Days.map((entry) => entry.seconds)), [stats.last30Days])
  const maxTop = useMemo(() => Math.max(1, ...stats.topGames.map((entry) => entry.playtimeSeconds)), [stats.topGames])
  const totalPlayed = stats.totalPlaytimeSeconds || 1
  const completionTotal = stats.completedCount + stats.inProgressCount + stats.unplayedCount || 1

  if (!games.length) {
    return (
      <div className="pb-20">
        <PageHeader eyebrow="Insights" title="Gaming Statistics" />
        <EmptyState
          icon={<Trophy className="h-6 w-6" />}
          title="No statistics yet"
          description="Once you import games and play them, this dashboard fills with playtime, platform breakdowns and streaks."
        />
      </div>
    )
  }

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Insights"
        title="Gaming Statistics"
        description="Everything JOYFRAME measures about your collection — built from local playtime tracking and your manual completion statuses."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total playtime"
          value={`${Math.floor(stats.totalPlaytimeSeconds / 3600)}h`}
          hint={`${stats.totalGames} games in your universe`}
          icon={<Clock className="h-4 w-4" />}
          accent
        />
        <Kpi
          label="Games played"
          value={`${stats.totalGames - stats.unplayedCount}`}
          hint={`${stats.unplayedCount} still waiting`}
          icon={<Gamepad2 className="h-4 w-4" />}
        />
        <Kpi label="Completed" value={String(stats.completedCount)} hint={`${stats.inProgressCount} in progress`} icon={<Trophy className="h-4 w-4" />} />
        <Kpi label="Favorites" value={String(stats.favoriteCount)} hint={`${stats.addedThisMonth} added this month`} icon={<Heart className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="jf-card rounded-xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Play activity</h2>
              <p className="text-[11px] text-jf-muted">Tracked playtime over the last 30 days</p>
            </div>
            <Badge tone="dark">{formatPlaytime(stats.last30Days.reduce((sum, day) => sum + day.seconds, 0))}</Badge>
          </div>
          <div className="flex h-40 items-end gap-[3px]">
            {stats.last30Days.map((day) => (
              <div key={day.day} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
                <div
                  className={cx(
                    'w-full rounded-sm transition-all',
                    day.seconds > 0 ? 'bg-gradient-to-t from-jf-reddark to-jf-red' : 'bg-white/6'
                  )}
                  style={{ height: `${Math.max(2, percent(day.seconds, maxDay))}%` }}
                />
                <span className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded bg-black/90 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                  {day.day.slice(5)} · {formatPlaytime(day.seconds)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-white/30">
            <span>{stats.last30Days[0]?.day.slice(5)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="jf-card rounded-xl p-5">
          <h2 className="text-sm font-bold text-white">Completion</h2>
          <p className="text-[11px] text-jf-muted">Where your library stands</p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/8">
            <div className="bg-emerald-500" style={{ width: `${percent(stats.completedCount, completionTotal)}%` }} />
            <div className="bg-jf-red" style={{ width: `${percent(stats.inProgressCount, completionTotal)}%` }} />
            <div className="bg-white/15" style={{ width: `${percent(stats.unplayedCount, completionTotal)}%` }} />
          </div>
          <div className="mt-4 space-y-2 text-xs">
            {[
              { label: 'Completed', value: stats.completedCount, color: 'bg-emerald-500' },
              { label: 'In progress', value: stats.inProgressCount, color: 'bg-jf-red' },
              { label: 'Unplayed', value: stats.unplayedCount, color: 'bg-white/25' }
            ].map((entry) => (
              <div key={entry.label} className="flex items-center gap-2">
                <span className={cx('h-2 w-2 rounded-full', entry.color)} />
                <span className="text-jf-muted">{entry.label}</span>
                <span className="ml-auto font-semibold text-white">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="jf-card rounded-xl p-5">
          <h2 className="text-sm font-bold text-white">Most played</h2>
          <div className="mt-4 space-y-3">
            {stats.topGames.length === 0 && <p className="text-xs text-jf-muted">No playtime recorded yet.</p>}
            {stats.topGames.map((game) => (
              <button
                key={game.id}
                data-nav="1"
                onClick={() => openDetail(game.id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <SmartImage src={game.coverPath} alt={game.title} className="h-11 w-8 shrink-0 rounded" fallbackSeed={game.title} showInitials={false} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-white">{game.title}</p>
                    <span className="shrink-0 text-[11px] text-jf-muted">{formatPlaytime(game.playtimeSeconds)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-jf-red" style={{ width: `${percent(game.playtimeSeconds, maxTop)}%` }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="jf-card rounded-xl p-5">
          <h2 className="text-sm font-bold text-white">Recently played</h2>
          <div className="mt-4 space-y-2.5">
            {stats.recent.length === 0 && <p className="text-xs text-jf-muted">Nothing played yet — pick something from the dashboard.</p>}
            {stats.recent.map((game) => (
              <button
                key={game.id}
                data-nav="1"
                onClick={() => openDetail(game.id)}
                className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-white/5"
              >
                <SmartImage src={game.coverPath} alt={game.title} className="h-11 w-8 shrink-0 rounded" fallbackSeed={game.title} showInitials={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{game.title}</p>
                  <p className="text-[11px] text-jf-muted">{relativeTime(game.lastPlayed)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="jf-card rounded-xl p-5">
          <h2 className="text-sm font-bold text-white">By platform</h2>
          <div className="mt-4 space-y-2.5">
            {stats.byPlatform.slice(0, 8).map((entry) => (
              <div key={entry.platformId}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-white/80">{entry.name}</span>
                  <span className="shrink-0 text-jf-muted">
                    {entry.count} · {formatPlaytime(entry.playtime)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-jf-reddark to-jf-red"
                    style={{ width: `${percent(entry.count, stats.totalGames)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="jf-card rounded-xl p-5">
          <h2 className="text-sm font-bold text-white">By genre</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.byGenre.map((entry) => (
              <span
                key={entry.genre}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70"
              >
                {entry.genre} <span className="text-white/35">{entry.count}</span>
              </span>
            ))}
            {stats.byGenre.length === 0 && <p className="text-xs text-jf-muted">Genres appear after metadata refreshes.</p>}
          </div>
          <div className="mt-5 border-t border-white/8 pt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">By source</p>
            <div className="flex flex-wrap gap-3">
              {stats.bySource.map((entry) => (
                <div key={entry.source} className="flex items-center gap-1.5 text-[11px] text-white/60">
                  <Zap className="h-3 w-3 text-jf-red" />
                  {entry.source}
                  <span className="font-semibold text-white">{entry.count}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[10px] leading-relaxed text-white/30">
              {platforms.length} platforms mapped. Playtime is tracked automatically for games JOYFRAME launches and manually for everything else.
              Steam playtime is imported from your local Steam config. Total tracked playtime: {formatPlaytime(totalPlayed)}.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end px-1">
        <DataSourceNote />
      </div>
    </div>
  )
}
