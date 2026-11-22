export function formatPlaytime(seconds: number): string {
  if (!seconds || seconds < 60) return seconds > 0 ? '< 1m' : '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours >= 100) return `${hours}h`
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function relativeTime(iso: string): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

/** Ratings are stored on a 0-100 scale (providers and the editor agree); UI
 *  badges show them on a familiar 5-star scale. */
export function starsFor(rating: number | null): string | null {
  if (rating === null || rating <= 0) return null
  const stars = rating > 5 ? rating / 20 : rating
  return Number.isInteger(stars) ? String(stars) : stars.toFixed(1)
}

export function initials(title: string): string {
  const cleaned = title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (!words.length) return 'JF'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

const GRADIENTS = [
  'linear-gradient(140deg,#8a1025 0%,#2a1a22 55%,#15171b 100%)',
  'linear-gradient(140deg,#12324a 0%,#1d2630 55%,#15171b 100%)',
  'linear-gradient(140deg,#3d2a10 0%,#292017 55%,#15171b 100%)',
  'linear-gradient(140deg,#2c1a44 0%,#221b2c 55%,#15171b 100%)',
  'linear-gradient(140deg,#103c34 0%,#172622 55%,#15171b 100%)',
  'linear-gradient(140deg,#4a1220 0%,#2c1a1f 55%,#181a1f 100%)'
]

export function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  return GRADIENTS[hash % GRADIENTS.length]
}

export function fileUrl(path: string): string {
  if (!path) return ''
  return `file://${path.replace(/\\/g, '/')}`
}

export function percent(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

export function shortPlatform(platformId: string): string {
  const map: Record<string, string> = {
    windows: 'PC',
    dos: 'DOS',
    n64: 'N64',
    gamecube: 'GameCube',
    wii: 'Wii',
    wiiu: 'Wii U',
    switch: 'Switch',
    gb: 'GB',
    gbc: 'GBC',
    gba: 'GBA',
    nds: 'DS',
    n3ds: '3DS',
    ps1: 'PS1',
    ps2: 'PS2',
    ps3: 'PS3',
    psp: 'PSP',
    vita: 'Vita',
    xbox: 'Xbox',
    xbox360: 'X360',
    mastersystem: 'SMS',
    genesis: 'Genesis',
    segacd: 'Sega CD',
    saturn: 'Saturn',
    dreamcast: 'Dreamcast',
    gamegear: 'Game Gear',
    atari2600: '2600',
    atari7800: '7800',
    atarijaguar: 'Jaguar',
    turbografx16: 'TG-16',
    neogeo: 'Neo Geo',
    arcade: 'Arcade',
    commodore64: 'C64',
    nes: 'NES',
    snes: 'SNES'
  }
  return map[platformId] ?? platformId.toUpperCase()
}

export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase())
}
