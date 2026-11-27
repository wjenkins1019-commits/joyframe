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
}

const PRESETS: Record<string, FullscreenPreset> = {
  // One flag, nothing else required.
  'retroarch.exe': { args: ['--fullscreen'] },
  'ppssppwindows64.exe': { args: ['--fullscreen'] },
  'ppssppwindows.exe': { args: ['--fullscreen'] },
  'ppssppqt.exe': { args: ['--fullscreen'] },
  'pcsx2-qt.exe': { args: ['-fullscreen'] },
  'pcsx2.exe': { args: ['-fullscreen'] },
  'duckstation-qt.exe': { args: ['-fullscreen'] },
  'duckstation-qt-x64-releaseltcg.exe': { args: ['-fullscreen'] },
  'duckstation.exe': { args: ['-fullscreen'] },
  'mgba.exe': { args: ['-f'] },
  'snes9x.exe': { args: ['-fullscreen'] },
  'snes9x-x64.exe': { args: ['-fullscreen'] },
  'mesen.exe': { args: ['--fullscreen'] },
  'mesen2.exe': { args: ['--fullscreen'] },
  'melonds.exe': { args: ['-f'] },
  'desmume.exe': { args: ['--windowed-fullscreen'] },
  'desmume_x64.exe': { args: ['--windowed-fullscreen'] },
  'citra-qt.exe': { args: ['-f'] },
  'citra.exe': { args: ['-f'] },
  'eden.exe': { args: ['--fullscreen'] },
  'ryujinx.exe': { args: ['--fullscreen'] },
  'ryujinx.ava.exe': { args: ['--fullscreen'] },
  'cemu.exe': { args: ['-f'] },
  'mame.exe': { args: ['-nowindow'] },
  'mame64.exe': { args: ['-nowindow'] },
  'dosbox-x.exe': { args: ['-fullscreen'] },
  'x64sc.exe': { args: ['-VICIIfull'] },
  'x64.exe': { args: ['-VICIIfull'] },
  'stella.exe': { args: ['-fullscreen', '1'] },
  'atari800.exe': { args: ['-fullscreen'] },
  'xemu.exe': { args: ['-full-screen'] },
  'ares.exe': { args: ['--fullscreen'] },
  'emuhawk.exe': { args: ['--fullscreen'] },
  'mednafen.exe': { args: ['-video.fs', '1'] },
  // Kega Fusion takes the filename plus optional switches in any order since
  // v3.4; the extension alone is enough for it to pick the console.
  'fusion.exe': { args: ['-fullscreen'] },
  'fusion64.exe': { args: ['-fullscreen'] },
  // Xenia exposes every config cvar as an option; [GPU] fullscreen is a bare
  // boolean switch there.
  'xenia_canary.exe': { args: ['--fullscreen'] },
  'xenia.exe': { args: ['--fullscreen'] },
  // ---- Flags that need a companion argument ----
  // RPCS3 rejects --fullscreen unless --no-gui is present.
  'rpcs3.exe': { args: ['--no-gui', '--fullscreen'] },
  // Dolphin has no fullscreen switch of its own: -C overrides the config
  // setting (System.Section.Key), so it pairs with the -e <rom> template.
  'dolphin.exe': { args: ['-C', 'Dolphin.Display.Fullscreen=True'] }
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
  existingArgs: string[] = [],
  customArgs: string[] = []
): string[] {
  if (!enabled) return []
  // A user-supplied override replaces the preset; empty means "use the preset".
  const args = customArgs.length ? customArgs : fullscreenPresetFor(exePath)?.args ?? []
  if (!args.length) return []
  // Compare the whole flag sequence token by token, so Dolphin's two-token
  // `-C …=True` is recognised even beside an unrelated `-C`, while a longer
  // flag that merely starts with the preset (`--fullscreen-exclusive`) is not
  // mistaken for it.
  if (containsSequence(existingArgs, args)) return []
  return [...args]
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true
  }
  return false
}
