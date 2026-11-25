/**
 * Startup ident behaviour against a throwaway profile.
 *
 * Checks that the splash auto-advances untouched, that a key press, a click or
 * a controller button dismisses it without activating the UI underneath, that
 * `introMode: 'off'` never paints it, and that `first-run` stays quiet once the
 * profile has seen it.
 *
 * Run after `npm run build` (it boots `out/` through dev Electron):
 *
 *   npm run verify:intro
 *
 * Uses `.verify-intro/intro-profile` and removes it on exit.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createAppLog, createSession, delay, DEV_BOOT_NEEDS, findWindow, preflight, reportUnfinishedRun } from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'

const finishRun = reportUnfinishedRun('verify:intro (ident)')
const appLog = createAppLog('verify-intro')

const profile = path.resolve('.verify-intro/intro-profile')
fs.rmSync(profile, { recursive: true, force: true })
const port = 9266
const shot = path.resolve('.verify-intro/intro.png')
fs.rmSync(shot, { force: true })
await preflight({ label: 'verify:intro', port, needs: DEV_BOOT_NEEDS })
assertBuildFresh({ label: 'verify:intro' })
const app = spawn('node_modules/electron/dist/electron.exe', [
  '.',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-sandbox'
], { stdio: appLog.stdio })

const target = await findWindow(port)
if (!target) throw new Error('no renderer target')
const { call, close, evaluate } = await createSession(target)

// Start past the first-run name step: this probe covers the ident itself.
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const named = await evaluate(
      `window.joyframe ? window.joyframe.settings.update({ playerName: 'Probe' }).then(() => true) : false`
    )
    if (named) break
  } catch {
    /* context still booting */
  }
  await delay(100)
}

