interface LogoMarkProps {
  size?: number
  className?: string
  rounded?: boolean
}

/** Geometric J emblem with a play triangle — the JOYFRAME application icon. */
export function LogoMark({ size = 40, className = '', rounded = true }: LogoMarkProps): React.JSX.Element {
  const id = rounded ? 'jf-mark-grad' : 'jf-mark-grad-flat'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E52442" />
          <stop offset="55%" stopColor="#D71935" />
          <stop offset="100%" stopColor="#A90F27" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={rounded ? 16 : 0} fill={`url(#${id})`} />
      <rect x="1" y="1" width="62" height="62" rx={rounded ? 15 : 0} fill="none" stroke="#ffffff" strokeOpacity="0.16" />
      <path
        d="M41 13h8.4v26.3c0 8.1-5.3 13.2-13.2 13.2-6.7 0-11.6-3.6-13.2-9.7l7.9-2.2c.9 2.9 2.7 4.5 5.3 4.5 3.4 0 5.6-2.2 5.6-6.2V13z"
        fill="#ffffff"
      />
      <path d="M13 25.5l13.5 8.1L13 41.7V25.5z" fill="#ffffff" opacity="0.96" />
      <path d="M51.9 24.2l6.6 3.9-6.6 3.9v-7.8z" fill="#15171B" opacity="0.35" />
    </svg>
  )
}

interface StudioMarkProps {
  size?: number
  className?: string
}

/**
 * 965 Media studio badge: a compact companion to the JOYFRAME wordmark for
 * the loading screen and About section. Neutral charcoal with a single red
 * rule that ties it to the JOYFRAME accent without copying the J emblem.
 */
export function StudioMark({ size = 40, className = '' }: StudioMarkProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" className={className} aria-hidden="true">
      <rect x="2" y="2" width="68" height="68" rx="18" fill="#22252b" />
      <rect
        x="2"
        y="2"
        width="68"
        height="68"
        rx="18"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.14"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="27"
        fontWeight="900"
        letterSpacing="0.5"
        fill="#ffffff"
      >
        965
      </text>
      <rect x="24" y="46" width="24" height="3" rx="1.5" fill="#D71935" />
      <text
        x="37.5"
        y="60"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.5"
        fontWeight="700"
        letterSpacing="2.6"
        fill="#a5a9b2"
      >
        MEDIA
      </text>
    </svg>
  )
}

interface WordmarkProps {
  size?: number
  tagline?: boolean
  className?: string
}

export function Wordmark({ size = 26, tagline = false, className = '' }: WordmarkProps): React.JSX.Element {
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span
        className="font-black tracking-[0.18em] text-white"
        style={{ fontSize: size, fontFamily: 'inherit' }}
      >
        JOY<span className="text-jf-red">FRAME</span>
      </span>
      {tagline && (
        <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.32em] text-jf-muted">
          Every Game. One Universe.
        </span>
      )}
    </div>
  )
}
