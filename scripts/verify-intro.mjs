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

const finishRun = reportUnfinishedRun('verify:intro (ident)')
const appLog = createAppLog('verify-intro')

const profile = path.resolve('.verify-intro/intro-profile')
fs.rmSync(profile, { recursive: true, force: true })
const port = 9266
const shot = path.resolve('.verify-intro/intro.png')
fs.rmSync(shot, { force: true })
await preflight({ label: 'verify:intro', port, needs: DEV_BOOT_NEEDS })
const app = spawn('node_modules/electron/dist/electron.exe', [
  '.',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-sandbox'
], { stdio: appLog.stdio })

const target = await findWindow(port)
if (!target) throw new Error('no renderer target')
const { call, close, evaluate } = await createSession(target)

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
const EXPECTED_STAGES = 7

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

close()
try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
await delay(900)
try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}

if (results.length !== EXPECTED_STAGES) {
  throw new Error(`intro probe ran ${results.length} of ${EXPECTED_STAGES} stages — the run was shortened`)
}
console.log(`PASS intro ${results.join(' + ')}`)
finishRun()
