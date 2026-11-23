/**
 * The startup intro owns the first input. Navigation asks this module whether
 * the intro is still up: if it is, the input dismisses the intro and is
 * swallowed instead of also opening a game, changing views or entering
 * Console Mode underneath the overlay.
 */

let playing = false
const skippers = new Set<() => void>()

export function introPlaying(): boolean {
  return playing
}

/** Called while the intro is visible; the returned function releases it. */
export function registerIntroSkip(skip: () => void): () => void {
  playing = true
  skippers.add(skip)
  return () => {
    skippers.delete(skip)
    if (skippers.size === 0) playing = false
  }
}

export function skipIntro(): void {
  for (const skip of [...skippers]) skip()
}
