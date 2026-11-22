import { useEffect, useState } from 'react'
import type { Game } from '@shared/types'
import { gradientFor, initials } from '../lib/format'
import { cx } from './ui'

interface SmartImageProps {
  src?: string
  alt: string
  className?: string
  fallbackSeed?: string
  showInitials?: boolean
  eager?: boolean
}

/** Image with a branded gradient fallback when artwork is missing or offline. */
export function SmartImage({
  src,
  alt,
  className,
  fallbackSeed,
  showInitials = true,
  eager
}: SmartImageProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return (
      <div
        className={cx('flex items-center justify-center overflow-hidden', className)}
        style={{ background: gradientFor(fallbackSeed || alt) }}
        aria-label={alt}
      >
        {showInitials && (
          <span className="select-none text-2xl font-black tracking-tight text-white/25">{initials(alt)}</span>
        )}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      draggable={false}
      onError={() => setFailed(true)}
      className={cx('object-cover', className)}
    />
  )
}

export function Cover({
  game,
  className,
  showInitials = true
}: {
  game: Game
  className?: string
  showInitials?: boolean
}): React.JSX.Element {
  return (
    <SmartImage
      src={game.coverPath}
      alt={game.title}
      className={cx('h-full w-full', className)}
      fallbackSeed={game.title}
      showInitials={showInitials}
    />
  )
}

export function Backdrop({ game, className }: { game: Game; className?: string }): React.JSX.Element {
  return (
    <SmartImage
      src={game.backgroundPath || game.heroUrl}
      alt={`${game.title} backdrop`}
      className={cx('h-full w-full', className)}
      fallbackSeed={game.title}
      showInitials={false}
      eager
    />
  )
}

/** Shown when no logo art is cached: brand-styled title treatment. */
export function GameLogo({
  game,
  size = 'lg'
}: {
  game: Game
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [game.logoPath])
  if (game.logoPath && !failed) {
    return (
      <img
        src={game.logoPath}
        alt={game.title}
        onError={() => setFailed(true)}
        className={size === 'lg' ? 'max-h-28 max-w-[520px] object-contain object-left drop-shadow-2xl' : 'max-h-14 max-w-[280px] object-contain object-left'}
      />
    )
  }
  return (
    <h1
      className={cx(
        'font-black uppercase leading-[0.92] tracking-tight text-shadow-hero',
        size === 'lg' ? 'text-5xl lg:text-6xl' : 'text-2xl'
      )}
    >
      {game.title}
    </h1>
  )
}
