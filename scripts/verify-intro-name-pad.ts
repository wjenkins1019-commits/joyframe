/**
 * The welcome name step in the packaged app, with a controller connected.
 *
 * One boot proves the pad path: the step appears, pad A moves to the ident.
 * A reload then proves the typing path: real key events edit the field and the
 * intro gate does not dismiss the step. Both paths once broke in opposite ways
 * (a pad press had no way forward, while typing was swallowed as a skip), so
 * this runs against `release/win-unpacked` rather than dev Electron.
 *
 *   npm run verify:intro-name-pad
 *
 * Requires `npm run dist`, and uses `.verify-intro/name-pad-profile`, which is
 * removed on exit.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  createAppLog,
  createSession,
  delay,
  findWindow,
  MISSING_PACKAGED,
  preflight,
  reportUnfinishedRun
} from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'
import { assertPackagedBuildFresh } from './packaged-build.mjs'
import { openDatabase } from '../src/main/services/db.ts'
import { updateSettings } from '../src/main/services/settings.ts'

const finishRun = reportUnfinishedRun('verify:intro-name-pad')
const appLog = createAppLog('verify-intro-name-pad')
const EXE = path.join('release', 'win-unpacked', 'JOYFRAME.exe')
const PROFILE = path.resolve('.verify-intro/name-pad-profile')
const PORT = Number(process.env.JF_INTRO_NAME_PORT ?? 9273)

fs.rmSync(PROFILE, { recursive: true, force: true })
// An empty name is what makes the welcome step appear; always mode makes the
// step replay after the reload without depending on first-run bookkeeping.
{
  const db = openDatabase(path.join(PROFILE, 'joyframe.db'))
  updateSettings(db, { playerName: '', introMode: 'always' })
  db.close()
}

await preflight({
  label: 'verify:intro-name-pad',
  port: PORT,
  portVariable: 'JF_INTRO_NAME_PORT',
  needs: [{ file: EXE, remedy: MISSING_PACKAGED }]
})
assertBuildFresh({ label: 'verify:intro-name-pad' })
assertPackagedBuildFresh()

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
  return true
})()`

let app: ReturnType<typeof spawn> | null = null
let session: Awaited<ReturnType<typeof createSession>> | null = null

const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> =>
  session!.call(method, params)
const evaluate = (expression: string): Promise<any> => session!.evaluate(expression)
const phase = (): Promise<string | null> =>
  evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`).catch(() => null)

async function launch(): Promise<void> {
  app = spawn(
    EXE,
    [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-sandbox'],
    { stdio: appLog.stdio }
  )
  const target = await findWindow(PORT)
  if (!target) throw new Error('renderer did not expose a debugging target')
  // Attach to the first load, then install the pad before the reload that the
  // probe observes, so the controller is present from the step's first paint.
  session = await createSession(target, { reload: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PAD })
  await send('Page.reload')
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
  await delay(1200)
}

async function waitForPhase(expected: string, timeout = 10000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await phase()) === expected) return true
    await delay(80)
  }
  return false
}

/** Wait for the observed reload, not the previous document showing the same step. */
async function waitForNameStep(timeout = 10000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => ({
      phase: document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null,
      pad: typeof window.__trigger === 'function'
    }))()`).catch(() => null)
    if (state?.phase === 'name' && state.pad) return true
    await delay(80)
  }
  return false
}

/** Hold A for a poll tick, wait for the phase change, then release it. */
async function pressA(): Promise<boolean> {
  await evaluate('window.__trigger(0, 1)')
  try {
    return await waitForPhase('play', 3000)
  } finally {
    await evaluate('window.__trigger(0, 0)').catch(() => undefined)
  }
}

/** Real key events, not Input.insertText: the intro gate has to pass them through. */
async function typeName(name: string): Promise<void> {
  for (const char of name) {
    const code = `Key${char.toUpperCase()}`
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
      key: char,
      code,
      windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0)
    })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char, code })
    await delay(35)
  }
  await delay(150)
}

try {
  await launch()
  if (!(await waitForNameStep())) throw new Error('packaged app did not show the welcome name step with the pad')

  const copy = await evaluate(`document.querySelector('[data-jf-intro="name"]')?.innerText ?? ''`)
  if (!/time for your/i.test(copy) || !/game face/i.test(copy)) {
    throw new Error(`name step copy did not show the game-face line: ${JSON.stringify(copy.slice(0, 100))}`)
  }
  const pad = await evaluate(`(() => {
    const p = navigator.getGamepads()[0]
    return p ? { id: p.id, mapping: p.mapping } : null
  })()`)
  if (!pad) throw new Error('the virtual pad was not visible to the app on the name step')
  console.log('name step reached with pad:', JSON.stringify(pad))

  const moved = await pressA()
  const afterPad = await phase()
  if (!moved || afterPad !== 'play') {
    throw new Error(`pad A did not move the name step to the ident (phase=${JSON.stringify(afterPad)})`)
  }
  if (await evaluate(`Boolean(document.querySelector('[data-jf-intro="name"]'))`)) {
    throw new Error('the name step stayed mounted after pad A advanced to the ident')
  }
  console.log('PASS pad A moved the name step to the ident')

  // Reload back to an empty name step, with the pad script still installed.
  await send('Page.reload')
  if (!(await waitForNameStep())) throw new Error('the name step did not return after reload')

  const focused = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Your name"]')
    input?.focus()
    return document.activeElement === input
  })()`)
  if (!focused) throw new Error('the name field could not take focus')

  await typeName('Buffy')
  const typed = await evaluate(`document.querySelector('input[aria-label="Your name"]')?.value ?? ''`)
  const afterTyping = await phase()
  if (typed !== 'Buffy') {
    throw new Error(`typing left ${JSON.stringify(typed)} in the name field, expected Buffy (phase=${JSON.stringify(afterTyping)})`)
  }
  if (afterTyping !== 'name') {
    throw new Error(`typing dismissed the name step instead of editing it (phase=${JSON.stringify(afterTyping)})`)
  }
  console.log('PASS real key events edited the name and kept the step open')

  console.log('PASS packaged name step: pad advances to the ident, typing edits the name')
  finishRun()
} finally {
  await shutdown().catch(() => undefined)
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    /* locked profile is harmless */
  }
}
