import { useCallback, useEffect } from 'react'
import { introPlaying, skipIntro } from './intro-gate'
import { useStore } from '../state/store'

type Direction = 'up' | 'down' | 'left' | 'right'

let currentFocus: HTMLElement | null = null

/**
 * Remembered column for vertical movement. Consecutive up/down presses reuse
 * this x (TV-style column memory) instead of re-anchoring to each landing
 * item, so walks across rows of different widths run straight. Horizontal
 * moves re-anchor it to the landing item.
 */
let anchorX: number | null = null

/**
 * Center of the last focused item. When the focused element disappears — its
 * view was swapped, or the layer around it closed — navigation resumes here
 * instead of jumping back to the first item on the page.
 */
let focusOrigin: { x: number; y: number } | null = null

/**
 * Open-order stack of modal layers. A layer registers its root element while
 * mounted; the last entry is the topmost layer because layers only ever open
 * on top of each other. DOM order cannot be trusted (portals append at the
 * body end while inline layers sit earlier in the tree regardless of paint
 * order), so back-navigation and focus scope both resolve through here.
 */
const modalStack: HTMLElement[] = []

/**
 * A layer owns focus while it is open: entering hands the highlight to its
 * first navigable item (unless the layer focuses a text field itself, as a
 * form does), and closing returns it to whatever opened the layer.
 */
function layerFocus(el: HTMLElement): () => void {
  const returnTo = currentFocus
  const active = document.activeElement
  if (!(isTextField(active) && el.contains(active))) {
    const items = navItems(el)
    const first = items.find((item) => !item.matches(LAYER_CHROME)) ?? items[0]
    if (first) setNavFocus(first)
  }
  return () => {
    // Focus the remembered element directly: the closing layer is still
    // attached while ref cleanups run, so scoping the search would stay inside
    // the layer that is about to disappear.
    if (returnTo && document.contains(returnTo)) setNavFocus(returnTo)
  }
}

function registerModalLayer(el: HTMLElement): () => void {
  const release = layerFocus(el)
  modalStack.push(el)
  return () => {
    const index = modalStack.lastIndexOf(el)
    if (index >= 0) modalStack.splice(index, 1)
    release()
  }
}

function topModal(): HTMLElement | null {
  while (modalStack.length > 0) {
    const el = modalStack[modalStack.length - 1]
    if (el.isConnected) return el
    modalStack.pop()
  }
  return null
}

/**
 * Attach to a modal layer's root element. Registration follows mount state,
 * so conditionally rendered layers (search, lightbox, closed dialogs) join
 * and leave the stack with no per-layer effect code.
 */
export function useModalLayer(): (el: HTMLElement | null) => void {
  return useCallback((el: HTMLElement | null) => (el ? registerModalLayer(el) : undefined), [])
}

/**
 * The same focus return for a layer that is not a modal — the detail page,
 * which B closes through the app — so the card that opened it is re-focused
 * when it closes.
 */
export function useFocusReturn(): (el: HTMLElement | null) => void {
  return useCallback((el: HTMLElement | null) => (el ? layerFocus(el) : undefined), [])
}

/**
 * Only the topmost layer participates in navigation: an open modal wins over
 * the game detail page, which wins over Console Mode, which wins over the app.
 */
function navScope(): ParentNode {
  return (
    topModal() ??
    document.querySelector<HTMLElement>('[data-jf-modal="1"]') ??
    document.querySelector<HTMLElement>('[data-jf-detail="1"]') ??
    document.querySelector<HTMLElement>('[data-jf-console="1"]') ??
    document
  )
}

/** An element the user can actually land on: enabled, laid out and visible. */
function navigable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return false
  const style = window.getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function navItems(root: ParentNode = navScope()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-nav="1"]')).filter(navigable)
}

/** Dismiss controls and page chrome: entry focus starts on content, not these. */
const LAYER_CHROME = '[data-jf-modal-close], [data-jf-layer-skip]'

/** A focused text field owns the keyboard: layer entry and B leave it alone. */
const isTextField = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

const isSelect = (el: Element | null): el is HTMLSelectElement => el instanceof HTMLSelectElement

/** Controls that own the keyboard while focused, so navigation must stand down. */
const ownsKeyboard = (el: Element | null): el is HTMLElement => isTextField(el) || isSelect(el)

