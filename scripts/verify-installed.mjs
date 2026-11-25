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
import {
  createAppLog,
  createSession,
  delay,
  findWindow,
  preflight,
  reportUnfinishedRun,
  waitForValue
} from './cdp.mjs'

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

/**
 * How long a cold first launch may take to reach a painted state, measured once
 * from launch. Discovery and every later gate draw from this same budget, so a
 * launch that hangs fails BOOT_TIMEOUT_MS after spawn instead of restarting the
 * clock at each stage — a boot that misses the deadline reports a slow boot
 * instead of a missing renderer. Lowering it through the environment only
 * tightens the real deadline — it never loosens the 30 s default — and exists so
 * the expiry path can be proven against the installed app without waiting a
 * full minute for a failure.
 */
const BOOT_TIMEOUT_MS = (() => {
  const raw = process.env.JOYFRAME_BOOT_TIMEOUT_MS
  if (raw === undefined || raw === '') return 30000
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `JOYFRAME_BOOT_TIMEOUT_MS must be a positive number of milliseconds, got ${JSON.stringify(raw)}`
    )
  }
  return value
})()

const spawnedAt = Date.now()
const app = spawn(exe, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-sandbox'
], { stdio: appLog.stdio })

/** The one cold-boot deadline: every gate below spends what is left of it. */
const deadline = spawnedAt + BOOT_TIMEOUT_MS
const remaining = () => deadline - Date.now()
const bootDeadlineError = (stage) =>
  new Error(`installed app ${stage} within ${BOOT_TIMEOUT_MS} ms of launch — the boot is slower than the deadline`)
console.log(`installed boot: deadline ${BOOT_TIMEOUT_MS} ms from launch`)

const INTRO_PHASE = `document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`

// Readings taken inside the try and asserted after teardown, so a failed check
// still stops the instance this probe started.
let session = null
let seen = null
let skipMs = null
let cleared = false
let detailOpened = null
let appVisible = null

try {
  // Discovery spends what is left of the boot deadline, so a slow launch is
  // named as slow rather than as a build that never produced a window.
  const target = await findWindow(port, { timeout: Math.max(0, remaining()) })
  if (!target) throw bootDeadlineError('exposed no renderer')
  const windowAt = Date.now()
  console.log(`installed boot: spawn->window ${windowAt - spawnedAt} ms`)

  session = await createSession(target)
  const { call, evaluate } = session
  const phase = () => evaluate(INTRO_PHASE).catch(() => null)

  /**
   * Wait for something the boot must eventually show, spending only what is left
   * of the launch deadline. A gate that never gets its value therefore ends the
   * run at BOOT_TIMEOUT_MS from spawn, and names itself as the stage that
   * missed a deadline that the whole boot shares.
   */
  const waitForBoot = async (expression, stage) => {
    const left = remaining()
    if (left <= 0) throw bootDeadlineError(stage)
    const value = await waitForValue(evaluate, expression, { timeout: left })
    if (!value) throw bootDeadlineError(stage)
    return value
  }

  // Wait out the cold start before touching settings: a reload issued while the
  // window is still booting can be dropped, which would leave the intro to run
  // for the unnamed profile instead of the ident this probe checks.
  await waitForBoot(`Boolean(window.joyframe?.settings)`, 'exposed no settings bridge')
  // Includes attaching and the session's own reload, so it reads as the probe's
  // setup plus the app's first paint, not as app time alone.
  const bridgeAt = Date.now()
  console.log(`installed boot: window->bridge ${bridgeAt - windowAt} ms (includes the session attach and reload)`)

  // The installed copy starts with an unnamed profile on a fresh directory; name
  // it and reload so this probe exercises the ident rather than the name step.
  await evaluate(`window.joyframe.settings.update({ playerName: 'Probe' })`)
  await call('Page.reload')

  seen = await waitForBoot(INTRO_PHASE, 'showed no intro')
  const introAt = Date.now()
  console.log(`installed boot: bridge->intro ${introAt - bridgeAt} ms (after the probe's settings reload)`)
  console.log(`installed boot: total ${introAt - spawnedAt} ms of ${BOOT_TIMEOUT_MS} ms budget`)
  const captured = await call('Page.captureScreenshot', { format: 'png' })
  if (captured.result?.data) fs.writeFileSync(shot, Buffer.from(captured.result.data, 'base64'))
  const text = await evaluate(`document.querySelector('[data-jf-intro]')?.innerText ?? null`).catch(() => null)

  // A real key press must dismiss the installed build's intro immediately.
  const started = Date.now()
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  while (Date.now() - started < 2500) {
    if ((await phase()) === null) { cleared = true; break }
    await delay(60)
  }
  skipMs = Date.now() - started
  detailOpened = await evaluate(`Boolean(document.querySelector('[data-jf-detail]'))`)
  appVisible = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
  console.log('installed intro phase:', seen)
  console.log('installed intro text:', JSON.stringify(text))
  console.log('cleared after key press ms:', cleared ? skipMs : null, 'detail opened:', detailOpened, 'app visible:', appVisible)

  // The installed build must also expose the new mode and honour "off".
  const mode = await evaluate(`window.joyframe.settings.get().then((s) => s.introMode)`)
  await evaluate(`window.joyframe.settings.update({ introMode: 'off' })`)
  await call('Page.reload')
  // "No intro" only proves something once the shell has painted: an empty
  // document on a slow boot would otherwise pass for a build honouring "off".
  await waitForBoot(`Boolean(document.querySelector('[data-jf-view]'))`, 'showed no app shell with intro off')
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
  if (offPlayed) throw new Error('installed build ignored introMode off')
  if (!offApp) throw new Error('installed app missing with intro off')
} finally {
  /*
   * Teardown cannot depend on a green run. A gate that exhausts its deadline
   * throws before the assertions below were reached, and the surviving app
   * keeps port 9268 — so the next attempt would exit 2 with "already accepting
   * connections" and read as a machine-not-ready skip instead of the failure
   * that actually happened.
   */
  try { session?.close() } catch {}
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  await delay(1200)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}

if (seen !== 'play') throw new Error('installed app did not show the intro')
if (!cleared) throw new Error('installed intro never cleared')
if (detailOpened) throw new Error('skip key also activated the app underneath')
if (!appVisible) throw new Error('installed app shell missing')
console.log('PASS installed app intro is skippable, respects introMode off, and opens the library')
finishRun()
