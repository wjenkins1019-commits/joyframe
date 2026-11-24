/**
 * Exercises the Startup intro dropdown itself (real clicks + keyboard input),
 * then restarts the app after every change to prove the selection persists and
 * actually drives the next launch.
 *
 * Covers: always -> off -> first-run -> always, three real restarts.
 *
 * Run after `npm run build` (or point JOYFRAME_EXE at a packaged build):
 *
 *   npm run verify:intro-ui
 *
 * Uses `.verify-intro/intro-ui-profile` and removes it on exit.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createAppLog, createSession, delay, DEV_BOOT_NEEDS, findWindow, preflight, reportUnfinishedRun } from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'

const finishRun = reportUnfinishedRun('verify:intro-ui')
const appLog = createAppLog('verify-intro-ui')
import { openDatabase } from '../src/main/services/db.ts'
import { getSettings } from '../src/main/services/settings.ts'

const profile = path.resolve('.verify-intro/intro-ui-profile')
fs.rmSync(profile, { recursive: true, force: true })
const port = 9269

let app: ReturnType<typeof spawn> | null = null
let session: Awaited<ReturnType<typeof createSession>> | null = null

const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> =>
  session!.call(method, params)
const evaluate = (expression: string): Promise<any> => session!.evaluate(expression)

// Point JOYFRAME_EXE at an installed build to run this against it as well.
const exe = process.env.JOYFRAME_EXE ?? 'node_modules/electron/dist/electron.exe'
const appArgs = process.env.JOYFRAME_EXE ? [] : ['.']

await preflight({
  label: 'verify:intro-ui',
  port,
  // A packaged exe is self-contained; only the dev build needs out/ and Electron.
  needs: process.env.JOYFRAME_EXE
    ? [{ file: exe, remedy: 'Point JOYFRAME_EXE at an existing packaged build, then retry.' }]
    : DEV_BOOT_NEEDS
})
// A packaged exe carries its own bundle; only the dev build has to be current.
if (!process.env.JOYFRAME_EXE) assertBuildFresh({ label: 'verify:intro-ui' })

async function launch(): Promise<void> {
  // One log per run: every relaunch in the cycle appends to the same file.
  app = spawn(exe, [...appArgs, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-sandbox'], {
    stdio: appLog.stdio
  })
  const target = await findWindow(port)
  if (!target) throw new Error('renderer did not expose a debugging target')
  session = await createSession(target)
}

async function shutdown(): Promise<void> {
  try {
    session?.close()
  } catch {
    /* already closed */
  }
  session = null
  try {
    if (app?.pid) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* already gone */
  }
  app = null
  await delay(1400)
}

const phase = (): Promise<string | null> =>
  evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`)

async function waitForShell(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`).catch(() => false)) return
    await delay(100)
  }
  throw new Error('app shell never appeared')
}

async function introAppears(timeout = 7000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await phase().catch(() => null)) return true
    await delay(100)
  }
  return false
}

async function introStaysAway(): Promise<boolean> {
  const deadline = Date.now() + 2600
  while (Date.now() < deadline) {
    if (await phase().catch(() => null)) return false
    await delay(100)
  }
  return true
}

