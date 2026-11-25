import { useEffect, useRef, useState } from 'react'
import { registerIntroSkip } from '../lib/intro-gate'
import { useStore } from '../state/store'
import { LogoMark } from './Logo'
import { cx } from './ui'

/** The intro is a launch experience, not a per-mount one. */
let playedThisLaunch = false

type Phase = 'idle' | 'name' | 'play' | 'out' | 'done'

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
  const playerName = useStore((state) => state.settings.playerName)
  const updateSettings = useStore((state) => state.updateSettings)
  const [phase, setPhase] = useState<Phase>('idle')
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = phase === 'name' || phase === 'play' || phase === 'out'

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
    // An unnamed profile gets one cinematic beat to introduce itself before
    // the ident. A named one goes straight to the ident, which uses the name.
    setPhase(playerName ? 'play' : 'name')
    // Remember this profile has seen the intro whichever mode played it, so
    // switching to "first run only" later does not replay it.
    void window.joyframe?.app.markIntroPlayed().catch(() => undefined)
  }, [ready, phase, introMode, introPlayed, reduceMotion, playerName])

  // Focus the name field after its entry animation has started, so typing is
  // immediate but the caret does not race the reveal.
  useEffect(() => {
    if (phase !== 'name') return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [phase])

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
    // A controller has no way to type here, so any pad button moves on to the
    // ident instead of trapping the user. Keyboard input in the field is
    // ignored by navigation, so typing still edits the name rather than
    // skipping. The ident itself still dismisses to the app.
    if (phase === 'name') return registerIntroSkip(() => setPhase('play'))
    return registerIntroSkip(() => setPhase('done'))
  }, [visible, phase])

  const beginIntro = async (): Promise<void> => {
    const trimmed = name.trim().slice(0, 24)
    if (trimmed && trimmed !== playerName) {
      try {
        await updateSettings({ playerName: trimmed })
      } catch {
        /* the intro can still play unnamed */
      }
    }
    setPhase('play')
  }

  if (!visible) return null

  if (phase === 'name') {
    return (
      <div
        data-jf-intro="name"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to JOYFRAME"
        className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-[#07080b]"
      >
        <div className="jf-intro-glow" />
        <div className="jf-name-letterbox pointer-events-none absolute inset-0" />

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void beginIntro()
          }}
          className="relative w-[min(780px,90vw)] animate-rise text-center"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.55em] text-white/35">Player One</p>
          <h1 className="jf-name-title mt-5 font-black text-white">
            TIME FOR YOUR
            <br />
            <span className="text-jf-red">GAME FACE</span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-white/50">
            What should the universe call you? Your name personalizes the intro and the console.
          </p>

          <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row">
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 24))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setPhase('play')
                }
              }}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              placeholder="Your name"
              aria-label="Your name"
              className="jf-name-input h-12 flex-1 rounded-full px-6 text-center text-base text-white placeholder:text-white/25 sm:text-left"
            />
            <button
              type="submit"
              className="jf-glass-btn h-12 shrink-0 px-7 text-sm font-bold tracking-wide"
            >
              {name.trim() ? "Let's play" : 'Continue'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setPhase('play')}
            className="mt-7 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/30 transition hover:text-white/70"
          >
            Skip for now
          </button>
        </form>

        <div className="absolute bottom-10 text-[9px] font-semibold uppercase tracking-[0.35em] text-white/20">
          A 965 Media creation
        </div>
      </div>
    )
  }

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
          {playerName ? (
            <>
              Game face on, <span className="text-white/70">{playerName}</span>
            </>
          ) : (
            'Every Game. One Universe.'
          )}
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
