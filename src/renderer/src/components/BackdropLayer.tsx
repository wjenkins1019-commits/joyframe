import { useEffect, useState } from 'react'
import type { Game } from '@shared/types'
import { useStore } from '../state/store'
import { Backdrop } from './Art'

/**
 * Keeps the app background in sync with whatever the user is looking at
 * (hovered card, game detail, running game) with a crossfade.
 */
export function BackdropLayer(): React.JSX.Element {
  const games = useStore((state) => state.games)
  const previewId = useStore((state) => state.previewGameId)
  const detailId = useStore((state) => state.detailId)
  const playGameId = useStore((state) => state.playState.gameId)
  const view = useStore((state) => state.view)
  const [layers, setLayers] = useState<{ current: Game | null; previous: Game | null }>({
    current: null,
    previous: null
  })

  const active =
    games.find((game) => game.id === (detailId ?? previewId ?? playGameId)) ??
    (view === 'home' ? games.find((game) => game.backgroundPath || game.heroUrl) ?? null : null)

  useEffect(() => {
    if (!active) return
    setLayers((prev) => {
      if (prev.current?.id === active.id) return prev
      return { current: active, previous: prev.current }
    })
  }, [active?.id])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-jf-bg">
      {layers.previous && (
        <div key={`prev-${layers.previous.id}`} className="absolute inset-0 opacity-60">
          <Backdrop game={layers.previous} className="h-full w-full scale-105 object-cover" />
        </div>
      )}
      {layers.current && (
        <div key={`cur-${layers.current.id}`} className="absolute inset-0 animate-fade opacity-70">
          <Backdrop game={layers.current} className="h-full w-full scale-105 object-cover" />
        </div>
      )}
      {/* Smoked glass over the art: dark enough to read text, translucent enough
          that the backdrop and the ambient stage light still show through. */}
      <div className="absolute inset-0 bg-[radial-gradient(130%_100%_at_14%_0%,rgba(20,23,28,0.22)_0%,rgba(9,11,14,0.78)_56%,rgba(7,8,11,0.94)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0d10]/92 via-[#0b0d10]/58 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#0b0d10] via-[#0b0d10]/70 to-transparent" />
    </div>
  )
}