async function clickSettings(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rect = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Settings')
      if (!button) return null
      button.scrollIntoView({ block: 'center' })
      const r = button.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`).catch(() => null)
    if (rect) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      break
    }
    await delay(100)
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(`selectExists()`).catch(() => false)) return
    await delay(100)
  }
  throw new Error('Settings view did not render the intro dropdown')
}

async function dropdownState(): Promise<{ value: string; options: string[] }> {
  return evaluate(`(() => {
    const select = introSelect()
    return { value: select.value, options: [...select.options].map((o) => o.textContent.trim()) }
  })()`)
}

async function press(key: string, code: string, virtualKeyCode: number): Promise<void> {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: virtualKeyCode })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKeyCode })
  await delay(120)
}

const ORDER = ['always', 'first-run', 'off']

/** Click the real select, then pick with the keyboard, as a user would. */
async function chooseMode(mode: string): Promise<void> {
  const targetIndex = ORDER.indexOf(mode)
  if (targetIndex < 0) throw new Error(`unknown mode ${mode}`)
  const rect = await evaluate(`(() => {
    const s = introSelect()
    s.scrollIntoView({ block: 'center' })
    const r = s.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await delay(250)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await delay(250)
  const focused = await evaluate(`document.activeElement === introSelect()`)
  if (!focused) throw new Error('clicking the dropdown did not focus it')
  await press('Home', 'Home', 36)
  for (let step = 0; step < targetIndex; step++) await press('ArrowDown', 'ArrowDown', 40)
  // Commits when the click opened the native list; harmless when it did not.
  await press('Enter', 'Enter', 13)
  const state = await dropdownState()
  const stored = await evaluate(`window.joyframe.settings.get().then((s) => s.introMode)`)
  console.log(`dropdown chose ${mode} — select="${state.value}" stored="${stored}" options=${JSON.stringify(state.options)}`)
  if (state.value !== mode) throw new Error(`dropdown shows ${state.value}, expected ${mode}`)
  if (stored !== mode) throw new Error(`settings stored ${stored}, expected ${mode}`)
}

function dbMode(): string {
  const db = openDatabase(path.join(profile, 'joyframe.db'))
  try {
    return getSettings(db).introMode
  } finally {
    db.close()
  }
}

const html = `
  window.introSelect = () => [...document.querySelectorAll('select')].find(
    (s) => s.closest('label')?.textContent?.includes('Startup intro')
  );
  window.selectExists = () => Boolean(window.introSelect());
  true;
`

// ---- 1. fresh launch: always plays ----
await launch()
await waitForShell()
const firstIntro = await introAppears()
console.log('first launch (default always) intro:', firstIntro)
if (!firstIntro) throw new Error('default mode did not show the intro')
await evaluate(html)
while (await phase().catch(() => null)) await delay(100)

await clickSettings()
let state = await dropdownState()
console.log('dropdown after first launch:', JSON.stringify(state))
if (state.value !== 'always') throw new Error(`expected always in the dropdown, saw ${state.value}`)

// ---- 2. dropdown -> off, restart stays quiet ----
await chooseMode('off')
await shutdown()
console.log('stored after off + quit:', JSON.stringify(dbMode()))
if (dbMode() !== 'off') throw new Error('off did not persist to disk')

await launch()
await waitForShell()
const offQuiet = await introStaysAway()
console.log('restart with off — intro stayed away:', offQuiet)
if (!offQuiet) throw new Error('intro played after choosing off')
await evaluate(html)
await clickSettings()
state = await dropdownState()
console.log('dropdown after restart (off):', JSON.stringify(state))
if (state.value !== 'off') throw new Error(`dropdown forgot off, saw ${state.value}`)

// ---- 3. dropdown -> first-run (already seen), restart stays quiet ----
await chooseMode('first-run')
await shutdown()
console.log('stored after first-run + quit:', JSON.stringify(dbMode()))
if (dbMode() !== 'first-run') throw new Error('first-run did not persist to disk')

await launch()
await waitForShell()
const firstRunQuiet = await introStaysAway()
console.log('restart with first-run (already seen) — intro stayed away:', firstRunQuiet)
if (!firstRunQuiet) throw new Error('first-run replayed for a profile that has seen the intro')
await evaluate(html)
await clickSettings()
state = await dropdownState()
console.log('dropdown after restart (first-run):', JSON.stringify(state))
if (state.value !== 'first-run') throw new Error(`dropdown forgot first-run, saw ${state.value}`)

// ---- 4. dropdown -> always, restart plays again ----
await chooseMode('always')
await shutdown()
console.log('stored after always + quit:', JSON.stringify(dbMode()))
if (dbMode() !== 'always') throw new Error('always did not persist to disk')

await launch()
await waitForShell()
const alwaysIntro = await introAppears()
console.log('restart with always — intro played:', alwaysIntro)
if (!alwaysIntro) throw new Error('intro did not return after choosing always')
await evaluate(html)
while (await phase().catch(() => null)) await delay(100)
await clickSettings()
state = await dropdownState()
console.log('dropdown after restart (always):', JSON.stringify(state))
if (state.value !== 'always') throw new Error(`dropdown forgot always, saw ${state.value}`)

await shutdown()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* locked profile is harmless */
}
console.log('PASS dropdown switches every mode, persists across restart, and launch behavior follows it')
finishRun()
