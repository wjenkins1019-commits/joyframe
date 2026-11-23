import { FolderSearch, Gamepad2, Plus, Sparkles, Star, Tv2 } from 'lucide-react'
import { useStore } from '../../state/store'
import { Hero } from '../Hero'
import { DataSourceNote } from '../Credits'
import { HomeRowSection } from '../GameRow'
import { Button, EmptyState } from '../ui'

export function HomeView({ onScan, onAddGame }: { onScan: () => void; onAddGame: () => void }): React.JSX.Element {
  const games = useStore((state) => state.games)
  const home = useStore((state) => state.home)
  const setView = useStore((state) => state.setView)
  const setSearch = useStore((state) => state.setSearch)
  const settings = useStore((state) => state.settings)
  const stats = useStore((state) => state.stats)

  if (!games.length) {
    return (
      <div className="pb-16">
        <section className="relative mb-10 overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-br from-[#2a1117] via-[#1b1d22] to-[#15171b] px-10 py-12">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-jf-red/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-jf-redtext">Welcome to JOYFRAME</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white">
              Every game you own.<br />One universe.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-jf-muted">
              Import your Steam library, scan folders for installed PC games, or point JOYFRAME at your legally
              owned ROM collection. Your library stays on this machine — artwork can stream on demand or be cached
              for offline browsing, and one game never imports twice when it exists in several formats.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button
                variant="primary"
                size="lg"
                icon={<Gamepad2 className="h-5 w-5" />}
                onClick={() => setView('steam')}
              >
                Import Steam library
              </Button>
              <Button variant="secondary" size="lg" icon={<FolderSearch className="h-5 w-5" />} onClick={onScan}>
                Scan folders
              </Button>
              <Button variant="outline" size="lg" icon={<Plus className="h-5 w-5" />} onClick={onAddGame}>
                Add a game manually
              </Button>
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Gamepad2,
              title: 'Steam + PC games',
              body: 'Reads local Steam manifests, installed titles and your recorded playtime without touching DRM.'
            },
            {
              icon: Sparkles,
              title: 'Emulation ready',
              body: 'Detects RetroArch and 30+ standalone emulators, maps ROM folders to platforms and launches with your cores.'
            },
            {
              icon: Star,
              title: 'Cinematic browsing',
              body: 'Poster rows, dynamic backdrops, trailers and a living-room Console Mode built for a controller.'
            },
            {
              icon: Tv2,
              title: 'One launcher',
              body: 'Resume what you played last, track playtime automatically and keep per-game emulator profiles.'
            }
          ].map((card) => {
            const Icon = card.icon
            return (
              <div key={card.title} className="jf-card rounded-xl p-5">
                <Icon className="h-5 w-5 text-jf-red" />
                <h3 className="mt-3 text-sm font-bold text-white">{card.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-jf-muted">{card.body}</p>
              </div>
            )
          })}
        </div>

        <div className="mt-8">
          <EmptyState
            icon={<Gamepad2 className="h-6 w-6" />}
            title="Your universe is empty — for now"
            description="Run a scan to fill this dashboard with rows for Continue Playing, Steam, retro classics and more."
            action={
              <Button variant="primary" onClick={onScan} icon={<FolderSearch className="h-4 w-4" />}>
                Start scanning
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pb-20">
      <Hero pool={games} />

      {!home.length && (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Nothing to show yet"
          description="Games are hidden or your sections are all disabled. Re-enable sections in Settings or reveal hidden games."
        />
      )}

      <div className="space-y-8 px-1">
        {home.map((row) => (
          <HomeRowSection
            key={row.id}
            row={row}
            onSeeAll={() => {
              if (row.collectionId) {
                setSearch('')
                setView('collections')
              } else {
                setView('library')
              }
            }}
          />
        ))}
      </div>

      <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 px-1 pt-5 text-[11px] text-white/30">
        <span>
          {stats.totalGames} games · {stats.installedGames} installed · {Math.round(stats.totalPlaytimeSeconds / 3600)}h
          tracked
        </span>
        <span>{settings.autoPreviews ? 'Automatic previews on' : 'Previews disabled'} · Offline library ready</span>
        <DataSourceNote className="w-full border-t border-white/5 pt-3" />
      </footer>
    </div>
  )
}
