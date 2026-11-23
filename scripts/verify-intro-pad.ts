/**
 * Controller path for app dropdowns.
 *
 * 1. Pad A skips the intro; a fake pad opens Library and steps a filter.
 * 2. Pad-only navigation reaches Settings, lands on the Startup intro
 *    dropdown, and steps it to "Off".
 * 3. The app is restarted: no intro plays, the dropdown still reads Off, and
 *    the database agrees.
 *
 * Run after `npm run build` (it boots `out/` through dev Electron):
 *
 *   npm run verify:intro-pad
 *
 * Uses `.verify-intro/select-pad-profile` and removes it on exit.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createSession, delay, findWindow } from './cdp.mjs'
import { openDatabase } from '../src/main/services/db.ts'
import { getSettings } from '../src/main/services/settings.ts'

const profile = path.resolve('.verify-intro/select-pad-profile')
fs.rmSync(profile, { recursive: true, force: true })
const port = 9272

const FAKE_PAD = `(() => {
  const pad = {
    index: 0,
    id: 'Xbox Wireless Controller (virtual)',
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }))
  }
  window.__pad = pad
  navigator.getGamepads = () => [pad, null, null, null]
  window.__trigger = (index, value) => {
    const button = pad.buttons[index]
    button.value = value
    button.pressed = value > 0.5
    button.touched = value > 0
    pad.timestamp = performance.now()
  }
  window.__axis = (index, value) => {
    pad.axes[index] = value
    pad.timestamp = performance.now()
  }
  window.introSelect = () => [...document.querySelectorAll('select')].find(
    (s) => s.closest('label')?.textContent?.includes('Startup intro')
  )
  return true
})()`

let app: ReturnType<typeof spawn> | null = null
let session: Awaited<ReturnType<typeof createSession>> | null = null

const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> =>
  session!.call(method, params)

const evaluate = (expression: string): Promise<any> => session!.evaluate(expression)

async function launch(): Promise<void> {
  app = spawn(
    'node_modules/electron/dist/electron.exe',
    ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-sandbox'],
    { stdio: 'ignore' }
  )
  const target = await findWindow(port)
  if (!target) throw new Error('no renderer')
  session = await createSession(target)
}

async function shutdown(): Promise<void> {
  try {
    session?.close()
  } catch {
    /* closed */
  }
  session = null
  try {
    if (app?.pid) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* gone */
  }
  app = null
  await delay(1500)
}

const waitFor = async (expression: string, timeout = 10000): Promise<boolean> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return true
    await delay(100)
  }
  return false
}

/** Hold a pad button long enough for the 90ms poll to latch it, then release. */
async function pad(index: number): Promise<void> {
  await evaluate(`window.__trigger(${index}, 1)`)
  await delay(190)
  await evaluate(`window.__trigger(${index}, 0)`)
  await delay(300)
}

async function releaseAll(): Promise<void> {
  await evaluate(`(() => { for (let i = 0; i < 17; i++) window.__trigger(i, 0); window.__axis(0, 0); window.__axis(1, 0) })()`)
  await delay(300)
}

const key = async (name: string, code: string, vk: number): Promise<void> => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk })
  await delay(300)
}

const focused = `(() => {
  const el = document.querySelector('[data-nav-focus]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { tag: el.tagName, label: el.getAttribute('aria-label'), x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`

const phase = () => evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`)

// ---- 1. pad skips the intro and drives the Library filters ----
await launch()
await waitFor(`Boolean(document.querySelector('[data-jf-intro]'))`)
await evaluate(FAKE_PAD)
await pad(0)
if (await phase()) throw new Error('pad A did not skip the intro')

// Sidebar: the first press only restores a highlight, then move to Library.
await pad(13)
await pad(13)
const libraryFocus = await evaluate(focused)
console.log('pad focus after stepping sidebar:', JSON.stringify(libraryFocus?.label))
await pad(0)
const viewAfterA = await evaluate(`document.querySelector('main[data-jf-view]')?.getAttribute('data-jf-view') ?? null`)
console.log('pad A on a sidebar item opened:', viewAfterA)
if (viewAfterA !== 'library') throw new Error('pad A failed to activate a nav item')
if (!(await waitFor(`document.querySelectorAll('select').length > 0`))) throw new Error('Library filters never rendered')

const inventory = await evaluate(`({
  navItems: document.querySelectorAll('[data-nav="1"]').length,
  selects: document.querySelectorAll('select').length,
  navSelects: document.querySelectorAll('select[data-nav="1"]').length
})`)
console.log('Library inventory:', JSON.stringify(inventory))
if (inventory.navSelects === 0) throw new Error('dropdowns are not navigation targets')

for (let step = 0; step < 3; step++) await key('ArrowRight', 'ArrowRight', 39)
let filter: { options: number; label: string } | null = null
const checkSelect = () => evaluate(`(() => {
  const el = document.querySelector('select[data-nav-focus]')
  if (!el || el.options.length < 2) return null
  return { options: el.options.length, label: el.getAttribute('aria-label') ?? el.closest('label')?.textContent?.trim().slice(0, 30) ?? 'filter' }
})()`)
for (let attempt = 0; attempt < 2 && !filter; attempt++) {
  for (let step = 0; step < 40 && !filter; step++) {
    await key('ArrowDown', 'ArrowDown', 40)
    filter = await checkSelect()
  }
}
console.log('highlighted dropdown:', JSON.stringify(filter))
if (!filter) throw new Error('spatial navigation never reached a dropdown')

const before = await evaluate(`document.querySelector('select[data-nav-focus]').value`)
await pad(15)
const afterRight = await evaluate(`document.querySelector('select[data-nav-focus]').value`)
console.log('pad right — value:', JSON.stringify(before), '->', JSON.stringify(afterRight))
if (afterRight === before) throw new Error('d-pad right did not change the dropdown')
await pad(14)
const afterLeft = await evaluate(`document.querySelector('select[data-nav-focus]').value`)
console.log('pad left — value back to:', JSON.stringify(afterLeft))
if (afterLeft !== before) throw new Error('d-pad left did not restore the previous option')

// ---- 2. pad-only walk to Settings and its Startup intro dropdown ----
let sidebar = await evaluate(focused)
for (let step = 0; step < 12 && sidebar && sidebar.x > 130; step++) {
  if (sidebar.tag === 'SELECT') await key('ArrowUp', 'ArrowUp', 38)
  else await key('ArrowLeft', 'ArrowLeft', 37)
  sidebar = await evaluate(focused)
}
if (!sidebar) throw new Error('lost the highlight while reaching the sidebar')

for (let step = 0; step < 30; step++) {
  const state = await evaluate(focused)
  if (state?.label === 'Settings') break
  const target = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Settings')
    const r = el.getBoundingClientRect()
    return { y: r.top + r.height / 2 }
  })()`)
  const direction = state && state.y > target.y ? 12 : 13
  await pad(direction)
}
const onSettings = await evaluate(`document.querySelector('[data-nav-focus]')?.getAttribute('aria-label') === 'Settings'`)
if (!onSettings) throw new Error('pad navigation never reached the Settings item')
await pad(0)
const openedSettings = await waitFor(`document.querySelector('main[data-jf-view]')?.getAttribute('data-jf-view') === 'settings'`)
console.log('pad A opened Settings:', openedSettings)
if (!openedSettings) throw new Error('pad A did not open Settings')