/**
 * A d-pad has no way to open a native select popup (a synthetic click will not
 * do it), so left/right step the value directly. Dispatching `change` keeps
 * the app's own onChange/commit path in charge of saving it.
 */
function stepOption(select: HTMLSelectElement, delta: number): void {
  const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + delta))
  if (next === select.selectedIndex) return
  select.selectedIndex = next
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

export function setNavFocus(el: HTMLElement | null, instant = false): void {
  // A data attribute, not a class: React owns className and drops anything it
  // did not render on the next re-render, which silently erased the highlight
  // (and left navigation with a live but unmarked origin). React leaves
  // attributes it does not render alone.
  if (currentFocus && currentFocus !== el) currentFocus.removeAttribute('data-nav-focus')
  currentFocus = el
  if (el) {
    el.setAttribute('data-nav-focus', '')
    const rect = el.getBoundingClientRect()
    focusOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    // Smooth scrolling outlasts the 170ms repeat rate, which would let the
    // highlight trail off-screen mid-hold, so repeats jump instead.
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: instant ? 'auto' : 'smooth' })
  }
}

/**
 * Focus the item nearest the last focused position, or the first item before
 * anything has been focused. Latches the column so later vertical moves run
 * straight from wherever focus resumed.
 */
function restoreFocus(): void {
  const items = navItems()
  if (!items.length) return
  let target = items[0]
  if (focusOrigin) {
    let best = Number.POSITIVE_INFINITY
    for (const el of items) {
      const rect = el.getBoundingClientRect()
      const dx = rect.left + rect.width / 2 - focusOrigin.x
      const dy = rect.top + rect.height / 2 - focusOrigin.y
      const distance = dx * dx + dy * dy
      if (distance < best) {
        best = distance
        target = el
      }
    }
  }
  setNavFocus(target)
  const rect = target.getBoundingClientRect()
  anchorX = rect.left + rect.width / 2
}

function moveFocus(direction: Direction, instant = false): void {
  const items = navItems()
  if (!items.length) return
  if (!currentFocus || !document.contains(currentFocus)) {
    restoreFocus()
    return
  }
  // Horizontal is free on a dropdown, so it steps the value; vertical keeps
  // moving between controls rather than trapping the highlight inside one.
  if (isSelect(currentFocus) && (direction === 'left' || direction === 'right')) {
    stepOption(currentFocus, direction === 'right' ? 1 : -1)
    return
  }
  const origin = currentFocus.getBoundingClientRect()
  const originCenter = { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 }
  const horizontal = direction === 'left' || direction === 'right'
  // The first vertical step latches the column; later vertical steps reuse
  // it instead of drifting toward each landing item. Horizontal steps use
  // the origin here and re-anchor to the landing item below.
  if (!horizontal && anchorX === null) anchorX = originCenter.x
  const columnX = horizontal ? originCenter.x : (anchorX ?? originCenter.x)
  // Centers are measured once and shared by the search and the wrap below.
  const laid = items
    .filter((item) => item !== currentFocus)
    .map((item) => {
      const rect = item.getBoundingClientRect()
      return {
        el: item,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        // Whether the control's box covers the column we are moving down.
        // Vertical moves use this instead of the center offset: a control
        // spanning the column (a full-width dropdown or field) is the only
        // sensible landing spot at that x, and charging it the offset between
        // its center and the column would walk vertical navigation down one
        // edge of a form and skip everything beside it entirely.
        coversColumn: columnX >= rect.left && columnX <= rect.right
      }
    })
  let best: { el: HTMLElement; score: number } | null = null

  for (const c of laid) {
    const dx = c.x - columnX
    const dy = c.y - originCenter.y
    const primary =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    if (primary < 6) continue
    // Alignment is free only for a control that actually spans the column;
    // anything off to the side still pays for its distance, so a wide element
    // elsewhere on another screen can never pull vertical focus out of its
    // column.
    const cross = horizontal ? dy : c.coversColumn ? 0 : dx
    const score = primary + Math.abs(cross) * 2.4
    if (!best || score < best.score) best = { el: c.el, score }
  }
  if (!best && !horizontal) {
    // Vertical wrap: at the top or bottom edge there is no candidate in
    // the pressed direction, so continue around to the far edge instead
    // of leaving focus stuck. Lands nearest the remembered column.
    const extreme =
      direction === 'down'
        ? Math.min(...laid.map((c) => c.y))
        : Math.max(...laid.map((c) => c.y))
    let target: { el: HTMLElement; x: number; y: number } | null = null
    for (const c of laid) {
      if (Math.abs(c.y - extreme) > 40) continue
      if (!target || Math.abs(c.x - columnX) < Math.abs(target.x - columnX)) target = c
    }
    if (target) best = { el: target.el, score: 0 }
  }
  if (best) {
    setNavFocus(best.el, instant)
    if (horizontal) {
      const rect = best.el.getBoundingClientRect()
      anchorX = rect.left + rect.width / 2
    }
  }
}

