/**
 * Per-emulator fullscreen launch presets.
 *
 * Only flags confirmed from an emulator's own documentation, manual page or
 * source are listed — an emulator missing from this table simply never gets
 * fullscreen arguments added, so a launch still works exactly as before
 * rather than starting an emulator that rejects an unknown switch.
 *
 * A preset's `args` are prepended to the resolved launch arguments. Anything
 * that must accompany the flag (RPCS3 refuses `--fullscreen` without
 * `--no-gui`) is baked into the same preset.
 */

export interface FullscreenPreset {
  /** Arguments added ahead of the ROM to start in fullscreen. */
  args: string[]
  /** Short human description shown beside the toggle. */
  note: string
}

const PRESETS: Record<string, FullscreenPreset> = {
  // One flag, nothing else required.
  'retroarch.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'ppssppwindows64.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'ppssppwindows.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'ppssppqt.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'pcsx2-qt.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'pcsx2.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'duckstation-qt.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'duckstation-qt-x64-releaseltcg.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'duckstation.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'mgba.exe': { args: ['-f'], note: '-f' },
  'snes9x.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'snes9x-x64.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'mesen.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'mesen2.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'desmume.exe': { args: ['--windowed-fullscreen'], note: '--windowed-fullscreen (borderless)' },
  'desmume_x64.exe': { args: ['--windowed-fullscreen'], note: '--windowed-fullscreen (borderless)' },
  'citra-qt.exe': { args: ['-f'], note: '-f' },
  'citra.exe': { args: ['-f'], note: '-f' },
  'eden.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'ryujinx.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'ryujinx.ava.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'cemu.exe': { args: ['-f'], note: '-f' },
  'mame.exe': { args: ['-nowindow'], note: '-nowindow' },
  'mame64.exe': { args: ['-nowindow'], note: '-nowindow' },
  'dosbox-x.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'x64sc.exe': { args: ['-VICIIfull'], note: '-VICIIfull' },
  'x64.exe': { args: ['-VICIIfull'], note: '-VICIIfull' },
  'stella.exe': { args: ['-fullscreen', '1'], note: '-fullscreen 1' },
  'atari800.exe': { args: ['-fullscreen'], note: '-fullscreen' },
  'xemu.exe': { args: ['-full-screen'], note: '-full-screen' },
  'ares.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'emuhawk.exe': { args: ['--fullscreen'], note: '--fullscreen' },
  'mednafen.exe': { args: ['-video.fs', '1'], note: '-video.fs 1' },
  // ---- Flags that need a companion argument ----
  // RPCS3 rejects --fullscreen unless --no-gui is present.
  'rpcs3.exe': { args: ['--no-gui', '--fullscreen'], note: '--no-gui --fullscreen' }
}

/** Preset for an executable path, or null when no verified flag is known. */
export function fullscreenPresetFor(exePath: string): FullscreenPreset | null {
  const exe = exePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return PRESETS[exe] ?? null
}

/**
 * Arguments to prepend for a launch. Empty when the emulator has no verified
 * preset, when the user turned fullscreen off, or when the template already
 * carries the flag (a hand-written `--fullscreen` is never duplicated).
 */
export function fullscreenArgsFor(
  exePath: string,
  enabled: boolean,
  existingArgs: string[] = []
): string[] {
  if (!enabled) return []
  const preset = fullscreenPresetFor(exePath)
  if (!preset) return []
  if (preset.args.some((arg) => existingArgs.includes(arg))) return []
  return [...preset.args]
}

/** One-line summary of the preset for the UI, or '' when unsupported. */
export function fullscreenPresetLabel(exePath: string): string {
  return fullscreenPresetFor(exePath)?.note ?? ''
}
