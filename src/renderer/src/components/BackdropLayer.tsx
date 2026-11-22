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
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_10%,rgba(21,23,27,0.15)_0%,rgba(21,23,27,0.82)_58%,#15171b_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#15171b] via-[#15171b]/72 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#15171b] to-transparent" />
    </div>
  )
}
