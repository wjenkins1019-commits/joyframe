import type { Platform } from '../../shared/types.ts'

/**
 * Seed platform catalogue. `extensions` drive ROM scanning, `emulatorHint`
 * narrows automatic emulator association.
 */
export const PLATFORMS: Platform[] = [
  { id: 'windows', name: 'PC (Windows)', shortName: 'PC', family: 'PC', extensions: ['exe'], native: true, sortOrder: 0 },
  { id: 'dos', name: 'DOS', shortName: 'DOS', family: 'PC', extensions: ['dosz', 'conf', 'bat'], native: false, emulatorHint: 'DOSBox', sortOrder: 1 },

  { id: 'nes', name: 'Nintendo Entertainment System', shortName: 'NES', family: 'Nintendo', extensions: ['nes', 'unf', 'fds'], native: false, emulatorHint: 'FCEUX / Mesen / RetroArch', sortOrder: 10 },
  { id: 'snes', name: 'Super Nintendo', shortName: 'SNES', family: 'Nintendo', extensions: ['sfc', 'smc', 'fig', 'swc'], native: false, emulatorHint: 'Snes9x / Mesen / RetroArch', sortOrder: 11 },
  { id: 'n64', name: 'Nintendo 64', shortName: 'N64', family: 'Nintendo', extensions: ['n64', 'z64', 'v64', 'ndd'], native: false, emulatorHint: 'Project64 / ares / RetroArch', sortOrder: 12 },
  { id: 'gamecube', name: 'Nintendo GameCube', shortName: 'GameCube', family: 'Nintendo', extensions: ['gcm', 'rvz', 'gcz', 'dol'], native: false, emulatorHint: 'Dolphin', sortOrder: 13 },
  { id: 'wii', name: 'Nintendo Wii', shortName: 'Wii', family: 'Nintendo', extensions: ['wbfs', 'rvz', 'wad'], native: false, emulatorHint: 'Dolphin', sortOrder: 14 },
  { id: 'wiiu', name: 'Nintendo Wii U', shortName: 'Wii U', family: 'Nintendo', extensions: ['wud', 'wux', 'rpx'], native: false, emulatorHint: 'Cemu', sortOrder: 15 },
  { id: 'switch', name: 'Nintendo Switch', shortName: 'Switch', family: 'Nintendo', extensions: ['nsp', 'nsz', 'xci'], native: false, emulatorHint: 'Ryujinx', sortOrder: 16 },
  { id: 'gb', name: 'Game Boy', shortName: 'GB', family: 'Nintendo', extensions: ['gb'], native: false, emulatorHint: 'mGBA / RetroArch', sortOrder: 17 },
  { id: 'gbc', name: 'Game Boy Color', shortName: 'GBC', family: 'Nintendo', extensions: ['gbc'], native: false, emulatorHint: 'mGBA / RetroArch', sortOrder: 18 },
  { id: 'gba', name: 'Game Boy Advance', shortName: 'GBA', family: 'Nintendo', extensions: ['gba', 'agb'], native: false, emulatorHint: 'mGBA / RetroArch', sortOrder: 19 },
  { id: 'nds', name: 'Nintendo DS', shortName: 'NDS', family: 'Nintendo', extensions: ['nds', 'dsi'], native: false, emulatorHint: 'melonDS / DeSmuME', sortOrder: 20 },
  { id: 'n3ds', name: 'Nintendo 3DS', shortName: '3DS', family: 'Nintendo', extensions: ['3ds', 'cci', 'cia'], native: false, emulatorHint: 'Citra / Lime3DS', sortOrder: 21 },

  { id: 'ps1', name: 'PlayStation', shortName: 'PS1', family: 'Sony', extensions: ['pbp', 'ccd', 'm3u'], native: false, emulatorHint: 'DuckStation / RetroArch', sortOrder: 30 },
  { id: 'ps2', name: 'PlayStation 2', shortName: 'PS2', family: 'Sony', extensions: ['iso', 'chd', 'gz'], native: false, emulatorHint: 'PCSX2', sortOrder: 31 },
  { id: 'ps3', name: 'PlayStation 3', shortName: 'PS3', family: 'Sony', extensions: ['pkg', 'dec'], native: false, emulatorHint: 'RPCS3', sortOrder: 32 },
  { id: 'psp', name: 'PlayStation Portable', shortName: 'PSP', family: 'Sony', extensions: ['cso', 'pbp', 'iso'], native: false, emulatorHint: 'PPSSPP', sortOrder: 33 },
  { id: 'vita', name: 'PlayStation Vita', shortName: 'Vita', family: 'Sony', extensions: ['vpk'], native: false, emulatorHint: 'Vita3K', sortOrder: 34 },

  { id: 'xbox', name: 'Xbox', shortName: 'Xbox', family: 'Microsoft', extensions: ['xiso'], native: false, emulatorHint: 'xemu', sortOrder: 40 },
  { id: 'xbox360', name: 'Xbox 360', shortName: 'X360', family: 'Microsoft', extensions: ['xex', 'iso'], native: false, emulatorHint: 'Xenia', sortOrder: 41 },

  { id: 'mastersystem', name: 'Sega Master System', shortName: 'SMS', family: 'Sega', extensions: ['sms'], native: false, emulatorHint: 'Kega Fusion / RetroArch', sortOrder: 50 },
  { id: 'genesis', name: 'Sega Genesis / Mega Drive', shortName: 'Genesis', family: 'Sega', extensions: ['md', 'gen', 'smd', '32x'], native: false, emulatorHint: 'Kega Fusion / RetroArch', sortOrder: 51 },
  { id: 'segacd', name: 'Sega CD', shortName: 'Sega CD', family: 'Sega', extensions: [], native: false, emulatorHint: 'Kega Fusion', sortOrder: 52 },
  { id: 'saturn', name: 'Sega Saturn', shortName: 'Saturn', family: 'Sega', extensions: [], native: false, emulatorHint: 'RetroArch (Beetle Saturn)', sortOrder: 53 },
  { id: 'dreamcast', name: 'Sega Dreamcast', shortName: 'Dreamcast', family: 'Sega', extensions: ['gdi', 'cdi', 'dat'], native: false, emulatorHint: 'Flycast / redream', sortOrder: 54 },
  { id: 'gamegear', name: 'Sega Game Gear', shortName: 'Game Gear', family: 'Sega', extensions: ['gg'], native: false, emulatorHint: 'Kega Fusion / RetroArch', sortOrder: 55 },

  { id: 'atari2600', name: 'Atari 2600', shortName: 'Atari 2600', family: 'Atari', extensions: ['a26'], native: false, emulatorHint: 'Stella', sortOrder: 60 },
  { id: 'atari7800', name: 'Atari 7800', shortName: 'Atari 7800', family: 'Atari', extensions: ['a78'], native: false, emulatorHint: 'RetroArch / ares', sortOrder: 61 },
  { id: 'atarijaguar', name: 'Atari Jaguar', shortName: 'Jaguar', family: 'Atari', extensions: ['j64', 'jag', 'rom'], native: false, emulatorHint: 'BigPEmu', sortOrder: 62 },

  { id: 'turbografx16', name: 'TurboGrafx-16 / PC Engine', shortName: 'TG-16', family: 'Other', extensions: ['pce', 'sgx'], native: false, emulatorHint: 'RetroArch (Beetle PCE)', sortOrder: 70 },
  { id: 'neogeo', name: 'Neo Geo', shortName: 'Neo Geo', family: 'Arcade', extensions: [], native: false, emulatorHint: 'MAME / RetroArch (FBNeo)', sortOrder: 71 },
  { id: 'arcade', name: 'Arcade (MAME)', shortName: 'Arcade', family: 'Arcade', extensions: ['zip', '7z', 'chd'], native: false, emulatorHint: 'MAME / RetroArch (MAME)', sortOrder: 72 },
  { id: 'commodore64', name: 'Commodore 64', shortName: 'C64', family: 'Other', extensions: ['d64', 't64', 'crt', 'prg', 'tap'], native: false, emulatorHint: 'VICE', sortOrder: 73 }
]

