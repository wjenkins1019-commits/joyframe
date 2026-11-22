import { useEffect } from 'react'
import { ExternalLink, Volume2, VolumeX, X } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from './ui'

function youtubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

export function TrailerOverlay({
  url,
  title,
  onClose
}: {
  url: string
  title: string
  onClose: () => void
}): React.JSX.Element {
  const [muted, setMuted] = useState(false)
  const yt = youtubeId(url)

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-black/95 animate-fade">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-jf-redtext">Trailer</p>
          <h2 className="text-lg font-bold text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {!yt && (
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((value) => !value)}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconButton>
          )}
          <IconButton label="Open in browser" onClick={() => void window.joyframe.system.openExternal(url)}>
            <ExternalLink className="h-4 w-4" />
          </IconButton>
          <IconButton label="Close trailer" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-8">
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`}
            title={`${title} trailer`}
            className="aspect-video w-full max-w-6xl rounded-xl border border-white/10"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            muted={muted}
            className="max-h-full w-full max-w-6xl rounded-xl border border-white/10 bg-black shadow-2xl"
          />
        )}
      </div>
    </div>
  )
}

export function InlineVideo({ url, title }: { url: string; title: string }): React.JSX.Element {
  const yt = youtubeId(url)
  if (yt) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0`}
        title={`${title} trailer`}
        className="aspect-video w-full rounded-xl border border-white/10"
        allow="accelerometer; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    )
  }
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="aspect-video w-full rounded-xl border border-white/10 bg-black"
    />
  )
}
