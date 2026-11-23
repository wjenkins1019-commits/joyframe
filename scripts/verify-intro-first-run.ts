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
import { openDatabase } from '../src/main/services/db.ts'
import { getMeta, updateSettings } from '../src/main/services/settings.ts'

const profile = path.resolve('.verify-intro/first-run-profile')
fs.rmSync(profile, { recursive: true, force: true })
const db = openDatabase(path.join(profile, 'joyframe.db'))
updateSettings(db, { introMode: 'first-run' })
db.close()

const port = 9267
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const app = spawn(
  'node_modules/electron/dist/electron.exe',
  ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-sandbox'],
  { stdio: 'ignore' }
)

let target: { webSocketDebuggerUrl: string } | null = null
for (let attempt = 0; attempt < 80 && !target; attempt++) {
  await delay(200)
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as {
      type: string
      webSocketDebuggerUrl: string
    }[]
    target = list.find((entry) => entry.type === 'page') ?? null
  } catch {
    /* renderer still starting */
  }
}
if (!target) throw new Error('no renderer target')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map<number, (value: Record<string, any>) => void>()
ws.addEventListener('message', (event) => {
  const data = JSON.parse(String(event.data))
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)?.(data)
    pending.delete(data.id)
  }
})
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<Record<string, any>>((resolve) => {
    const current = ++id
    pending.set(current, resolve)
    ws.send(JSON.stringify({ id: current, method, params }))
  })
const evaluate = async (expression: string): Promise<unknown> => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return response.result?.exceptionDetails ? null : response.result?.result?.value
}
await send('Page.enable')
const phase = () => evaluate(`document.querySelector('[data-jf-intro]')?.getAttribute('data-jf-intro') ?? null`)

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
await send('Page.reload')
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

ws.close()
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