// A reload briefly kills the context; polling treats that as "not yet".
const phase = () =>
  evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`).catch(() => null)

async function waitForIntro() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await phase()
    if (value) return value
    await delay(80)
  }
  return null
}

async function waitForGone(timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if ((await phase()) === null) return Date.now() - started
    await delay(80)
  }
  return null
}

async function reloadWithIntro() {
  await call('Page.reload')
  await delay(500)
  const seen = await waitForIntro()
  if (!seen) throw new Error('intro did not replay after reload')
  return seen
}

const results = []

/** Every stage below runs on each pass, so a shorter list means one was skipped. */
const EXPECTED_STAGES = 8

// 1. Auto-advance when the user does nothing.
await reloadWithIntro()
const autoMs = await waitForGone(8000)
const autoDetail = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
const appVisible = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
console.log('auto-advance ms:', autoMs, 'app visible:', appVisible)
if (autoMs === null || autoMs < 1200 || autoMs > 6000) throw new Error(`unexpected auto duration ${autoMs}`)
if (!appVisible) throw new Error('app shell missing after intro')
results.push('auto')

// Capture a frame of the ident, including the skip hint.
await call('Page.reload')
await delay(500)
await waitForIntro()
await delay(1150)
const captured = await call('Page.captureScreenshot', { format: 'png' })
if (captured.result?.data) fs.writeFileSync(shot, Buffer.from(captured.result.data, 'base64'))
results.push('screenshot')

// 2. A key press dismisses it and does not activate anything underneath.
await reloadWithIntro()
const keyStart = Date.now()
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
const keyMs = await waitForGone(3000)
const keyDetail = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
console.log('key skip ms:', keyMs === null ? null : Date.now() - keyStart, 'detail opened:', keyDetail)
if (keyMs === null) throw new Error('key press did not skip the intro')
if (keyDetail) throw new Error('key press also activated the app underneath')
results.push('key')

// 3. A click dismisses it without clicking through to the UI.
await reloadWithIntro()
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 420, button: 'left', clickCount: 1 })
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 420, button: 'left', clickCount: 1 })
const clickMs = await waitForGone(3000)
const clickDetail = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
console.log('click skip ms:', clickMs, 'detail opened:', clickDetail)
if (clickMs === null) throw new Error('click did not skip the intro')
if (clickDetail) throw new Error('click also activated the app underneath')
results.push('click')

// 4. A controller button dismisses it, and the same press must not act.
await reloadWithIntro()
await evaluate(`Object.defineProperty(navigator, 'getGamepads', {
  configurable: true,
  value: () => [{
    connected: true,
    index: 0,
    id: 'Probe Pad (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 }))
  }]
}) === undefined`)
const padMs = await waitForGone(4000)
const padDetail = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
console.log('controller skip ms:', padMs, 'detail opened:', padDetail)
if (padMs === null) throw new Error('controller input did not skip the intro')
if (padDetail) throw new Error('controller press also activated the app underneath')
results.push('controller')

// 5. Mode "off": the ident must never appear, even for a frame.
async function expectNoIntro(label) {
  await delay(600)
  let appeared = false
  const deadline = Date.now() + 2600
  while (Date.now() < deadline) {
    if (await phase()) {
      appeared = true
      break
    }
    await delay(100)
  }
  const visible = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
  console.log(`${label}: appeared=${appeared} app visible=${visible}`)
  if (appeared) throw new Error(`intro played with ${label}`)
  if (!visible) throw new Error(`app missing with ${label}`)
  results.push(label)
}

await evaluate(`window.joyframe.settings.update({ introMode: 'off' })`)
await call('Page.reload')
await expectNoIntro('off')

// 6. "First run only" after this profile has already seen it: stays quiet.
await evaluate(`window.joyframe.settings.update({ introMode: 'first-run' })`)
await call('Page.reload')
await expectNoIntro('first-run seen')

// 7. An unnamed profile gets the cinematic name step before the ident, and
// the name it types is stored and used on the ident itself.
await evaluate(`window.joyframe.settings.update({ playerName: '', introMode: 'always' })`)
await call('Page.reload')
await delay(500)
const namePhase = await waitForIntro()
const nameText = await evaluate(`document.querySelector('[data-jf-intro="name"]')?.innerText ?? ''`)
console.log('name step phase:', namePhase, 'copy:', JSON.stringify(nameText.slice(0, 80)))
if (namePhase !== 'name') throw new Error(`expected the name step, saw ${JSON.stringify(namePhase)}`)
if (!/time for your/i.test(nameText) || !/game face/i.test(nameText)) {
  throw new Error('the name step did not show the game-face line')
}
await evaluate(`document.querySelector('input[aria-label="Your name"]')?.focus()`)
// Real key events, not Input.insertText: the intro gate sits in front of the
// field and must let a text field keep its keystrokes.
for (const char of 'Buffy') {
  const code = `Key${char.toUpperCase()}`
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    text: char,
    key: char,
    code,
    windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0)
  })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: char, code })
}
const typed = await evaluate(`document.querySelector('input[aria-label="Your name"]')?.value ?? ''`)
if (typed !== 'Buffy') throw new Error(`name field received ${JSON.stringify(typed)}, expected Buffy`)
await evaluate(`document.querySelector('[data-jf-intro="name"] button[type="submit"]')?.click()`)
let playPhase = null
for (let attempt = 0; attempt < 60 && playPhase !== 'play'; attempt++) {
  playPhase = await phase()
  if (playPhase !== 'play') await delay(60)
}
const storedName = await evaluate(`window.joyframe.settings.get().then((s) => s.playerName)`)
const identText = await evaluate(`document.querySelector('[data-jf-intro="play"]')?.innerText ?? ''`)
console.log('name step entered:', JSON.stringify(storedName), 'ident phase:', playPhase)
if (playPhase !== 'play') throw new Error('submitting the name did not start the ident')
if (storedName !== 'Buffy') throw new Error(`stored player name ${JSON.stringify(storedName)}, expected Buffy`)
if (!/GAME FACE ON,\s*BUFFY/i.test(identText)) throw new Error('the ident did not use the stored name')
if ((await waitForGone(7000)) === null) throw new Error('the ident did not finish after the name step')
results.push('name')

close()
try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
await delay(900)
try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}

if (results.length !== EXPECTED_STAGES) {
  throw new Error(`intro probe ran ${results.length} of ${EXPECTED_STAGES} stages — the run was shortened`)
}
console.log(`PASS intro ${results.join(' + ')}`)
finishRun()
