import type { ThemeId } from '@shared/types'

export interface ThemePreset {
  id: ThemeId
  name: string
  description: string
  accent: string
  accentText: string
  accentDark: string
  bg: string
  panel: string
  card: string
  muted: string
  glowA: string
  glowB: string
  glowC: string
  cardA: string
  cardB: string
  panelA: string
  panelB: string
  glassA: string
  glassB: string
}

export const THEMES: ThemePreset[] = [
  {
    id: 'crimson',
    name: 'Crimson',
    description: 'The original JOYFRAME stage.',
    accent: '#D71935',
    accentText: '#FF627F',
    accentDark: '#A90F27',
    bg: '#0B0D10',
    panel: '#202329',
    card: '#292D34',
    muted: '#A5A9B2',
    glowA: 'rgba(215, 25, 53, 0.22)',
    glowB: 'rgba(30, 108, 176, 0.16)',
    glowC: 'rgba(120, 32, 160, 0.10)',
    cardA: 'rgba(40, 44, 52, 0.60)',
    cardB: 'rgba(14, 16, 20, 0.74)',
    panelA: 'rgba(30, 34, 40, 0.55)',
    panelB: 'rgba(12, 14, 18, 0.62)',
    glassA: 'rgba(32, 35, 42, 0.55)',
    glassB: 'rgba(10, 12, 16, 0.68)'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Cool blue, late-night arcade.',
    accent: '#2F7DE1',
    accentText: '#8EC5FF',
    accentDark: '#1B4F9E',
    bg: '#070B14',
    panel: '#131C2C',
    card: '#1A2436',
    muted: '#9FB1C9',
    glowA: 'rgba(47, 125, 225, 0.24)',
    glowB: 'rgba(20, 184, 166, 0.13)',
    glowC: 'rgba(99, 102, 241, 0.12)',
    cardA: 'rgba(26, 36, 54, 0.64)',
    cardB: 'rgba(8, 12, 20, 0.80)',
    panelA: 'rgba(19, 28, 44, 0.58)',
    panelB: 'rgba(7, 11, 20, 0.68)',
    glassA: 'rgba(23, 33, 50, 0.58)',
    glassB: 'rgba(6, 10, 18, 0.72)'
  },
  {
    id: 'violet',
    name: 'Violet',
    description: 'Neon purple with a pink afterglow.',
    accent: '#8B5CF6',
    accentText: '#C4B5FD',
    accentDark: '#6D28D9',
    bg: '#0B0813',
    panel: '#1D1630',
    card: '#271D3D',
    muted: '#B9A9CF',
    glowA: 'rgba(139, 92, 246, 0.25)',
    glowB: 'rgba(236, 72, 153, 0.14)',
    glowC: 'rgba(56, 189, 248, 0.10)',
    cardA: 'rgba(39, 29, 61, 0.64)',
    cardB: 'rgba(11, 8, 19, 0.80)',
    panelA: 'rgba(29, 22, 48, 0.58)',
    panelB: 'rgba(10, 7, 18, 0.68)',
    glassA: 'rgba(35, 26, 55, 0.58)',
    glassB: 'rgba(9, 7, 16, 0.72)'
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green with a warm gold edge.',
    accent: '#18A06B',
    accentText: '#6EE7B7',
    accentDark: '#0F7A50',
    bg: '#07100C',
    panel: '#14231B',
    card: '#1B2D23',
    muted: '#A3B8AA',
    glowA: 'rgba(24, 160, 107, 0.24)',
    glowB: 'rgba(202, 138, 4, 0.12)',
    glowC: 'rgba(14, 116, 144, 0.12)',
    cardA: 'rgba(27, 45, 35, 0.64)',
    cardB: 'rgba(7, 16, 12, 0.80)',
    panelA: 'rgba(20, 35, 27, 0.58)',
    panelB: 'rgba(6, 14, 10, 0.68)',
    glassA: 'rgba(25, 41, 32, 0.58)',
    glassB: 'rgba(5, 13, 9, 0.72)'
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Graphite and silver, no colour noise.',
    accent: '#7C8798',
    accentText: '#E2E8F0',
    accentDark: '#4B5563',
    bg: '#08090B',
    panel: '#1A1C20',
    card: '#23262B',
    muted: '#A8ADB5',
    glowA: 'rgba(255, 255, 255, 0.08)',
    glowB: 'rgba(148, 163, 184, 0.10)',
    glowC: 'rgba(255, 255, 255, 0.04)',
    cardA: 'rgba(35, 38, 43, 0.64)',
    cardB: 'rgba(8, 9, 11, 0.82)',
    panelA: 'rgba(26, 28, 32, 0.58)',
    panelB: 'rgba(8, 9, 11, 0.70)',
    glassA: 'rgba(31, 34, 39, 0.58)',
    glassB: 'rgba(7, 8, 10, 0.74)'
  }
]

export function themeById(id: string | undefined): ThemePreset {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

/**
 * Palettes are plain CSS variables so every Tailwind colour utility follows
 * them. The accent stays separately editable on top of the chosen palette.
 */
export function applyThemePreset(id: string | undefined, accent?: string): void {
  const theme = themeById(id)
  const root = document.documentElement
  root.dataset.jfTheme = theme.id
  const vars: Record<string, string> = {
    '--jf-bg': theme.bg,
    '--jf-glow-a': theme.glowA,
    '--jf-glow-b': theme.glowB,
    '--jf-glow-c': theme.glowC,
    '--jf-card-a': theme.cardA,
    '--jf-card-b': theme.cardB,
    '--jf-panel-a': theme.panelA,
    '--jf-panel-b': theme.panelB,
    '--jf-glass-a': theme.glassA,
    '--jf-glass-b': theme.glassB,
    '--color-jf-bg': theme.bg,
    '--color-jf-panel': theme.panel,
    '--color-jf-card': theme.card,
    '--color-jf-muted': theme.muted,
    '--color-jf-red': accent || theme.accent,
    '--color-jf-redtext': theme.accentText,
    '--color-jf-reddark': theme.accentDark
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
}
