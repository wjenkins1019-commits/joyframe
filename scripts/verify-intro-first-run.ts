/**
 * A profile configured for "first run only" must show the ident on its first
 * launch and stay quiet on the next one.
 *
 * Run after `npm run build`:
 *
 *   npm run verify:intro
 *
 * Uses `.verify-intro/first-run-profile` and removes it on exit.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createAppLog, createSession, delay, DEV_BOOT_NEEDS, findWindow, preflight, reportUnfinishedRun } from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'

const finishRun = reportUnfinishedRun('verify:intro (first-run)')
const appLog = createAppLog('verify-intro-first-run')
import { openDatabase } from '../src/main/services/db.ts'
import { getMeta, updateSettings } from '../src/main/services/settings.ts'

const profile = path.resolve('.verify-intro/first-run-profile')
fs.rmSync(profile, { recursive: true, force: true })
const db = openDatabase(path.join(profile, 'joyframe.db'))
updateSettings(db, { introMode: 'first-run', playerName: 'Probe' })
db.close()

const port = 9267
await preflight({ label: 'verify:intro (first-run)', port, needs: DEV_BOOT_NEEDS })
assertBuildFresh({ label: 'verify:intro (first-run)' })
const app = spawn(
  'node_modules/electron/dist/electron.exe',
  ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-sandbox'],
  { stdio: appLog.stdio }
)

const target = await findWindow(port)
if (!target) throw new Error('no renderer target')
// The first launch is the thing under test, so attach without reloading.
const { call, close, evaluate } = await createSession(target, { reload: false })
const phase = () =>
  evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`).catch(() => null)

async function waitForIntro(timeout = 8000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await phase()) return true
    await delay(100)
  }
  return false
}

const firstPlayed = await waitForIntro()
console.log('first launch intro:', firstPlayed)
if (!firstPlayed) throw new Error('first-run mode did not show the intro on a fresh profile')

// Wait for it to finish, then relaunch the renderer: it must stay quiet.
await delay(3200)
await call('Page.reload')
let secondPlayed = false
const deadline = Date.now() + 2600
while (Date.now() < deadline) {
  if (await phase()) {
    secondPlayed = true
    break
  }
  await delay(100)
}
const appVisible = await evaluate(`Boolean(document.querySelector('[data-jf-view]'))`)
console.log('second launch intro:', secondPlayed, 'app visible:', appVisible)
if (secondPlayed) throw new Error('first-run mode replayed the intro')
if (!appVisible) throw new Error('app did not render after the skipped intro')

close()
try {
  execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
} catch {
  /* already gone */
}
await delay(1200)
const check = openDatabase(path.join(profile, 'joyframe.db'))
const marked = getMeta(check, 'introPlayed')
check.close()
console.log('meta introPlayed:', JSON.stringify(marked))
if (marked !== '1') throw new Error('profile was not marked as having seen the intro')
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* profile still locked is harmless */
}
console.log('PASS first-run mode plays once and never again')
finishRun()