/**
 * The activated item keeps the highlight: it stays the origin for the next
 * press and for whatever surface the click opens, so activating never leaves
 * the screen without focus.
 */
function activateFocused(): void {
  if (currentFocus && isSelect(currentFocus)) {
    // A synthetic click cannot open the native list, but real focus lets the
    // keyboard drive it; left/right stepping keeps working either way.
    currentFocus.focus()
    return
  }
  if (currentFocus && document.contains(currentFocus)) currentFocus.click()
  else restoreFocus()
}

/**
 * B / Escape. The topmost modal layer always wins: activate its marked
 * closer instead of navigating back. Individual modals only need the
 * useModalLayer ref plus data-jf-modal-close on their close button — never
 * their own back listener — and layers without a marked closer swallow the
 * press rather than leaking through to the page underneath.
 */
function onBack(): void {
  // A back press over a form control drops the control first: a half-typed
  // name or note is never lost, and a focused dropdown closes before the view
  // changes. Escape has usually blurred it already by the time we get here.
  const active = document.activeElement
  if (ownsKeyboard(active)) {
    active.blur()
    return
  }
  const modal = topModal() ?? document.querySelector<HTMLElement>('[data-jf-modal="1"]')
  const closer = modal?.querySelector<HTMLElement>('[data-jf-modal-close]')
  if (closer && !closer.hasAttribute('disabled') && closer.getAttribute('aria-disabled') !== 'true') {
    closer.click()
    return
  }
  if (modal) return
  window.dispatchEvent(new CustomEvent('jf:back'))
}

function favoriteFocused(): void {
  if (!currentFocus) return
  const gameId = currentFocus.getAttribute('data-game-id')
  if (gameId) void useStore.getState().toggleFavorite(gameId)
}

/**
 * Live gamepad telemetry for the Settings diagnostics page. Updated on every
 * poll of the gamepad loop; read it on a timer (~150ms) — never written —
 * so the rest of the app never re-renders at poll rate.
 */
export const STICK_ENGAGE = 0.6

export const STICK_RELEASE = 0.45

export const PAD_ACTIVITY_DEADZONE = 0.3

export interface PadDiagnosticsButton {
  pressed: boolean
  value: number
}

export interface PadDiagnosticsEntry {
  index: number
  id: string
  mapping: string
  axes: number[]
  buttons: PadDiagnosticsButton[]
}

export interface PadAction {
  /** PAD_INPUTS key of the action that fired, e.g. "dpad-right". */
  key: string
  padIndex: number
  at: number
}

export interface PadDiagnostics {
  pads: PadDiagnosticsEntry[]
  pinnedIndex: number
  engaged: string[]
  updatedAt: number
  lastAction: PadAction | null
  seen: string[]
}

/**
 * Every input the navigation layer consumes, in checklist order. D-pad and
 * stick share the same four actions but are listed apart so a physical pad can
 * be checked switch by switch. Unconsumed slots (right stick, L3/R3, Back,
 * Guide, LT/RT) are deliberately absent.
 */
export const PAD_INPUTS = [
  { key: 'dpad-up', label: 'D-pad up' },
  { key: 'dpad-down', label: 'D-pad down' },
  { key: 'dpad-left', label: 'D-pad left' },
  { key: 'dpad-right', label: 'D-pad right' },
  { key: 'stick-up', label: 'Stick up' },
  { key: 'stick-down', label: 'Stick down' },
  { key: 'stick-left', label: 'Stick left' },
  { key: 'stick-right', label: 'Stick right' },
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'y', label: 'Y' },
  { key: 'lb', label: 'LB' },
  { key: 'rb', label: 'RB' },
  { key: 'start', label: 'Start' }
]

let diagSnapshot: PadDiagnostics = {
  pads: [],
  pinnedIndex: -1,
  engaged: [],
  updatedAt: 0,
  lastAction: null,
  seen: []
}