/** Extensions that can belong to more than one platform; resolved by path hints. */
export const AMBIGUOUS_EXTENSIONS = new Set(['iso', 'chd', 'bin', 'cue', 'img', 'rom', 'zip', '7z', 'cue'])

const HINT_MAP: { pattern: RegExp; platformId: string }[] = [
  { pattern: /playstation\s*2|\bps2\b|pcsx2/i, platformId: 'ps2' },
  { pattern: /playstation\s*3|\bps3\b|rpcs3/i, platformId: 'ps3' },
  { pattern: /playstation\s*portable|\bpsp\b|ppsspp/i, platformId: 'psp' },
  { pattern: /playstation(?!\s*[23])|\bps1\b|\bpsx\b/i, platformId: 'ps1' },
  { pattern: /gamecube|game\s*cube|\bgc\b|dolphin/i, platformId: 'gamecube' },
  { pattern: /\bwii\s*u\b|cemu/i, platformId: 'wiiu' },
  { pattern: /\bwii\b/i, platformId: 'wii' },
  { pattern: /switch|yuzu|ryujinx|eden/i, platformId: 'switch' },
  { pattern: /dreamcast|flycast|redream/i, platformId: 'dreamcast' },
  { pattern: /saturn/i, platformId: 'saturn' },
  { pattern: /sega\s*cd|megacd/i, platformId: 'segacd' },
  { pattern: /xbox\s*360|xenia/i, platformId: 'xbox360' },
  { pattern: /xbox|xemu/i, platformId: 'xbox' },
  { pattern: /mame|arcade|fbneo|neogeo/i, platformId: 'arcade' },
  { pattern: /genesis|mega\s*drive|megadrive/i, platformId: 'genesis' },
  { pattern: /nintendo\s*3ds|\b3ds\b|citra/i, platformId: 'n3ds' },
  { pattern: /nintendo\s*ds|\bnds\b|desmume|melonds/i, platformId: 'nds' },
  { pattern: /nintendo\s*64|\bn64\b/i, platformId: 'n64' },
  { pattern: /super\s*nintendo|\bsnes\b/i, platformId: 'snes' },
  { pattern: /\bnes\b|famicom/i, platformId: 'nes' },
  { pattern: /game\s*boy\s*advance|\bgba\b/i, platformId: 'gba' },
  { pattern: /game\s*boy/i, platformId: 'gb' },
  { pattern: /atari\s*2600/i, platformId: 'atari2600' },
  { pattern: /atari\s*7800/i, platformId: 'atari7800' },
  { pattern: /atari\s*jaguar/i, platformId: 'atarijaguar' },
  { pattern: /turbografx|pc\s*engine/i, platformId: 'turbografx16' },
  { pattern: /commodore\s*64|\bc64\b/i, platformId: 'commodore64' }
]

export function platformById(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id)
}

/** Best-effort platform detection from a file path (folder names help for .iso/.chd). */
export function detectPlatform(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const haystack = filePath.replace(/\\/g, '/')

  const hinted = HINT_MAP.find((h) => h.pattern.test(haystack))
  if (hinted && (AMBIGUOUS_EXTENSIONS.has(ext) || !platformById(hinted.platformId)?.extensions.includes(ext))) {
    if (AMBIGUOUS_EXTENSIONS.has(ext) || hinted.platformId) return hinted.platformId
  }

  const matches = PLATFORMS.filter((p) => p.extensions.includes(ext) && p.id !== 'windows')
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    if (hinted) return hinted.platformId
    return matches[0].id
  }
  return hinted?.platformId ?? null
}

export function seededPlatforms(): Platform[] {
  return PLATFORMS.map((p) => ({ ...p }))
}
