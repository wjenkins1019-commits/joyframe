import { useEffect, useState } from 'react'
import { registerIntroSkip } from '../lib/intro-gate'
import { useStore } from '../state/store'
import { LogoMark } from './Logo'
import { cx } from './ui'

/** The intro is a launch experience, not a per-mount one. */
let playedThisLaunch = false

type Phase = 'idle' | 'play' | 'out' | 'done'

/**
 * Brief JOYFRAME ident shown at startup: the mark snaps in with a halo, the
 * wordmark and tagline follow, and a loading rule sweeps across before the
 * overlay fades away. It never takes pointer input once dismissed, and the
 * first click, key or controller button skips it.
 *
 * Settings decide whether it plays at all: every launch, only on a profile
 * that has never seen it, or never. The decision waits for saved settings so a
 * user who turned it off never sees a frame of it.
 */
export function IntroSplash(): React.JSX.Element | null {
  const ready = useStore((state) => state.ready)
  const introMode = useStore((state) => state.settings.introMode)
  const introPlayed = useStore((state) => state.introPlayed)
  const reduceMotion = useStore((state) => state.settings.reduceMotion)
  const [phase, setPhase] = useState<Phase>('idle')
  const visible = phase === 'play' || phase === 'out'

  // Decide once settings are in: `ready` is only set after the first payload,
  // so a profile set to "off" or "first run only" never flashes a frame.
  useEffect(() => {
    if (!ready || phase !== 'idle') return
    const enabled = introMode === 'always' || (introMode === 'first-run' && !introPlayed)
    if (playedThisLaunch || reduceMotion || !enabled) {
      setPhase('done')
      return
    }
    playedThisLaunch = true
    setPhase('play')
    // Remember this profile has seen the ident whichever mode played it, so
    // switching to "first run only" later does not replay it.
    void window.joyframe?.app.markIntroPlayed().catch(() => undefined)
  }, [ready, phase, introMode, introPlayed, reduceMotion])

  // Each phase owns one timer, so entering the fade cannot cancel the timeout
  // that finally removes the overlay (out at 2100ms, gone at 2700ms).
  useEffect(() => {
    const next = phase === 'play' ? { phase: 'out' as Phase, after: 2100 } : phase === 'out' ? { phase: 'done' as Phase, after: 600 } : null
    if (!next) return
    const timer = window.setTimeout(() => setPhase(next.phase), next.after)
    return () => window.clearTimeout(timer)
  }, [phase])

  // While the ident is on screen the first input dismisses it. The cleanup
  // closes the gate when the overlay leaves, since this component stays
  // mounted and renders null afterwards.
  useEffect(() => {
    if (!visible) return
    return registerIntroSkip(() => setPhase('done'))
  }, [visible])

  if (!visible) return null

  return (
    <div
      data-jf-intro={phase}
      aria-hidden="true"
      onPointerDown={() => setPhase('done')}
      className={cx(
        'fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-[#07080b]',
        phase === 'play' ? 'pointer-events-auto' : 'pointer-events-none',
        phase === 'out' && 'jf-intro-out'
      )}
    >
      <div className="jf-intro-glow" />
      <div className="relative flex flex-col items-center">
        <div className="jf-intro-mark relative">
          <span className="jf-intro-ring" />
          <LogoMark size={104} className="drop-shadow-[0_24px_60px_rgba(215,25,53,0.45)]" />
        </div>

        <div className="jf-intro-word mt-8">
          <span className="text-[34px] font-black tracking-[0.28em] text-white">
            JOY<span className="text-jf-red">FRAME</span>
          </span>
        </div>

        <p className="jf-intro-tagline mt-3 text-[10px] font-semibold uppercase tracking-[0.46em] text-white/40">
          Every Game. One Universe.
        </p>

        <div className="jf-intro-bar mt-12 h-px w-56 overflow-hidden bg-white/10">
          <span className="block h-full w-full origin-left bg-jf-red" />
        </div>

        <p className="jf-intro-skip mt-5 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/25">
          Press anything to skip
        </p>
      </div>

      <div className="absolute bottom-10 text-[9px] font-semibold uppercase tracking-[0.35em] text-white/20">
        A 965 Media creation
      </div>
    </div>
  )
}
