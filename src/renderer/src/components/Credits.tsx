import type { ReactNode } from 'react'
import { ScrollText } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../state/store'
import { Modal, cx } from './ui'

const SOURCES: { name: string; url: string; body: string }[] = [
  {
    name: 'Steam Store',
    url: 'https://store.steampowered.com',
    body: 'Descriptions, developers, publishers, genres, release dates, Metacritic scores, screenshots and trailers for Steam titles. Keyless and streamed from the public store API.'
  },
  {
    name: 'RAWG',
    url: 'https://rawg.io',
    body: 'Descriptions, genres, companies, release dates, cover art and screenshots for non-Steam games. Data and images are used under the RAWG API terms and credited wherever they appear.'
  },
  {
    name: 'IGDB',
    url: 'https://www.igdb.com',
    body: 'Descriptions, genres, companies and artwork for retro and non-Steam titles, when a Twitch client ID and secret are configured.'
  }
]

function ExternalLink({
  href,
  children,
  className
}: {
  href: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <a
      data-nav="1"
      href={href}
      onClick={(event) => {
        event.preventDefault()
        void api.system.openExternal(href)
      }}
      className={cx(
        'font-semibold text-jf-accent underline decoration-jf-accent/40 underline-offset-2 hover:decoration-jf-accent',
        className
      )}
    >
      {children}
    </a>
  )
}

/**
 * Compact visible attribution for screens that render provider data. The full
 * wording lives once in CreditsDialog; this keeps an active RAWG link on the
 * page and opens the shared credits surface.
 */
export function DataSourceNote({ className }: { className?: string }): React.JSX.Element {
  const openCredits = useStore((state) => state.openCredits)
  return (
    <p className={cx('text-[10px] leading-relaxed text-white/30', className)}>
      Game data and artwork by Steam Store, <ExternalLink href="https://rawg.io" className="text-white/45">RAWG</ExternalLink>{' '}
      and IGDB.{' '}
      <button
        data-nav="1"
        onClick={openCredits}
        className="font-semibold text-white/45 underline decoration-white/20 underline-offset-2 transition hover:text-white/80"
      >
        Credits & sources
      </button>
    </p>
  )
}

export function CreditsDialog(): React.JSX.Element {
  const open = useStore((state) => state.creditsOpen)
  const close = useStore((state) => state.closeCredits)
  const info = useStore((state) => state.info)
  return (
    <Modal
      open={open}
      onClose={close}
      title="Credits & data sources"
      subtitle="Where the metadata, artwork and measurements in JOYFRAME come from."
      width="max-w-2xl"
      footer={
        <button
          data-nav="1"
          onClick={close}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/16"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4 text-xs leading-relaxed text-jf-muted">
        <p>
          JOYFRAME reads your local library and fills in the rest from public game databases. Playtime, completion
          status, launch methods and save records are yours alone and never leave this machine; provider requests only
          send a title or an App ID.
        </p>

        <div className="space-y-3">
          {SOURCES.map((source) => (
            <div key={source.name} className="rounded-lg border border-white/8 bg-black/25 p-3">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/70">
                <ScrollText className="h-3.5 w-3.5 text-jf-red" />
                {source.name}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">{source.body}</p>
              <p className="mt-1.5 text-[11px]">
                <ExternalLink href={source.url}>{source.url}</ExternalLink>
              </p>
            </div>
          ))}
        </div>

        <p>
          Artwork, names and trademarks belong to their respective owners. Metadata is shown for identification and
          library organisation only, and is never sold or redistributed.
        </p>

        <p className="border-t border-white/8 pt-3 text-[11px] text-white/35">
          JOYFRAME {info.version ? `v${info.version}` : ''} — a 965 Media creation.
        </p>
      </div>
    </Modal>
  )
}
