import type { Dispatch, SetStateAction } from 'react'
import { Image as ImageIcon, Layers, X } from 'lucide-react'
import type { ArtworkCandidate, Collection, Game } from '@shared/types'
import { useModalLayer } from '../lib/navigation'
import { Button, IconButton, Modal, Spinner, cx } from './ui'

interface DetailModalsProps {
  game: Game
  collections: Collection[]
  collectionOpen: boolean
  setCollectionOpen: Dispatch<SetStateAction<boolean>>
  toggleCollection: (collectionId: string) => void
  artworkOpen: boolean
  setArtworkOpen: Dispatch<SetStateAction<boolean>>
  candidates: ArtworkCandidate[]
  busy: string | null
  applyLocalArtwork: (kind: ArtworkCandidate['kind']) => void
  applyArtwork: (kind: ArtworkCandidate['kind'], url: string) => void
  lightbox: string | null
  setLightbox: Dispatch<SetStateAction<string | null>>
}

export function DetailModals(props: DetailModalsProps): React.JSX.Element {
  const {
    game,
    collections,
    collectionOpen,
    setCollectionOpen,
    toggleCollection,
    artworkOpen,
    setArtworkOpen,
    candidates,
    busy,
    applyLocalArtwork,
    applyArtwork,
    lightbox,
    setLightbox
  } = props
  const layerRef = useModalLayer()

  return (
    <>
      <Modal open={collectionOpen} onClose={() => setCollectionOpen(false)} title="Collections" subtitle={game.title} width="max-w-lg">
        <div className="space-y-1.5">
          {collections.length === 0 && (
            <p className="text-xs text-jf-muted">No collections yet. Create one from the Collections page.</p>
          )}
          {collections.map((collection) => {
            const active = collection.gameIds.includes(game.id)
            return (
              <button
                key={collection.id}
                data-nav="1"
                onClick={() => void toggleCollection(collection.id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition',
                  active ? 'border-jf-red/40 bg-jf-red/12' : 'border-white/8 bg-white/3 hover:bg-white/8'
                )}
              >
                <Layers className={cx('h-4 w-4', active ? 'text-jf-red' : 'text-white/40')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{collection.name}</p>
                  <p className="text-[10px] text-white/40">{collection.gameIds.length} games</p>
                </div>
                <span className={cx('text-[10px] font-bold uppercase', active ? 'text-jf-redtext' : 'text-white/30')}>
                  {active ? 'Added' : 'Add'}
                </span>
              </button>
            )
          })}
        </div>
      </Modal>

      <Modal
        open={artworkOpen}
        onClose={() => setArtworkOpen(false)}
        title="Artwork"
        subtitle={`${game.title} — cached locally for offline browsing`}
        width="max-w-4xl"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(['cover', 'background', 'logo', 'screenshot'] as ArtworkCandidate['kind'][]).map((kind) => (
            <Button key={kind} size="sm" variant="secondary" icon={<ImageIcon className="h-3.5 w-3.5" />} onClick={() => void applyLocalArtwork(kind)}>
              Upload {kind}
            </Button>
          ))}
        </div>
        {busy === 'artwork' && (
          <div className="mb-3 flex items-center gap-2 text-xs text-jf-muted">
            <Spinner /> Applying artwork…
          </div>
        )}
        {candidates.length === 0 ? (
          <p className="py-8 text-center text-xs text-jf-muted">No online artwork candidates for this game. Upload your own above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {candidates.map((candidate) => (
              <div key={candidate.url} className="overflow-hidden rounded-lg border border-white/10 bg-black/25">
                <div className="h-[150px] w-full bg-black/40">
                  <img src={candidate.url} alt={candidate.label} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="p-2">
                  <p className="truncate text-[11px] font-semibold text-white/80">{candidate.label}</p>
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-white/30">{candidate.provider}</p>
                  <div className="flex flex-wrap gap-1">
                    <button className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-jf-red" onClick={() => void applyArtwork('cover', candidate.url)}>
                      Cover
                    </button>
                    <button className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-jf-red" onClick={() => void applyArtwork('background', candidate.url)}>
                      Background
                    </button>
                    <button className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-jf-red" onClick={() => void applyArtwork('logo', candidate.url)}>
                      Logo
                    </button>
                    <button className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-jf-red" onClick={() => void applyArtwork('screenshot', candidate.url)}>
                      Screenshot
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* A modal layer: confines d-pad focus and lets B / Escape close just the image. */}
      {lightbox && (
        <div
          ref={layerRef}
          data-jf-modal="1"
          className="fixed inset-0 z-[98] flex items-center justify-center bg-black/95 p-8 animate-fade"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          <IconButton label="Close image" className="absolute right-6 top-6" onClick={() => setLightbox(null)} data-jf-modal-close="1">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    </>
  )
}
