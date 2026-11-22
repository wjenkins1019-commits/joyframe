/**
 * Preferred ROM format order per platform, most-wanted first. These are the
 * defaults: a user override in settings (`romFormatPreferences`) replaces the
 * list wholesale for that platform, and platforms without an entry fall back to
 * the extension order declared in the platform catalogue.
 */
export const DEFAULT_ROM_FORMAT_ORDER: Record<string, string[]> = {
  switch: ['xci', 'nsp', 'nsz'],
  gamecube: ['rvz', 'gcz', 'iso', 'gcm'],
  wii: ['rvz', 'wbfs', 'iso'],
  wiiu: ['wux', 'wud', 'rpx'],
  ps1: ['m3u', 'cue', 'ccd', 'chd', 'pbp', 'bin'],
  ps2: ['chd', 'iso'],
  psp: ['cso', 'iso', 'pbp'],
  dreamcast: ['gdi', 'cdi', 'dat'],
  saturn: ['cue', 'chd'],
  segacd: ['cue', 'chd'],
  arcade: ['zip', '7z', 'chd']
}

/** Effective default order for a platform, given its catalogue extensions. */
export function defaultRomOrder(platformId: string, extensions: string[]): string[] {
  const preset = DEFAULT_ROM_FORMAT_ORDER[platformId]
  return preset ? [...preset] : [...extensions]
}
