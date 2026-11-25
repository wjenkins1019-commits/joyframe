/**
 * Installed-copy verification: drives the machine-wide build at
 * `C:\Program Files\JOYFRAME` (override with JOYFRAME_EXE) and proves the
 * installed payload shows the startup ident, skips it on a key press without
 * activating the UI underneath, and honours `introMode: 'off'`.
 *
 * This is the one probe that runs outside the workspace build tree, so it
 * catches a missing or stale machine-wide install that release/win-unpacked
 * checks cannot see. Install first (`npm run dist`, then the elevated
 * `/allusers /S` installer).
 *
 * The first launch after an install is a cold start — Defender scans the new
 * files and none of them are in the OS cache — so every stage here waits for
 * the renderer to reach the state it needs instead of sleeping a fixed time.
 * A slow boot must not be reported as a build that lost its intro.
 *
 *   npm run verify:installed
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createAppLog, createSession, delay, findWindow, preflight, reportUnfinishedRun } from './cdp.mjs'

const finishRun = reportUnfinishedRun('verify:installed')
const appLog = createAppLog('verify-installed')

const profile = path.resolve('.verify-intro/installed-profile')
fs.rmSync(profile, { recursive: true, force: true })
const shot = path.resolve('.verify-intro/intro-installed.png')
const port = 9268

const exe = process.env.JOYFRAME_EXE ?? 'C:/Program Files/JOYFRAME/JOYFRAME.exe'
await preflight({
  label: 'verify:installed',
  port,
  needs: [
    {
      file: exe,
      remedy:
        'Install the current build first (`npm run dist`, then the elevated `/allusers /S` installer), ' +
        'or point JOYFRAME_EXE at an existing copy.'
    }
  ]
})

const app = spawn(exe, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-sandbox'
], { stdio: appLog.stdio })

const target = await findWindow(port)
if (!target) throw new Error('installed app did not expose a renderer')
const { call, close, evaluate } = await createSession(target)

/** How long a cold first launch may take to reach a painted state. */
const BOOT_TIMEOUT_MS = 30000

/**
 * Poll until `expression` returns something truthy.
 *
 * A reload destroys the execution context mid-poll, so a rejected read means
 * "not yet", not "the app is broken"; only a timeout is a failure.
 */
async function readValue(expression, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression)
      if (value) return value
    } catch {
      /* the reload replaced the execution context; ask again */
    }
    await delay(100)
  }
  return null
}

const INTRO_PHASE = `document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`
const phase = () => evaluate(INTRO_PHASE).catch(() => null)

// Wait out the cold start before touching settings: a reload issued while the
// window is still booting can be dropped, which would leave the intro to run
// for the unnamed profile instead of the ident this probe checks.
if (!(await readValue(`Boolean(window.joyframe?.settings)`, BOOT_TIMEOUT_MS))) {
  throw new Error('installed app never exposed its settings bridge')
}

// The installed copy starts with an unnamed profile on a fresh directory; name
// it and reload so this probe exercises the ident rather than the name step.
await evaluate(`window.joyframe.settings.update({ playerName: 'Probe' })`)
await call('Page.reload')

const seen = await readValue(INTRO_PHASE, BOOT_TIMEOUT_MS)
const captured = await call('Page.captureScreenshot', { format: 'png' })
if (captured.result?.data) fs.writeFileSync(shot, Buffer.from(captured.result.data, 'base64'))
const text = await evaluate(`document.querySelector('[data-jf-intro]')?.innerText ?? null`).catch(() => null)

// A real key press must dismiss the installed build's intro immediately.
const started = Date.now()
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
let cleared = false
while (Date.now() - started < 2500) {
  if ((await phase()) === null) { cleared = true; break }
  await delay(60)
}
const skipMs = Date.now() - started
const detailOpened = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
const appVisible = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
console.log('installed intro phase:', seen)
console.log('installed intro text:', JSON.stringify(text))
console.log('cleared after key press ms:', cleared ? skipMs : null, 'detail opened:', detailOpened, 'app visible:', appVisible)

// The installed build must also expose the new mode and honour "off".
const mode = await evaluate(`window.joyframe.settings.get().then((s) => s.introMode)`)
await evaluate(`window.joyframe.settings.update({ introMode: 'off' })`)
await call('Page.reload')
// "No intro" only proves something once the shell has painted: an empty
// document on a slow boot would otherwise pass for a build honouring "off".
const offPainted = await readValue(`Boolean(document.querySelector('[data-jf-view]'))`, BOOT_TIMEOUT_MS)
let offPlayed = false
const offDeadline = Date.now() + 2600
while (Date.now() < offDeadline) {
  if (await phase()) {
    offPlayed = true
    break
  }
  await delay(100)
}
const offApp = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
console.log('installed introMode:', JSON.stringify(mode), 'off mode played:', offPlayed, 'app visible:', offApp)
if (mode !== 'always') throw new Error(`unexpected installed introMode ${JSON.stringify(mode)}`)
if (!offPainted) throw new Error('installed app shell never painted with intro off')
if (offPlayed) throw new Error('installed build ignored introMode off')
if (!offApp) throw new Error('installed app missing with intro off')

close()
try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
await delay(1200)
try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}

if (seen !== 'play') throw new Error('installed app did not show the intro')
if (!cleared) throw new Error('installed intro never cleared')
if (detailOpened) throw new Error('skip key also activated the app underneath')
if (!appVisible) throw new Error('installed app shell missing')
console.log('PASS installed app intro is skippable, respects introMode off, and opens the library')
finishRun()
