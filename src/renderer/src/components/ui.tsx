import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'
import { useModalLayer } from '../lib/navigation'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  block?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-jf-red text-white hover:bg-[#e8203f] active:bg-jf-reddark shadow-[0_10px_30px_-12px_rgba(215,25,53,0.9)]',
  secondary: 'bg-white/10 text-white hover:bg-white/16 border border-white/10',
  ghost: 'bg-transparent text-jf-muted hover:text-white hover:bg-white/8',
  danger: 'bg-red-600/15 text-red-300 hover:bg-red-600/25 border border-red-500/30',
  outline: 'bg-transparent text-white border border-white/20 hover:border-white/50 hover:bg-white/5'
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      data-nav="1"
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-all duration-150 jf-press disabled:cursor-not-allowed disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
}

export function IconButton({ label, size = 'md', className, children, ...rest }: IconButtonProps): React.JSX.Element {
  return (
    <button
      data-nav="1"
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition hover:bg-black/60 hover:text-white border border-white/10',
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cx(
        'h-10 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white placeholder:text-white/30',
        'focus:border-jf-red/70 focus:bg-black/50 focus:ring-2 focus:ring-jf-red/25 transition',
        className
      )}
      {...rest}
    />
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      className={cx(
        'w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-white/30',
        'focus:border-jf-red/70 focus:bg-black/50 focus:ring-2 focus:ring-jf-red/25 transition resize-y',
        className
      )}
      {...rest}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cx(
        'h-10 w-full rounded-lg border border-white/10 bg-[#1b1e23] px-3 text-sm text-white',
        'focus:border-jf-red/70 focus:ring-2 focus:ring-jf-red/25 transition',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-jf-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-white/35">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-jf-muted">{description}</p>}
      </div>
      <button
        data-nav="1"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40',
          checked ? 'border-jf-red bg-jf-red' : 'border-white/15 bg-white/10'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: ReactNode
  tone?: 'default' | 'red' | 'green' | 'amber' | 'dark'
  className?: string
}): React.JSX.Element {
  const tones = {
    default: 'bg-white/10 text-white/80 border-white/10',
    red: 'bg-jf-red/15 text-[#ff7a8a] border-jf-red/30',
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dark: 'bg-black/50 text-white/70 border-white/10'
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return <Loader2 className={cx('h-4 w-4 spin', className)} />
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16 text-center">
      {icon && <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-jf-red/10 text-jf-red">{icon}</div>}
      <h3 className="text-lg font-bold text-white">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-relaxed text-jf-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.3em] text-jf-redtext">{eyebrow}</p>}
        <h1 className="jf-display text-3xl font-black tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-jf-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: string
}): React.JSX.Element | null {
  const layerRef = useModalLayer()
  if (!open) return null
  return createPortal(
    <div
      ref={layerRef}
      data-jf-modal="1"
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm animate-fade"
    >
      <div
        className={cx(
          'my-8 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#1b1e23] shadow-2xl animate-rise',
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-jf-muted">{subtitle}</p>}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} data-jf-modal-close="1">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-black/20 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmInline({
  question,
  onConfirm,
  onCancel,
  confirmLabel = 'Yes, remove'
}: {
  question: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2">
      <span className="text-xs text-red-200">{question}</span>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

export function Section({
  title,
  description,
  icon,
  children
}: {
  title: string
  description?: string
  icon: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="jf-card rounded-xl p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jf-red/12 text-jf-red">{icon}</div>
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-jf-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function CheckLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs text-jf-muted">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <span>{children}</span>
    </div>
  )
}