/** Inputs fired since the pad connected; cleared when it disconnects. */
const seenInputs = new Set<string>()
let lastAction: PadAction | null = null

export function getPadDiagnostics(): PadDiagnostics {
  return diagSnapshot
}

/**
 * Start the checklist over. The diagnostics panel calls this on mount, so the
 * input used to open Settings does not arrive pre-ticked.
 */
export function resetPadChecklist(): void {
  seenInputs.clear()
  lastAction = null
  diagSnapshot = { ...diagSnapshot, lastAction: null, seen: [] }
}

function detectPadKind(id: string): 'xbox' | 'playstation' | 'generic' {
  const value = id.toLowerCase()
  if (/xbox|xinput|045e/.test(value)) return 'xbox'
  if (/dualsense|dualshock|playstation|054c|wireless controller/.test(value)) return 'playstation'
  return 'generic'
}

/**
 * Controller-first navigation. D-pad / left stick moves focus between any
 * element marked data-nav="1"; the geometry-based spatial search works across
 * rows, grids, sidebars and modals without per-screen wiring.
 */
export function useSpatialNavigation(): void {
  useEffect(() => {
    const REPEAT_DELAY = 400
    const REPEAT_RATE = 170
    const REPEAT_SLOW = 300
    const pressed = new Map<string, boolean>()
    const repeatAt = new Map<string, number>()
    const stickEngaged = new Map<string, boolean>()
    const lastActive = new Map<number, number>()
    /** Pads whose current state has already been taken as the starting point. */
    const primedPads = new Set<number>()
    let pollTimer = 0
    /** True until a pad press is seen; lets the first fresh press drop a field. */
    let padWasIdle = true

    const handleKeyDown = (event: KeyboardEvent): void => {
      // The startup intro takes the first key press and does nothing else with
      // it, so skipping never also activates whatever is focused behind it.
      if (introPlaying()) {
        skipIntro()
        return
      }
      const target = event.target as HTMLElement | null
      const typing = isTextField(target)
      // A focused dropdown owns its keys like a text field does: arrows change
      // the selection and Enter commits it. Without this the spatial-nav
      // handler swallowed every arrow, so selects could not be used by touch
      // typists, pads or anyone without a mouse.
      const dropdown = isSelect(target)

      if (event.key === 'Escape') {
        if (typing || dropdown) target.blur()
        if (dropdown) return
        onBack()
        return
      }
      if (dropdown) return
      if (event.key === 'Enter' && typing) return
      if (typing && !event.key.startsWith('Escape')) return

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          moveFocus('up', event.repeat)
          break
        case 'ArrowDown':
          event.preventDefault()
          moveFocus('down', event.repeat)
          break
        case 'ArrowLeft':
          event.preventDefault()
          moveFocus('left', event.repeat)
          break
        case 'ArrowRight':
          event.preventDefault()
          moveFocus('right', event.repeat)
          break
        case 'Enter':
        case ' ':
          if (!typing) {
            event.preventDefault()
            activateFocused()
          }
          break
        case '/': {
          const search = document.querySelector<HTMLInputElement>('[data-search-input]')
          if (search) {
            event.preventDefault()
            search.focus()
          }
          break
        }
        case 'f':
        case 'F':
          if (!typing && !event.ctrlKey && !event.metaKey) favoriteFocused()
          break
        default:
          break
      }
    }

    const pollPad = (): void => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : []
      const connected = Array.from(pads).filter((entry): entry is Gamepad => Boolean(entry && entry.connected))
      const padLive = (entry: Gamepad): boolean =>
        entry.buttons.some((button) => button.pressed) || entry.axes.some((axis) => Math.abs(axis) > PAD_ACTIVITY_DEADZONE)

      // Any controller input dismisses the intro. Latching is reset instead of
      // processed, and the next poll primes whatever is still held, so the same
      // press cannot also navigate once the overlay is gone.
      if (introPlaying()) {
        if (connected.some(padLive)) skipIntro()
        pressed.clear()
        repeatAt.clear()
        stickEngaged.clear()
        primedPads.clear()
        return
      }
      // A pad cannot type or open a native select list, so a focused field
      // would leave the first press activating whatever sits behind it. Drop
      // the field and consume that press instead.
      const live = connected.some(padLive)
      const editing = document.activeElement
      if (ownsKeyboard(editing) && live && padWasIdle) {
        editing.blur()
        pressed.clear()
        repeatAt.clear()
        stickEngaged.clear()
        primedPads.clear()
        padWasIdle = false
        return
      }
      padWasIdle = !live
      // Pin to the most recently active pad: any pad showing live input
      // (pressed button or deflected stick) claims the pin, so an idle
      // phantom slot — Steam/virtual pads reporting all zeros — can never
      // steal input from the physical controller. Falls back to the first
      // connected pad until any input arrives.
      // A pad can appear with buttons already down: Steam's virtual pad, a
      // controller resting on Start, or a stale report after a reconnect. That
      // is not a press. Record whatever is already held the first time each pad
      // is seen, so discovering a pad can never activate anything — without
      // this, holding Start at launch silently entered Console Mode. New pads
      // are primed here rather than on pin, so their first real press still
      // registers once they take over navigation.
      for (const entry of connected) {
        if (primedPads.has(entry.index)) continue
        primedPads.add(entry.index)
        const down = (index: number): boolean => Boolean(entry.buttons[index]?.pressed)
        for (const [key, index] of [
          ['up', 12],
          ['down', 13],
          ['left', 14],
          ['right', 15],
          ['a', 0],
          ['b', 1],
          ['y', 3],
          ['lb', 4],
          ['rb', 5],
          ['start', 9]
        ] as const) {
          if (down(index)) pressed.set(key, true)
        }
        const seedAxis = (key: string, value: number): void => {
          if (value >= STICK_ENGAGE) {
            pressed.set(key, true)
            stickEngaged.set(key, true)
            repeatAt.set(key, performance.now() + REPEAT_DELAY)
          }
        }
        seedAxis('up', -(entry.axes[1] ?? 0))
        seedAxis('down', entry.axes[1] ?? 0)
        seedAxis('left', -(entry.axes[0] ?? 0))
        seedAxis('right', entry.axes[0] ?? 0)
      }
      const nowActive = performance.now()
      for (const entry of connected) {
        const live =
          entry.buttons.some((b) => b.pressed) || entry.axes.some((a) => Math.abs(a) > PAD_ACTIVITY_DEADZONE)
        if (live) lastActive.set(entry.index, nowActive)
      }
      for (const index of lastActive.keys()) {
        if (!connected.some((entry) => entry.index === index)) lastActive.delete(index)
      }
      let bestIndex = -1
      let bestTime = -1
      for (const [index, time] of lastActive) {
        if (time > bestTime) {
          bestTime = time
          bestIndex = index
        }
      }
      const pad = (bestIndex >= 0 ? connected.find((entry) => entry.index === bestIndex) : undefined) ?? connected[0]
      const store = useStore.getState()
      if (!pad) {
        if (store.controller.connected) {
          store.setController(false)
          store.notify('Controller disconnected — keyboard navigation still works.', 'info')
        }
        // A disconnected pad cannot hold anything down: drop latched input
        // so a reconnect starts from a clean rising edge, and clear the
        // checklist so the next pad starts a fresh verification pass.
        pressed.clear()
        repeatAt.clear()
        stickEngaged.clear()
        primedPads.clear()
        seenInputs.clear()
        lastAction = null
        diagSnapshot = {
          pads: [],
          pinnedIndex: -1,
          engaged: [],
          updatedAt: performance.now(),
          lastAction: null,
          seen: []
        }
        return
      }
      const kind = detectPadKind(pad.id)
      if (!store.controller.connected || store.controller.name !== pad.id) {
        store.setController(true, pad.id, kind)
        store.notify(`Controller connected — ${pad.id}`, 'info')
      }

      const button = (index: number): boolean => Boolean(pad.buttons[index]?.pressed)
      const record = (key: string): void => {
        seenInputs.add(key)
        lastAction = { key, padIndex: pad.index, at: performance.now() }
      }
      const trigger = (key: string, down: boolean, action: () => void): void => {
        if (down && !pressed.get(key)) {
          // Checked on every rising edge, not just the first poll of activity:
          // a control can gain focus while a stick is already held, and the
          // highlight behind it must never fire instead.
          const focused = document.activeElement
          if (ownsKeyboard(focused)) {
            focused.blur()
            pressed.clear()
            repeatAt.clear()
            stickEngaged.clear()
            primedPads.clear()
            pressed.set(key, true)
            return
          }
          record(key)
          action()
        }
        pressed.set(key, down)
      }
      // Held directions auto-repeat like a held keyboard arrow: the rising
      // edge fires immediately (single presses stay exact), then repeats
      // begin after REPEAT_DELAY. The stick scales its rate with deflection:
      // feathered near the threshold steps slowly, slammed full-tilt repeats
      // at REPEAT_RATE — the same rate the digital d-pad always uses, so
      // dpad feel is unchanged. Buttons keep edge-only triggering.
      const repeat = (
        key: string,
        magnitude: number,
        source: 'dpad' | 'stick',
        action: (instant: boolean) => void
      ): void => {
        const now = performance.now()
        const fire = (instant: boolean): void => {
          record(`${source}-${key}`)
          action(instant)
        }
        if (magnitude <= 0) {
          pressed.set(key, false)
          repeatAt.delete(key)
          return
        }
        if (!pressed.get(key)) {
          fire(false)
          pressed.set(key, true)
          repeatAt.set(key, now + REPEAT_DELAY)
          return
        }
        if (now >= (repeatAt.get(key) ?? Number.POSITIVE_INFINITY)) {
          fire(true)
          const tilt = Math.min(1, Math.max(0, (magnitude - STICK_ENGAGE) / (1 - STICK_ENGAGE)))
          repeatAt.set(key, now + REPEAT_SLOW - (REPEAT_SLOW - REPEAT_RATE) * tilt)
        }
      }

      const axisX = pad.axes[0] ?? 0
      const axisY = pad.axes[1] ?? 0
      // Hysteresis: a direction engages past STICK_ENGAGE and stays live until
      // the stick falls back to STICK_RELEASE, so hovering near the line steps
      // smoothly instead of stuttering on repeated rising edges.
      const stick = (key: string, negative: boolean, axis: number, held: boolean): number => {
        if (held) return 1
        const value = negative ? -axis : axis
        if (stickEngaged.get(key)) {
          if (value <= STICK_RELEASE) {
            stickEngaged.set(key, false)
            return 0
          }
          return value
        }
        if (value > STICK_ENGAGE) {
          stickEngaged.set(key, true)
          return value
        }
        return 0
      }
      const source = (held: boolean): 'dpad' | 'stick' => (held ? 'dpad' : 'stick')
      repeat('up', stick('up', true, axisY, button(12)), source(button(12)), (instant) => moveFocus('up', instant))
      repeat('down', stick('down', false, axisY, button(13)), source(button(13)), (instant) =>
        moveFocus('down', instant)
      )
      repeat('left', stick('left', true, axisX, button(14)), source(button(14)), (instant) =>
        moveFocus('left', instant)
      )
      repeat('right', stick('right', false, axisX, button(15)), source(button(15)), (instant) =>
        moveFocus('right', instant)
      )
      trigger('a', button(0), () => activateFocused())
      trigger('b', button(1), () => onBack())
      trigger('y', button(3), () => favoriteFocused())
      trigger('lb', button(4), () => window.dispatchEvent(new CustomEvent('jf:prev-view')))
      trigger('rb', button(5), () => window.dispatchEvent(new CustomEvent('jf:next-view')))
      trigger('start', button(9), () => window.dispatchEvent(new CustomEvent('jf:toggle-console')))
      diagSnapshot = {
        pads: connected.map((entry) => ({
          index: entry.index,
          id: entry.id,
          mapping: entry.mapping,
          axes: [...entry.axes],
          buttons: entry.buttons.map((b) => ({ pressed: b.pressed, value: b.value }))
        })),
        pinnedIndex: pad.index,
        engaged: [...stickEngaged].filter(([, live]) => live).map(([key]) => key),
        updatedAt: performance.now(),
        lastAction,
        seen: [...seenInputs]
      }
    }

    // A control can vanish while the layer it opened is closing — hiding a game
    // removes its card just after the detail closes — so a detached highlight
    // is re-resolved at once instead of waiting for the next press.
    const focusWatch = new MutationObserver(() => {
      if (currentFocus && !document.contains(currentFocus)) restoreFocus()
    })
    focusWatch.observe(document.body, { childList: true, subtree: true })

    window.addEventListener('keydown', handleKeyDown)
    pollTimer = window.setInterval(pollPad, 90)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearInterval(pollTimer)
      focusWatch.disconnect()
    }
  }, [])
}