// Enter the content column from the sidebar, then walk to the intro dropdown.
await evaluate(`window.introSelect().scrollIntoView({ block: 'center' })`)
await delay(500)
let entered = await evaluate(focused)
for (let step = 0; step < 6 && entered && entered.x < 200; step++) {
  await pad(15)
  entered = await evaluate(focused)
}
let onIntro = false
for (let step = 0; step < 40 && !onIntro; step++) {
  onIntro = await evaluate(`document.querySelector('select[data-nav-focus]') === window.introSelect()`)
  if (onIntro) break
  const state = await evaluate(focused)
  if (!state) break
  const target = await evaluate(`(() => {
    const el = window.introSelect()
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { y: r.top + r.height / 2 }
  })()`)
  if (!target) break
  await pad(state.y > target.y ? 12 : 13)
}
console.log('pad navigation reached the Startup intro dropdown:', onIntro)
if (!onIntro) throw new Error('pad navigation never reached the Startup intro dropdown')

const introBefore = await evaluate(`window.introSelect().value`)
await pad(15)
const introAfter = await evaluate(`window.introSelect().value`)
const storedAfter = await evaluate(`window.joyframe.settings.get().then((s) => s.introMode)`)
console.log('pad right on the intro dropdown:', introBefore, '->', introAfter, 'stored:', storedAfter)
if (introAfter === introBefore || storedAfter !== introAfter) throw new Error('pad did not change and save the intro mode')

// Step to Off so the restart check has a quiet mode.
for (let step = 0; step < 4 && introAfter !== 'off'; step++) await pad(15)
const finalMode = await evaluate(`window.joyframe.settings.get().then((s) => s.introMode)`)
const finalValue = await evaluate(`window.introSelect().value`)
console.log('final intro mode:', finalValue, 'stored:', finalMode)
if (finalMode !== 'off' || finalValue !== 'off') throw new Error('could not step the dropdown to Off')

// ---- 3. restart: persisted mode, no intro ----
await shutdown()
const disk = (() => {
  const db = openDatabase(path.join(profile, 'joyframe.db'))
  try {
    return getSettings(db).introMode
  } finally {
    db.close()
  }
})()
console.log('stored on disk after quit:', JSON.stringify(disk))
if (disk !== 'off') throw new Error(`pad-chosen mode did not persist, disk has ${disk}`)

await launch()
await waitFor(`Boolean(document.querySelector('[data-jf-view]'))`)
let intro = false
const deadline = Date.now() + 2600
while (Date.now() < deadline) {
  if (await phase()) {
    intro = true
    break
  }
  await delay(100)
}
console.log('restart with the pad-chosen mode — intro played:', intro)
if (intro) throw new Error('intro ignored the mode chosen by controller')

await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`)
if (!(await waitFor(`document.querySelectorAll('select').length > 0`))) throw new Error('Settings dropdown missing after restart')
const afterRestart = await evaluate(`(() => {
  const s = [...document.querySelectorAll('select')].find((x) => x.closest('label')?.textContent?.includes('Startup intro'))
  return s ? s.value : null
})()`)
console.log('dropdown after restart:', afterRestart)
if (afterRestart !== 'off') throw new Error(`dropdown forgot the controller-chosen mode, saw ${afterRestart}`)

await releaseAll().catch(() => undefined)
await shutdown()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* locked */
}
console.log('PASS pad reaches the Startup intro dropdown, steps it, and the mode survives a restart')
