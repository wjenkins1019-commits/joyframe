import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useStore } from '../state/store'
import { cx } from './ui'

export function Toasts(): React.JSX.Element {
  const toasts = useStore((state) => state.toasts)
  const dismiss = useStore((state) => state.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-[76px] right-6 z-[100] flex w-[360px] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'error' ? XCircle : toast.tone === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-2xl backdrop-blur-xl animate-rise',
              toast.tone === 'error'
                ? 'border-red-500/35 bg-[#2a1519]/95 text-red-100'
                : toast.tone === 'success'
                  ? 'border-emerald-500/30 bg-[#14221d]/95 text-emerald-100'
                  : 'border-white/12 bg-[#202329]/95 text-white/90'
            )}
            role="status"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="text-white/40 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Glyph({ children }: { children: string }): React.JSX.Element {
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-white/25 bg-white/10 px-1 text-[10px] font-bold text-white">
      {children}
    </span>
  )
}

export function ControllerBar(): React.JSX.Element | null {
  const controller = useStore((state) => state.controller)
  const settings = useStore((state) => state.settings)
  const consoleMode = useStore((state) => state.consoleMode)

  if (!controller.connected || settings.controllerPrompts === 'none') return null
  const glyphs =
    settings.controllerPrompts === 'playstation' || (settings.controllerPrompts === 'auto' && controller.kind === 'playstation')
      ? { a: '✕', b: '○', y: '△' }
      : { a: 'A', b: 'B', y: 'Y' }

  return (
    <div
      className={cx(
        'pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[11px] text-white/65 backdrop-blur-xl',
        consoleMode && 'border-white/20 bg-black/55'
      )}
    >
      <span className="flex items-center gap-1.5">
        <Glyph>{glyphs.a}</Glyph> Select
      </span>
      <span className="flex items-center gap-1.5">
        <Glyph>{glyphs.b}</Glyph> Back
      </span>
      <span className="flex items-center gap-1.5">
        <Glyph>{glyphs.y}</Glyph> Favorite
      </span>
      <span className="flex items-center gap-1.5">
        <Glyph>LB</Glyph>
        <Glyph>RB</Glyph> Sections
      </span>
      <span className="max-w-[160px] truncate text-white/35">{controller.name}</span>
    </div>
  )
}
