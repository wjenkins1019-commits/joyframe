import { useEffect, useState, type ReactNode } from 'react'
import { Gamepad2 } from 'lucide-react'
import {
  PAD_ACTIVITY_DEADZONE,
  PAD_INPUTS,
  STICK_ENGAGE,
  STICK_RELEASE,
  getPadDiagnostics,
  resetPadChecklist,
  type PadDiagnostics,
  type PadDiagnosticsButton
} from '../lib/navigation'
import { Section, cx } from './ui'

const BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Back',
  'Start',
  'L3',
  'R3',
  'Up',
  'Down',
  'Left',
  'Right',
  'Guide'
]

const AXIS_LABELS = ['Left X', 'Left Y', 'Right X', 'Right Y']
/** Which latched navigation directions light up each axis bar. */
const AXIS_DIRECTIONS = [
  ['left', 'right'],
  ['up', 'down'],
  [],
  []
]

/** Below this deflection the bar stays empty so resting sticks read as zero. */
const DISPLAY_MIN = 0.05

const toPct = (v: number): number => ((v + 1) / 2) * 100
const THRESHOLD_MARKS = [toPct(-STICK_ENGAGE), toPct(-STICK_RELEASE), toPct(STICK_RELEASE), toPct(STICK_ENGAGE)]

/** One fill colour scale for both bar kinds; `data-state` exposes it to scripts/verify-pad.mjs. */
const FILL_CLASSES = {
  engaged: 'bg-jf-red',
  active: 'bg-white/60',
  idle: 'bg-transparent'
}

type FillState = keyof typeof FILL_CLASSES
const fillState = (engaged: boolean, magnitude: number): FillState =>
  engaged ? 'engaged' : magnitude > DISPLAY_MIN ? 'active' : 'idle'

/** Tenths under ten seconds (ticks are 150ms apart), whole seconds after. */
const ago = (at: number): string => {
  const seconds = Math.max(0, performance.now() - at) / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

function BarShell({ label, readout, children }: { label: string; readout: string; children: ReactNode }): React.JSX.Element {
  return (
    <div data-diag-bar={label}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-white/70">{label}</span>
        <span data-diag-readout className="font-mono text-[11px] text-white/70">
          {readout}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">{children}</div>
    </div>
  )
}

function TriggerBar({ label, button }: { label: string; button: PadDiagnosticsButton }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, button.value))
  const state = fillState(button.pressed, clamped)
  return (
    <BarShell label={label} readout={clamped.toFixed(2)}>
      <div
        data-diag-fill
        data-state={state}
        className={cx('absolute inset-y-0 left-0 rounded-full', FILL_CLASSES[state])}
        style={{ width: `${clamped * 100}%` }}
      />
    </BarShell>
  )
}

function AxisBar({ label, value, engaged }: { label: string; value: number; engaged: boolean }): React.JSX.Element {
  const clamped = Math.max(-1, Math.min(1, value))
  const pos = toPct(clamped)
  const state = fillState(engaged, Math.abs(clamped))
  return (
    <BarShell label={label} readout={`${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)}`}>
      {THRESHOLD_MARKS.map((mark) => (
        <div key={mark} className="absolute inset-y-0 w-px bg-white/50" style={{ left: `${mark}%` }} />
      ))}
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
      <div
        data-diag-fill
        data-state={state}
        className={cx('absolute inset-y-0 rounded-full', FILL_CLASSES[state])}
        style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }}
      />
    </BarShell>
  )
}

