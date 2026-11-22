import { LogoMark, Wordmark } from './Logo'

/**
 * Smoked-glass wipe that covers the desktop → Console Mode hand-off. It fades
 * itself out and never takes input, so it cannot block the focus that lands on
 * the console's first card underneath.
 */
export function ConsoleTransition(): React.JSX.Element {
  return (
    <div className="jf-console-veil" aria-hidden="true">
      <div className="jf-console-beacon">
        <span className="jf-console-halo" />
        <LogoMark size={74} className="drop-shadow-[0_18px_50px_rgba(215,25,53,0.55)]" />
        <Wordmark size={26} tagline />
        <p className="text-[10px] font-bold uppercase tracking-[0.55em] text-white/45">Console mode</p>
      </div>
    </div>
  )
}