export function ControllerDiagnostics(): React.JSX.Element {
  const [diag, setDiag] = useState<PadDiagnostics>(getPadDiagnostics)

  useEffect(() => {
    resetPadChecklist()
    setDiag(getPadDiagnostics())
    const timer = window.setInterval(() => setDiag(getPadDiagnostics()), 150)
    return () => window.clearInterval(timer)
  }, [])

  const seen = new Set(diag.seen)
  const action = diag.lastAction
  const actionLabel = action ? (PAD_INPUTS.find((input) => input.key === action.key)?.label ?? action.key) : ''

  return (
    <Section
      title="Controller diagnostics"
      description="Live gamepad state for verifying a physical controller — no input needed elsewhere."
      icon={<Gamepad2 className="h-4 w-4" />}
    >
      {diag.pads.length === 0 ? (
        <div className="rounded-lg border border-white/8 bg-black/25 p-4 text-[11px] leading-relaxed text-jf-muted">
          <p className="font-semibold text-white/75">No gamepad detected.</p>
          <p className="mt-1">
            Press any button or move a stick to wake the controller, then watch this panel. Prefer a USB cable for
            the first test: some wireless and virtual pads (Steam Input, remappers) are invisible to the browser
            while working fine at the OS level. Extra idle entries are harmless — input always follows the most
            recently active pad.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {diag.pads.map((pad) => (
            <div key={pad.index} data-diag-pad={pad.index} className="rounded-lg border border-white/8 bg-black/25 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-semibold text-white/85">Pad {pad.index}</span>
                {pad.index === diag.pinnedIndex && (
                  <span
                    data-diag-pinned
                    className="rounded-full bg-jf-red px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  >
                    Pinned — receiving input
                  </span>
                )}
                <span
                  data-pad-mapping={pad.mapping}
                  className={cx(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    pad.mapping === 'standard' ? 'bg-white/10 text-white/60' : 'bg-amber-500/15 text-amber-200'
                  )}
                >
                  {pad.mapping || 'no mapping'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-white/40">{pad.id}</span>
              </div>
              {pad.mapping !== 'standard' && (
                <p
                  data-diag-mapping-warning
                  className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-200/90"
                >
                  This pad reports no standard mapping, so the browser cannot promise which slots hold the triggers and
                  face buttons — treat the LT/RT bars and button labels below as raw slots, not positions.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {pad.axes.map((value, i) => (
                  <AxisBar
                    key={i}
                    label={AXIS_LABELS[i] ?? `Axis ${i}`}
                    value={value}
                    engaged={(AXIS_DIRECTIONS[i] ?? []).some((direction) => diag.engaged.includes(direction))}
                  />
                ))}
              </div>
              {pad.buttons.length >= 8 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TriggerBar label="LT" button={pad.buttons[6]} />
                  <TriggerBar label="RT" button={pad.buttons[7]} />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pad.buttons.map((button, i) => (
                  <span
                    key={i}
                    title={`Button ${i}${button.pressed ? ' — pressed' : ''}`}
                    className={cx(
                      'rounded-md border px-2 py-1 font-mono text-[10px] font-semibold',
                      button.pressed ? 'border-transparent bg-jf-red text-white' : 'border-white/10 text-white/35'
                    )}
                  >
                    {BUTTON_NAMES[i] ?? i}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-white/8 bg-black/25 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-white/75">Last action</span>
              {action ? (
                <span data-diag-last-action={action.key} className="font-mono text-[11px] text-white/70">
                  {actionLabel} · pad {action.padIndex} · {ago(action.at)} ago
                </span>
              ) : (
                <span data-diag-last-action="" className="font-mono text-[11px] text-white/35">
                  nothing yet — press a button
                </span>
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-white/75">Inputs this app consumes</span>
              <span data-diag-check-count className="font-mono text-[11px] text-white/50">
                {seen.size}/{PAD_INPUTS.length}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PAD_INPUTS.map((input) => {
                const done = seen.has(input.key)
                return (
                  <span
                    key={input.key}
                    data-diag-check={input.key}
                    data-state={done ? 'seen' : 'pending'}
                    className={cx(
                      'rounded-md border px-2 py-1 font-mono text-[10px] font-semibold',
                      done ? 'border-transparent bg-jf-red text-white' : 'border-white/10 text-white/35'
                    )}
                  >
                    {done ? '✓ ' : ''}
                    {input.label}
                  </span>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-jf-muted">
              Ticks start fresh when this page opens, so the input that got you here is not counted, and they clear
              when the pad disconnects. Unused slots (right stick, L3/R3, Back, Guide, LT/RT) are not listed — the app
              does not read them.
            </p>
          </div>

          <div className="rounded-lg border border-white/8 bg-black/25 p-3 text-[11px] leading-relaxed text-jf-muted">
            <p>
              <span className="font-semibold text-white/75">Thresholds — </span>
              stick engages past <span className="font-mono text-white/75">±{STICK_ENGAGE.toFixed(2)}</span>,
              releases below <span className="font-mono text-white/75">±{STICK_RELEASE.toFixed(2)}</span> (white
              ticks on each bar), and a pad claims the pin past{' '}
              <span className="font-mono text-white/75">±{PAD_ACTIVITY_DEADZONE.toFixed(2)}</span>. Bar turns red
              while engaged.
            </p>
            {diag.engaged.length > 0 && (
              <p className="mt-1">
                <span className="font-semibold text-white/75">Latched: </span>
                {diag.engaged.join(', ')} — feather the stick between the ticks to confirm it holds instead of
                stuttering.
              </p>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
