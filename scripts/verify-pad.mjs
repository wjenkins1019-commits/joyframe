#!/usr/bin/env node
/**
 * Virtual-gamepad verification for the controller diagnostics page.
 *
 * Builds the app (or uses the packaged exe), seeds a disposable demo profile
 * before launch, installs a fake standard-mapping pad, and drives triggers and
 * sticks while reading the diagnostics panel. It then checks focus movement in
 * Console Mode: one step per tap, the 400ms hold delay, the ~170ms repeat
 * rate, and slow stepping from a feathered stick. There is no in-app seed or
 * reload, so view changes leave the same navigation state a real session has.
 * The same session covers the buttons that do more than move focus: A opens a
 * detail, B closes detail → console → view, B inside console search closes
 * only the search layer, LB/RB cycle views and wrap, and Start toggles console
 * mode. Two pads are installed for the second half: an idle phantom plus an
 * active pad, so the pin, a mid-hold pad handover and an unplug/replug are
 * checked too. Run it after any change to lib/navigation.ts or ControllerDiagnostics.tsx:
 *
 *   npm run verify:pad
 *
 * For the default dev run the build happens first so the panel can never be
 * checked against stale output. Pass --dist to drive the packaged exe instead:
 * it requires a prior `npm run dist` and leaves the build alone. Both modes
 * seed with scripts/seed-demo.ts before launching.
 *
 *   npm run verify:pad
 *   npm run verify:dist-pad
 *
 * Exits 1 if the build is missing, the build fails or any reading fails to
 * track. Uses an isolated profile in .verify-pad/ or .verify-pad-dist/
 * (gitignored) so it never touches the real library. The two screenshots it
 * captures are run artifacts too, so they land in .verify-shots/ (gitignored)
 * rather than dirtying the tracked tree under shots/.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createAppLog, MISSING_ELECTRON, MISSING_PACKAGED, preflight, reportChecks, reportUnfinishedRun } from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'
import { assertPackagedBuildFresh } from './packaged-build.mjs'

const DIST = process.argv.includes('--dist')
const PORT = Number(process.env.JF_DEBUG_PORT ?? (DIST ? 9227 : 9223))
const PROFILE = DIST ? '.verify-pad-dist' : '.verify-pad'
const EXE = path.join('release', 'win-unpacked', 'JOYFRAME.exe')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SHOT_DIR = '.verify-shots'
const finishRun = reportUnfinishedRun('verify:pad')
const appLog = createAppLog(DIST ? 'verify-dist-pad' : 'verify-pad')

/** Captures are per-run artifacts, so keep them out of the tracked shots/ folder. */
function saveShot(name, data) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(data, 'base64'))
}

/** Windows keeps profile files locked until the app exits; a leftover profile is gitignored. */
function removeProfile() {
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* still locked — retried on the next run */
  }
}

/**
 * Minimal CDP client over the built-in WebSocket (Node 22+).
 *
 * Every call settles. If the app's window goes away the socket closes, and a
 * command left pending would otherwise drain the event loop and end the run
 * with 0 — a silent green — instead of reporting the app that vanished.
 */
async function connect(debuggerUrl) {
  const socket = new WebSocket(debuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools websocket refused')), { once: true })
  })
  // The app drops this socket on exit; that is expected, not a failure.
  socket.addEventListener('error', () => undefined)

  const pending = new Map()
  let nextId = 0
  let closed = null
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve(message)
  })
  socket.addEventListener('close', () => {
    closed = 'the app closed the DevTools connection (its window closed or the process exited)'
    if (!pending.size) return
    process.stderr.write(`\n[verify:pad] ${closed} while ${pending.size} command(s) were in flight.\n`)
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(closed))
    }
    pending.clear()
  })

  const call = (method, params = {}, timeout = 30000) => {
    if (closed) return Promise.reject(new Error(`DevTools ${method} never ran: ${closed}`))
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        process.stderr.write(`\n[verify:pad] ${method} went unanswered for ${timeout}ms.\n`)
        reject(new Error(`DevTools did not answer ${method} within ${timeout}ms — the renderer stopped responding`))
      }, timeout)
      timer.unref?.()
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  call.socketLost = () => closed !== null
  return call
}

/** Reads the panel through the data hooks ControllerDiagnostics exposes for this script. */
const READ_STATE = `(() => {
  const bars = {}
  for (const box of document.querySelectorAll('[data-diag-bar]')) {
    const fill = box.querySelector('[data-diag-fill]')
    bars[box.dataset.diagBar] = {
      readout: box.querySelector('[data-diag-readout]').textContent.trim(),
      width: parseFloat(fill.style.width),
      state: fill.dataset.state
    }
  }
  const latched = [...document.querySelectorAll('p')]
    .map((p) => p.textContent)
    .find((text) => text.includes('Latched:')) ?? null
  return {
    bars,
    latched,
    pads: [...document.querySelectorAll('[data-diag-pad]')].map((card) => ({
      index: Number(card.getAttribute('data-diag-pad')),
      pinned: Boolean(card.querySelector('[data-diag-pinned]'))
    })),
    mapping: document.querySelector('[data-pad-mapping]')?.getAttribute('data-pad-mapping') ?? null,
    mappingWarning: Boolean(document.querySelector('[data-diag-mapping-warning]')),
    pinned: Boolean(document.querySelector('[data-diag-pinned]')),
    lastAction: (() => {
      const el = document.querySelector('[data-diag-last-action]')
      return el ? { key: el.getAttribute('data-diag-last-action'), text: el.textContent.trim() } : null
    })(),
    checks: Object.fromEntries(
      [...document.querySelectorAll('[data-diag-check]')].map((el) => [
        el.getAttribute('data-diag-check'),
        el.getAttribute('data-state')
      ])
    ),
    checkCount: document.querySelector('[data-diag-check-count]')?.textContent.trim() ?? null
  }
})()`

/** Records every element that gains [data-nav-focus], with its position and time. */
const WATCH_FOCUS = `(() => {
  window.__focusLog = []
  window.__focusObserver?.disconnect()
  window.__focusObserver = new MutationObserver((records) => {
    for (const record of records) {
      const el = record.target
      if (!el.hasAttribute?.('data-nav-focus')) continue
      const rect = el.getBoundingClientRect()
      window.__focusLog.push({
        t: performance.now(),
        label: (el.getAttribute('aria-label') || el.textContent.trim() || '?').slice(0, 32),
        x: Math.round(rect.left + rect.width / 2)
      })
    }
  })
  window.__focusObserver.observe(document.body, { attributes: true, attributeFilter: ['data-nav-focus'], subtree: true })
  return true
})()`

const ROW_INFO = `(() => {
  const el = document.querySelector('[data-nav-focus]')
  const row = el?.closest('section')
  return {
    title: row?.getAttribute('aria-label') ?? null,
    cards: row ? row.querySelectorAll('[data-game-id]').length : 0
  }
})()`

const READ_FOCUS = `(() => {
  const el = document.querySelector('[data-nav-focus]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    label: (el.getAttribute('aria-label') || el.textContent.trim() || '?').slice(0, 32),
    x: Math.round(rect.left + rect.width / 2)
  }
})()`

/** Mounted-ness and computed display of a chrome strip (sidebar, top bar). */
const CHROME_STATE = (selector) => `(() => {
  const el = document.querySelector('${selector}')
  return { mounted: Boolean(el), display: el ? getComputedStyle(el).display : null }
})()`

/** Records the scroll behaviour each focus change asks for, so holds can be checked. */
const SPY_SCROLL = `(() => {
  window.__scrollCalls = []
  window.__scrollIntoViewOriginal ??= Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (options) {
    window.__scrollCalls.push(options?.behavior ?? 'auto')
    return window.__scrollIntoViewOriginal.call(this, options)
  }
  return true
})()`

/** True when `[data-nav-focus]` is the topmost layer's first navigable content item. */
const FOCUS_ENTERS_LAYER = `(() => {
  const layer =
    document.querySelector('[data-jf-modal="1"]') ??
    document.querySelector('[data-jf-detail="1"]') ??
    document.querySelector('[data-jf-console="1"]')
  const focused = document.querySelector('[data-nav-focus]')
  if (!layer || !focused || !layer.contains(focused)) return false
  const items = [...layer.querySelectorAll('[data-nav="1"]')].filter(
    (el) => el.getBoundingClientRect().width >= 4
  )
  const first =
    items.find((el) => !el.matches('[data-jf-modal-close], [data-jf-layer-skip]')) ?? items[0]
  return first === focused
})()`

/** Where the app is: active view, overlay layers, and whether focus holds a game card. */
const READ_ROUTE = `(() => ({
  view: document.querySelector('main[data-jf-view]')?.getAttribute('data-jf-view') ?? null,
  console: Boolean(document.querySelector('[data-jf-console="1"]')),
  detail: Boolean(document.querySelector('[data-jf-detail="1"]')),
  modal: Boolean(document.querySelector('[data-jf-modal="1"]')),
  focusCard: document.querySelector('[data-nav-focus]')?.getAttribute('data-game-id') ?? null
}))()`

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
  return true
})()`

/**
 * A pad that reports Start held on its very first poll. Steam's virtual pad and
 * some controllers do this at launch; it must not count as a press.
 */
const LATCHED_START_PAD = `(() => {
  const pad = {
    index: 0,
    id: 'Xbox Wireless Controller (virtual)',
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: i === 9,
      value: i === 9 ? 1 : 0,
      touched: i === 9
    }))
  }
  navigator.getGamepads = () => [pad, null, null, null]
  return true
})()`

/**
 * An idle phantom pad at index 0 plus the active pad at index 1, so pinning can
 * be driven from either pad and the active pad can be unplugged mid-hold.
 */
const MULTI_PAD = `(() => {
  const make = (index, id) => ({
    index,
    id,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }))
  })
  const phantom = make(0, 'Idle phantom pad (virtual)')
  const active = make(1, 'Xbox Wireless Controller (virtual)')
  window.__pad = active
  window.__pads = [phantom, active]
  navigator.getGamepads = () => window.__pads
  window.__setPad = (index, button, down) => {
    const pad = window.__pads[index]
    const entry = pad.buttons[button]
    entry.pressed = down
    entry.value = down ? 1 : 0
    entry.touched = down
    pad.timestamp = performance.now()
  }
  window.__trigger = (button, value) => {
    const entry = window.__pad.buttons[button]
    entry.value = value
    entry.pressed = value > 0.5
    entry.touched = value > 0
    window.__pad.timestamp = performance.now()
  }
  window.__axis = (axis, value) => {
    window.__pad.axes[axis] = value
    window.__pad.timestamp = performance.now()
  }
  window.__connect = (on) => window.__pads.forEach((pad) => (pad.connected = on))
  return true
})()`

/** Trigger pulls and stick deflections. 6/7 are LT/RT under the standard mapping. */
const TRIGGER_STEPS = [
  { name: 'LT idle', index: 6, value: 0 },
  { name: 'LT half-pull', index: 6, value: 0.5 },
  { name: 'RT half-pull', index: 7, value: 0.5 },
  { name: 'LT feather', index: 6, value: 0.3 },
  { name: 'LT full', index: 6, value: 0.95 },
  { name: 'RT full', index: 7, value: 1 },
  { name: 'LT released', index: 6, value: 0 }
]

/**
 * Engage at 0.60 / release at 0.45 means 0.50 stays engaged once entered, then
 * goes quiet only below 0.45, and 0.55 never engages on its own.
 */
const STICK_STEPS = [
  { name: 'Left X below engage', axis: 0, value: 0.35, latched: null },
  { name: 'Left X beyond engage', axis: 0, value: 0.62, latched: 'right' },
  { name: 'Left X holds above release', axis: 0, value: 0.5, latched: 'right' },
  { name: 'Left X releases below release', axis: 0, value: 0.4, latched: null },
  { name: 'Left X between release and engage', axis: 0, value: 0.55, latched: null },
  { name: 'Left X re-engages', axis: 0, value: 0.65, latched: 'right' },
  { name: 'Left Y up engages', axis: 1, value: -0.8, latched: 'up' }
]

/**
 * Every check this suite reports, by name, in the order it runs. A block that
 * stopped running and a check that was renamed both fail the summary against
 * this list, instead of merely shifting a count.
 */
const EXPECTED_CHECKS = [
  'latched Start on the first pad poll stays on the desktop',
  'pad detected and pinned',
  'mapping shown',
  'non-standard mapping explained',
  ...TRIGGER_STEPS.map((step) => `${step.name} (${step.value.toFixed(2)})`),
  ...STICK_STEPS.map((step) => `${step.name} (${step.value.toFixed(2)})`),
  'checklist starts with unused chips pending',
  'd-pad press names the action with its pad index',
  'd-pad press ticks its chip and leaves unused chips pending',
  'disconnecting clears the checklist',
  'reconnecting leaves every chip pending again',
  'both pads listed with exactly one pinned',
  'pin follows whichever pad shows input',
  'opening console mode focuses its first content item',
  'shelf d-pad right is one step',
  'shelf d-pad right again is one step',
  'shelf d-pad left is one step',
  'shelf row long enough to hold',
  'shelf d-pad hold: waits ~400ms',
  'shelf d-pad hold: repeats at ~170ms',
  'shelf d-pad hold: stops on release',
  'shelf full-tilt stick: waits ~400ms',
  'shelf full-tilt stick: repeats at ~170ms',
  'shelf feathered stick steps slower than full tilt',
  'held repeats scroll instantly and keep focus on screen',
  'pad switch mid-hold adds no duplicate step',
  'the pad that took the hold taps exactly one step',
  'disconnecting mid-hold stops focus and reports the pad gone',
  'reconnect starts from a clean rising edge',
  'A opens the focused game detail',
  'opening the detail focuses its first content item',
  'B closes the detail and stays in console mode',
  'closing the detail returns focus to the card that opened it',
  'the game page back button does not move while the page opens',
  'one immediate click on the back button closes the game page',
  'hiding a game returns focus once its card is gone',
  'opening the search focuses its first content item',
  'console search grid focused',
  'grid d-pad hold: waits ~400ms',
  'grid d-pad hold: repeats at ~170ms',
  'grid full-tilt stick: waits ~400ms',
  'grid full-tilt stick: repeats at ~170ms',
  'grid feathered stick steps slower than full tilt',
  'stick tap is one step',
  'B in console search closes only the search layer',
  'closing the search restores the focus it covered',
  'B exits console mode to the desktop',
  'RB advances to the next view',
  'B closes the last view back to Home',
  'LB wraps from the first view to the last',
  'RB wraps from the last view to the first',
  'Start enters console mode',
  'sidebar stays mounted but hidden in console mode',
  'Start leaves console mode',
  'leaving console mode returns focus to the control that started it',
  'top bar stays mounted but hidden in console mode',
  'leaving console mode returns focus to top-bar chrome that started it',
  'B drops the field and leaves the dialog open',
  'a second B closes the dialog'
]

const near = (actual, expected, tolerance = 0.011) =>
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
const fillState = (engaged, magnitude) =>
  engaged ? 'engaged' : magnitude > 0.05 ? 'active' : 'idle'

function build() {
  const result = spawnSync('npm run build', { stdio: 'inherit', shell: true })
  if (result.status !== 0 || !fs.existsSync(path.join('out', 'renderer', 'index.html'))) {
    console.error('Build failed — verification aborted.')
    process.exit(1)
  }
}

async function main() {
  const electron =
    process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron'
  const [command, args] = DIST ? [EXE, []] : [electron, ['.']]
  await preflight({
    label: DIST ? 'verify:dist-pad' : 'verify:pad',
    port: PORT,
    portVariable: 'JF_DEBUG_PORT',
    needs: [{ file: command, remedy: DIST ? MISSING_PACKAGED : MISSING_ELECTRON }]
  })

  if (DIST) {
    assertBuildFresh({ label: 'verify:dist-pad' })
    assertPackagedBuildFresh()
  } else build()
  removeProfile()
  const seeded = spawnSync(process.execPath, ['scripts/seed-demo.ts', PROFILE], { stdio: 'inherit' })
  if (seeded.status !== 0) {
    console.error('Demo profile seeding failed — verification aborted.')
    process.exit(1)
  }

  const app = spawn(
    command,
    [
      ...args,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.resolve(PROFILE)}`,
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ],
    { stdio: appLog.stdio }
  )

  let target
  for (let attempt = 0; attempt < 80 && !target; attempt++) {
    await delay(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((entry) => entry.type === 'page' && entry.url.includes('index.html'))
    } catch {
      /* app still starting */
    }
  }
  if (!target) {
    app.kill()
    console.error(`No app window on port ${PORT} — is another JOYFRAME instance running?`)
    process.exit(1)
  }

    const call = await connect(target.webSocketDebuggerUrl)
  await call('Runtime.enable')
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails))
    return response.result?.result?.value
  }

  /** Tolerates transient page-context errors while the renderer starts up. */
  const waitFor = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true
      } catch (error) {
        // A closed socket never recovers, so retrying only delays the report.
        if (call.socketLost()) throw error
        /* renderer still starting */
      }
      await delay(200)
    }
    return false
  }

  const results = []
  const check = (name, ok, detail) => results.push({ name, ok, detail })

  // ---- Latched input at startup -------------------------------------------
  // A pad may report held buttons on its first poll. Seeding the edge trackers
  // means the first poll can never act; without it a held Start opened Console
  // Mode on launch even with consoleModeOnStartup off.
  await call('Page.enable')
  const injected = await call('Page.addScriptToEvaluateOnNewDocument', { source: LATCHED_START_PAD })
  const injectedId = injected.result?.identifier
  const readyExpression = `Boolean(document.querySelector('button[aria-label="Settings"]'))`
  // The startup ident owns the first input; let it finish before driving the
  // pad, exactly as a person would wait for the app to finish opening.
  const settleIntro = async () => {
    // The ident can start a frame after the shell is ready, so wait for it to
    // appear before waiting for it to clear.
    const deadline = Date.now() + 4000
    let seen = false
    while (Date.now() < deadline && !seen) {
      try {
        seen = await evaluate(`Boolean(document.querySelector('[data-jf-intro]'))`)
      } catch {
        seen = false
      }
      if (!seen) await delay(100)
    }
    await waitFor(`!document.querySelector('[data-jf-intro]')`, 12000)
  }
  await call('Page.reload')
  await waitFor(readyExpression, 25000)
  await settleIntro()
  await delay(1200)
  const latchedConsole = await evaluate(`Boolean(document.querySelector('[data-jf-console="1"]'))`)
  check('latched Start on the first pad poll stays on the desktop', !latchedConsole, `console=${latchedConsole}`)
  if (injectedId) await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injectedId })
  await call('Page.reload')
  await waitFor(readyExpression, 25000)
  await settleIntro()
  await delay(800)

  await evaluate(FAKE_PAD)

  // The app starts on the seeded Home; wait for the shell to answer.
  let opened = false
  for (let attempt = 0; attempt < 60 && !opened; attempt++) {
    opened = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="Settings"]')
      button?.click()
      return Boolean(button)
    })()`)
    if (!opened) await delay(250)
  }
  if (!opened) throw new Error('Settings navigation button not found')
  await delay(700)
  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2')].find((n) => /Controller diagnostics/i.test(n.textContent))
    heading?.scrollIntoView({ block: 'center' })
    return Boolean(heading)
  })()`)

  const describe = (bar) => `readout=${bar?.readout} width=${bar?.width}% state=${bar?.state}`

  /** Apply input, let one poll (90ms) and one UI tick (150ms) land, then read. */
  const settle = async (input = {}) => {
    if (input.axis) await evaluate(`(window.__axis(${input.axis[0]}, ${input.axis[1]}), true)`)
    if (input.trigger) await evaluate(`(window.__trigger(${input.trigger[0]}, ${input.trigger[1]}), true)`)
    if (input.mapping !== undefined) await evaluate(`(window.__pad.mapping = ${JSON.stringify(input.mapping)}, true)`)
    await delay(320)
    return evaluate(READ_STATE)
  }

  const initial = await settle()
  check(
    'pad detected and pinned',
    initial.pinned && Boolean(initial.bars['Left X']),
    `pinned=${initial.pinned} bars=${Object.keys(initial.bars).length}`
  )
  check('mapping shown', initial.mapping === 'standard', `mapping=${JSON.stringify(initial.mapping)}`)

  const unmapped = await settle({ mapping: '' })
  check(
    'non-standard mapping explained',
    unmapped.mapping === '' && unmapped.mappingWarning,
    `mapping=${JSON.stringify(unmapped.mapping)} warning=${unmapped.mappingWarning}`
  )
  await settle({ mapping: 'standard' })

  for (const { name, index, value } of TRIGGER_STEPS) {
    const bar = (await settle({ trigger: [index, value] })).bars[index === 6 ? 'LT' : 'RT']
    check(
      `${name} (${value.toFixed(2)})`,
      near(Number(bar?.readout), value) &&
        near(bar?.width, value * 100, 0.6) &&
        bar?.state === fillState(value > 0.5, value),
      describe(bar)
    )
  }

  for (const { name, axis, value, latched } of STICK_STEPS) {
    const state = await settle({ axis: [axis, value] })
    const bar = state.bars[axis === 0 ? 'Left X' : 'Left Y']
    const latchedNow = latched ? Boolean(state.latched?.toLowerCase().includes(latched)) : !state.latched
    check(
      `${name} (${value.toFixed(2)})`,
      near(Number(bar?.readout), value) && bar?.state === fillState(Boolean(latched), Math.abs(value)) && latchedNow,
      `${describe(bar)} latched=${state.latched ? 'yes' : 'no'}`
    )
  }
  await settle({ axis: [1, 0] })

  const screenshot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 85 })
  if (screenshot.result?.data) {
    saveShot('verify-pad.jpg', screenshot.result.data)
  }

  // ---- Last-action readout and input checklist ----------------------------
  // The panel clears the list on mount, so the click that opened Settings left
  // nothing ticked; only the stick steps above should have registered so far.
  const countTicks = (state) => Number(state.checkCount?.split('/')[0])
  // Centre the stick first: the last step left it engaged, and its slow auto-
  // repeat would otherwise overwrite the readout and retick itself on replug.
  const before = await settle({ axis: [0, 0] })
  check(
    'checklist starts with unused chips pending',
    before.checks['dpad-down'] === 'pending' && before.checks['start'] === 'pending',
    `dpad-down=${before.checks['dpad-down']} start=${before.checks['start']} count=${before.checkCount}`
  )

  await evaluate('(window.__trigger(13, 1), true)') // d-pad down
  await delay(200)
  await evaluate('(window.__trigger(13, 0), true)')
  const pressed = await settle()
  check(
    'd-pad press names the action with its pad index',
    pressed.lastAction?.key === 'dpad-down' &&
      Boolean(pressed.lastAction.text.startsWith('D-pad down · pad 0 · ')),
    `action=${JSON.stringify(pressed.lastAction ?? null)}`
  )
  check(
    'd-pad press ticks its chip and leaves unused chips pending',
    pressed.checks['dpad-down'] === 'seen' &&
      pressed.checks['start'] === 'pending' &&
      pressed.checks['lb'] === 'pending' &&
      countTicks(pressed) === countTicks(before) + 1,
    `dpad-down=${pressed.checks['dpad-down']} start=${pressed.checks['start']} lb=${pressed.checks['lb']} count=${pressed.checkCount}`
  )

  await evaluate('(window.__pad.connected = false, true)')
  const unplugged = await settle()
  check(
    'disconnecting clears the checklist',
    unplugged.pads.length === 0 && Object.keys(unplugged.checks).length === 0 && unplugged.lastAction === null,
    `pads=${unplugged.pads.length} chips=${Object.keys(unplugged.checks).length} action=${JSON.stringify(unplugged.lastAction)}`
  )
  await evaluate('(window.__pad.connected = true, true)')
  const replugged = await settle()
  check(
    'reconnecting leaves every chip pending again',
    replugged.pads.length === 1 && replugged.checkCount === '0/14' && replugged.checks['dpad-down'] === 'pending',
    `pads=${replugged.pads.length} count=${replugged.checkCount} dpad-down=${replugged.checks['dpad-down']}`
  )

  // ---- Pin arbitration between two connected pads -------------------------
  // The idle phantom sits at index 0; only the pad showing input may hold the pin.
  await evaluate(MULTI_PAD)
  const twoPads = await settle()
  check(
    'both pads listed with exactly one pinned',
    twoPads.pads.length === 2 && twoPads.pads.filter((pad) => pad.pinned).length === 1,
    `pads=${twoPads.pads.map((pad) => `${pad.index}${pad.pinned ? '*' : ''}`).join(',')}`
  )
  const pinAfter = async (index) => {
    await evaluate(`(window.__setPad(${index}, 15, true), true)`)
    await delay(220)
    await evaluate(`(window.__setPad(${index}, 15, false), true)`)
    return (await settle()).pads.find((pad) => pad.pinned)?.index ?? -1
  }
  const activePin = await pinAfter(1)
  const phantomPin = await pinAfter(0)
  const activeAgain = await pinAfter(1)
  check(
    'pin follows whichever pad shows input',
    activePin === 1 && phantomPin === 0 && activeAgain === 1,
    `active=${activePin} phantom=${phantomPin} active-again=${activeAgain}`
  )

  // ---- Console Mode focus movement ---------------------------------------
  // The profile is seeded before launch in both modes, so there is no in-app
  // seed or reload: the session runs with the same accumulated navigation
  // state a real play session has.
  await evaluate(MULTI_PAD)
  await evaluate(`(() => {
    document.querySelector('button[aria-label="Console Mode"]').click()
    return true
  })()`)
  await delay(900)
  await evaluate(WATCH_FOCUS)

  const readFocus = () => evaluate(READ_FOCUS)
  const route = () => evaluate(READ_ROUTE)
  /** Click a button by its exact label instead of walking focus to it. */
  const clickButton = (label, selector = 'button') =>
    evaluate(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
        (n) => n.textContent.trim() === ${JSON.stringify(label)}
      )
      button?.click()
      return Boolean(button)
    })()`)
  /** Assert focus landed on the layer's first content item, reporting what it is. */
  const checkEntry = async (name) =>
    check(name, await evaluate(FOCUS_ENTERS_LAYER), `focus=${(await readFocus())?.label}`)
  /** A chrome strip kept mounted for focus return must not show over console mode. */
  const checkChromeHidden = async (name, selector) => {
    const state = await evaluate(CHROME_STATE(selector))
    check(
      `${name} stays mounted but hidden in console mode`,
      state.mounted && state.display === 'none',
      `mounted=${state.mounted} display=${state.display}`
    )
  }
  const sameFocus = (a, b) => Boolean(a) && Boolean(b) && a.label === b.label && a.x === b.x

  await checkEntry('opening console mode focuses its first content item')
  const readLog = () => evaluate('window.__focusLog')
  const clearLog = () => evaluate('(window.__focusLog.length = 0, true)')
  const between = (value, min, max) => value >= min && value <= max
  const gaps = (log) => log.slice(1).map((entry, index) => Math.round(entry.t - log[index].t))
  /** Hold an input for `ms`, release it, then let focus settle. */
  const hold = async (down, up, ms) => {
    await evaluate(down)
    await delay(ms)
    await evaluate(up)
    await delay(400)
  }
  const press = (button, ms) =>
    hold(`(window.__trigger(${button}, 1), true)`, `(window.__trigger(${button}, 0), true)`, ms)
  const stick = (value, ms) => hold(`(window.__axis(0, ${value}), true)`, '(window.__axis(0, 0), true)', ms)
  const key = async (name) => {
    await evaluate(`(window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)} })), true)`)
    await delay(150)
  }
  /** Keyboard-walk one direction until focus stops moving (row start / end). */
  const walk = async (name) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      await clearLog()
      await key(name)
      if ((await readLog()).length === 0) return true
    }
    return false
  }

  /** Run `input` from the row start and report how focus moved. */
  const fromRowStart = async (input) => {
    await walk('ArrowLeft')
    await clearLog()
    await input()
    const log = await readLog()
    return { moveGaps: gaps(log), settled: log.length }
  }

  /** Assert the 400ms hold delay and the ~170ms repeat rate for one input. */
  const timed = async (name, input) => {
    const run = await fromRowStart(input)
    await delay(450)
    check(
      `${name}: waits ~400ms`,
      run.settled >= 2 && between(run.moveGaps[0], 340, 620),
      `moves=${run.settled} gaps=${run.moveGaps}`
    )
    check(
      `${name}: repeats at ~170ms`,
      run.settled >= 3 && run.moveGaps.slice(1).every((gap) => between(gap, 120, 310)),
      `gaps=${run.moveGaps}`
    )
    return run
  }

  /** A stick just past the engage point must step at a much slower cadence. */
  const feathered = async (surface, fullGaps) => {
    const { moveGaps } = await fromRowStart(() => stick(0.62, 900))
    check(
      `${surface} feathered stick steps slower than full tilt`,
      between(moveGaps[1], 300, 520) && moveGaps[1] > fullGaps[1],
      `feathered gaps=${moveGaps} full gaps=${fullGaps}`
    )
  }

  // Shelf — one tap is exactly one step, in the pressed direction.
  let previous = await readFocus()
  for (const [name, button, forward] of [
    ['right', 15, true],
    ['right again', 15, true],
    ['left', 14, false]
  ]) {
    await clearLog()
    await press(button, 220)
    const log = await readLog()
    check(
      `shelf d-pad ${name} is one step`,
      log.length === 1 && (log[0].x - previous?.x) * (forward ? 1 : -1) > 0,
      `to=${log.map((entry) => entry.label).join(',')}`
    )
    previous = log[0] ?? previous
  }

  // Repeat timing on a real shelf: walk down until a row has room for a hold.
  let shelfRow = null
  for (let attempt = 0; attempt < 8 && !shelfRow; attempt++) {
    await key('ArrowDown')
    await walk('ArrowLeft')
    const info = await evaluate(ROW_INFO)
    if (info.cards >= 6) shelfRow = info
  }
  check(
    'shelf row long enough to hold',
    Boolean(shelfRow),
    shelfRow ? `${shelfRow.title} · ${shelfRow.cards} cards` : 'no shelf with 6+ cards'
  )
  // Release is shared by buttons and sticks, so one run confirms repeats stop.
  const shelfDpad = await timed('shelf d-pad hold', () => press(15, 900))
  check('shelf d-pad hold: stops on release', (await readLog()).length === shelfDpad.settled, `moves=${shelfDpad.settled}`)
  const shelfFull = await timed('shelf full-tilt stick', () => stick(1, 900))
  await feathered('shelf', shelfFull.moveGaps)

  // ---- Held repeats scroll instantly -------------------------------------
  // A smooth scroll lasts longer than the 170ms repeat, so a hold would leave
  // the highlighted card behind the viewport and A could activate a blind one.
  await evaluate(SPY_SCROLL)
  await walk('ArrowLeft')
  await evaluate('(window.__scrollCalls.length = 0, true)')
  await press(13, 900) // d-pad down held: one edge, then several repeats
  const scrollCalls = await evaluate('window.__scrollCalls')
  const focusOnScreen = await evaluate(`(() => {
    const el = document.querySelector('[data-nav-focus]')
    const box = el?.closest('[data-jf-console="1"]')
    if (!el || !box) return false
    const r = el.getBoundingClientRect()
    const c = box.getBoundingClientRect()
    return r.top >= c.top - 1 && r.bottom <= c.bottom + 1
  })()`)
  await evaluate('(Element.prototype.scrollIntoView = window.__scrollIntoViewOriginal, true)')
  check(
    'held repeats scroll instantly and keep focus on screen',
    scrollCalls[0] === 'smooth' &&
      scrollCalls.length >= 3 &&
      scrollCalls.slice(1).every((behavior) => behavior === 'auto') &&
      focusOnScreen,
    `behaviors=${scrollCalls.join(',')} on-screen=${focusOnScreen}`
  )

  // ---- Handing a held direction to the other pad --------------------------
  await walk('ArrowLeft')
  const beforeSwitch = (await readFocus())?.x ?? 0
  await evaluate('(window.__setPad(1, 15, true), true)')
  await delay(650) // edge plus several repeats on the active pad
  await clearLog()
  // Atomic handover: the next poll sees pad 0 down and pad 1 up, never a zero frame.
  await evaluate('(window.__setPad(0, 15, true), window.__setPad(1, 15, false), true)')
  // Release before a third repeat can land: the app notices the release on its
  // 90ms poll, so holding longer lets a healthy repeat fire after the release
  // call and makes a clean handover look like three moves.
  await delay(240)
  await evaluate('(window.__setPad(0, 15, false), true)')
  await delay(450)
  const handover = await readLog()
  check(
    'pad switch mid-hold adds no duplicate step',
    handover.length >= 1 &&
      handover.length <= 2 &&
      gaps(handover).every((gap) => gap >= 120) &&
      handover.every((entry) => entry.x > beforeSwitch),
    `moves=${handover.length} gaps=${gaps(handover)}`
  )

  // The pad that took the hold is pinned now, so one tap must be exactly one step.
  // Start from the row start: the handover can leave focus on the last card
  // that fits the window, where stepping right changes rows and moves x left.
  await walk('ArrowLeft')
  const afterSwitch = (await readFocus())?.x ?? 0
  await clearLog()
  await evaluate('(window.__setPad(0, 15, true), true)')
  await delay(220)
  await evaluate('(window.__setPad(0, 15, false), true)')
  await delay(450)
  const switchTap = await readLog()
  check(
    'the pad that took the hold taps exactly one step',
    switchTap.length === 1 && switchTap[0].x > afterSwitch,
    `moves=${switchTap.length} from=${afterSwitch} to=${switchTap.map((entry) => entry.x).join(',')} gaps=${gaps(switchTap)}`
  )

  // ---- Unplugging mid-hold, then reconnecting -----------------------------
  await walk('ArrowLeft')
  await clearLog()
  await evaluate('(window.__setPad(0, 15, true), true)')
  await delay(600) // repeat in flight when the pads disappear
  await evaluate('(window.__connect(false), true)')
  await clearLog()
  await delay(450)
  const stalled = (await readLog()).length
  const goneNotice = await evaluate("document.body.innerText.includes('No controller detected')")
  check(
    'disconnecting mid-hold stops focus and reports the pad gone',
    stalled === 0 && goneNotice,
    `moves=${stalled} notice=${goneNotice}`
  )

  // Release while unplugged, reconnect, then press once: one clean rising edge,
  // with no ghost step from the button that was held through the disconnect.
  await evaluate('(window.__setPad(0, 15, false), window.__connect(true), true)')
  await clearLog()
  await delay(500)
  const ghosts = (await readLog()).length
  await evaluate('(window.__setPad(0, 15, true), true)')
  await delay(220)
  await evaluate('(window.__setPad(0, 15, false), true)')
  await delay(450)
  const rising = await readLog()
  check(
    'reconnect starts from a clean rising edge',
    ghosts === 0 && rising.length === 1,
    `on-reconnect=${ghosts} after-press=${rising.length}`
  )

  // A must open the focused card, not a header button: walk back to the row
  // start so focus is guaranteed to sit on a game.
  await walk('ArrowLeft')
  const card = await route()
  await press(0, 220) // A
  const detailOpen = await route()
  check(
    'A opens the focused game detail',
    Boolean(card.focusCard) && detailOpen.detail,
    `focus=${card.focusCard} detail=${detailOpen.detail} console=${detailOpen.console}`
  )
  await checkEntry('opening the detail focuses its first content item')

  // Move around inside the detail first: closing must return focus to the
  // card, not leave it on an element that no longer exists.
  await press(13, 220) // d-pad down
  await press(13, 220)
  await press(1, 220) // B
  const detailClosed = await route()
  check(
    'B closes the detail and stays in console mode',
    !detailClosed.detail && detailClosed.console,
    `detail=${detailClosed.detail} console=${detailClosed.console}`
  )
  check(
    'closing the detail returns focus to the card that opened it',
    detailClosed.focusCard === card.focusCard,
    `focus=${detailClosed.focusCard} expected=${card.focusCard}`
  )

  // ---- The back button must not move while the game page opens -----------
  // The page used to translate in, so the button slid upward for half a second
  // and the first click landed where it had been, not where it was. Record its
  // position every frame from before opening, then click its settled position
  // immediately after a reopen: a page that moves loses the click and fails.
  await evaluate(`(() => {
    window.__backSamples = []
    const started = performance.now()
    const tick = () => {
      const button = [...document.querySelectorAll('[data-jf-detail="1"] button')].find((b) => b.innerText.includes('Back to library'))
      if (button) window.__backSamples.push(button.getBoundingClientRect().top)
      if (performance.now() - started < 1600) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)
  await press(0, 220) // A opens the focused card
  await delay(1600)
  const samples = (await evaluate('window.__backSamples.slice()')) ?? []
  const spread = samples.length ? Math.max(...samples) - Math.min(...samples) : Infinity
  check(
    'the game page back button does not move while the page opens',
    samples.length >= 20 && spread < 1,
    `${samples.length} frames, ${spread.toFixed(1)}px spread`
  )
  const backButton = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-jf-detail="1"] button')].find((b) => b.innerText.includes('Back to library'))
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, top: rect.top }
  })()`)
  await press(1, 220) // B closes it again
  // Reopen with the mouse and click back as soon as the page exists, so the
  // click lands inside the window the old animation took to settle.
  const cardPoint = await evaluate(`(() => {
    const card = document.querySelector('[data-nav-focus]')
    if (!card) return null
    card.scrollIntoView({ block: 'center' })
    const rect = card.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  const reopenedAt = Date.now()
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardPoint.x, y: cardPoint.y, button: 'none', clickCount: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: cardPoint.x, y: cardPoint.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cardPoint.x, y: cardPoint.y, button: 'left', clickCount: 1 })
  let pageOpened = false
  for (let attempt = 0; attempt < 60 && !pageOpened; attempt++) {
    pageOpened = await evaluate(`Boolean(document.querySelector('[data-jf-detail="1"]'))`)
  }
  const hit = pageOpened
    ? await evaluate(`(() => {
        const button = [...document.querySelectorAll('[data-jf-detail="1"] button')].find((b) => b.innerText.includes('Back to library'))
        const top = document.elementFromPoint(${backButton.x}, ${backButton.top + 3})
        return { onButton: Boolean(button && top && (top === button || button.contains(top))), at: top?.tagName ?? null }
      })()`)
    : null
  // Click three pixels below the settled top edge, where a page still sliding
  // up would no longer have its button.
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: backButton.x, y: backButton.top + 3, button: 'none', clickCount: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: backButton.x, y: backButton.top + 3, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: backButton.x, y: backButton.top + 3, button: 'left', clickCount: 1 })
  const clickMs = Date.now() - reopenedAt
  await delay(500)
  const clicked = await route()
  // The click is dispatched the moment the page exists; how long that takes is
  // a property of the runner (a hosted Windows runner mounts it in ~0.5s versus
  // ~40ms on a dev machine). The sampler above is what proves the button did
  // not move, so this holds the hit-test and the one-click close, not a
  // stopwatch that would fail on a slower machine while the app is correct.
  check(
    'one immediate click on the back button closes the game page',
    Boolean(hit?.onButton) && !clicked.detail,
    `on-button=${hit?.onButton} at=${hit?.at} click=${clickMs}ms after opening detail=${clicked.detail}`
  )

  // ---- A layer whose opening control unmounts ----------------------------
  // Hiding a game removes its card while the detail that opened it closes, so
  // the control focus returns to is gone by the time the library refreshes.
  await press(0, 220) // A reopens the detail focus just returned to
  const hid = await clickButton('Hide', '[data-jf-detail="1"] button')
  await waitFor(`!document.querySelector('[data-game-id="${card.focusCard}"]')`, 8000)
  const afterHide = await route()
  check(
    'hiding a game returns focus once its card is gone',
    hid && Boolean(afterHide.focusCard) && afterHide.focusCard !== card.focusCard,
    `hidden=${hid} detail=${afterHide.detail} focus=${afterHide.focusCard} was=${card.focusCard}`
  )

  // The console search grid is 10 keys wide, so a hold always has a neighbour;
  // a shelf can end mid-hold and stop producing steps.
  const beforeSearch = await route()
  const openedSearch = await clickButton('Search')
  if (!openedSearch) throw new Error(`Console search button not found — route=${JSON.stringify(await route())}`)
  await delay(700)
  await checkEntry('opening the search focuses its first content item')
  for (let attempt = 0; attempt < 12 && (await readFocus())?.label.length !== 1; attempt++) await key('ArrowDown')
  check('console search grid focused', await walk('ArrowLeft'), `focused=${(await readFocus())?.label}`)

  await timed('grid d-pad hold', () => press(15, 900))
  const gridFull = await timed('grid full-tilt stick', () => stick(1, 900))
  await feathered('grid', gridFull.moveGaps)

  await walk('ArrowLeft')
  await clearLog()
  await stick(0.62, 220)
  const tapMoves = (await readLog()).length
  check('stick tap is one step', tapMoves === 1, `moves=${tapMoves}`)

  const consoleShot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 85 })
  if (consoleShot.result?.data) {
    saveShot('verify-pad-console.jpg', consoleShot.result.data)
  }

  // ---- Back precedence and global commands -------------------------------
  // The console search is still open on top of console mode: B must close the
  // topmost layer only, never the screen underneath it.
  await press(1, 220) // B
  const searchClosed = await route()
  check(
    'B in console search closes only the search layer',
    !searchClosed.modal && searchClosed.console,
    `modal=${searchClosed.modal} console=${searchClosed.console}`
  )
  check(
    'closing the search restores the focus it covered',
    searchClosed.focusCard === beforeSearch.focusCard,
    `focus=${searchClosed.focusCard} expected=${beforeSearch.focusCard}`
  )

  await press(1, 220) // B
  const desktop = await route()
  check(
    'B exits console mode to the desktop',
    !desktop.console && !desktop.modal && desktop.view !== null,
    `console=${desktop.console} view=${desktop.view}`
  )

  // B is a no-op on Home, so repeated presses normalise the starting view.
  for (let attempt = 0; attempt < 3 && (await route()).view !== 'home'; attempt++) await press(1, 220)

  await press(5, 220) // RB
  const advanced = await route()
  check('RB advances to the next view', advanced.view === 'library', `view=${advanced.view}`)

  await press(1, 220) // B
  const homeAgain = await route()
  check('B closes the last view back to Home', homeAgain.view === 'home', `view=${homeAgain.view}`)

  await press(4, 220) // LB
  const wrappedBack = await route()
  check('LB wraps from the first view to the last', wrappedBack.view === 'stats', `view=${wrappedBack.view}`)

  await press(5, 220) // RB
  const wrappedForward = await route()
  check('RB wraps from the last view to the first', wrappedForward.view === 'home', `view=${wrappedForward.view}`)

  // Aim at sidebar chrome on purpose: it stays mounted (hidden) while console
  // mode is open, so exit must be able to return focus to it. A shelf can hold
  // more cards than a fixed number of presses covers, so step until the sidebar
  // actually owns focus instead of assuming a count.
  for (let attempt = 0; attempt < 24 && !(await evaluate("Boolean(document.querySelector('nav [data-nav-focus]'))")); attempt++) {
    await press(14, 220) // d-pad left, toward the sidebar
  }
  const beforeConsole = await readFocus()
  const consoleFromSidebar = await evaluate("Boolean(document.querySelector('nav [data-nav-focus]'))")
  await press(9, 220) // Start
  const consoleOn = await route()
  check('Start enters console mode', consoleOn.console, `console=${consoleOn.console}`)
  await checkChromeHidden('sidebar', 'nav')

  // Move inside the console first, so the exit must restore an element that is
  // not the one focus was on when the mode opened.
  await press(15, 220) // d-pad right
  await press(9, 220) // Start
  const consoleOff = await route()
  check('Start leaves console mode', !consoleOff.console, `console=${consoleOff.console}`)
  const afterConsole = await readFocus()
  check(
    'leaving console mode returns focus to the control that started it',
    consoleFromSidebar && sameFocus(afterConsole, beforeConsole),
    `from-sidebar=${consoleFromSidebar} focus=${afterConsole?.label}@${afterConsole?.x} expected=${beforeConsole?.label}@${beforeConsole?.x}`
  )

  // ---- Top-bar chrome survives console mode too --------------------------
  for (let attempt = 0; attempt < 4 && !(await evaluate("Boolean(document.querySelector('main [data-nav-focus]'))")); attempt++) {
    await press(15, 220) // right: sidebar → page
  }
  for (let attempt = 0; attempt < 20 && !(await evaluate("Boolean(document.querySelector('header [data-nav-focus]'))")); attempt++) {
    await press(12, 220) // up: page → top bar
  }
  const beforeTopBar = await readFocus()
  const consoleFromTopBar = await evaluate("Boolean(document.querySelector('header [data-nav-focus]'))")

  await press(9, 220) // Start in
  await checkChromeHidden('top bar', 'header')
  await press(15, 220) // move inside the console so exit has another origin
  await press(9, 220) // Start out
  const afterTopBar = await readFocus()
  check(
    'leaving console mode returns focus to top-bar chrome that started it',
    consoleFromTopBar && sameFocus(afterTopBar, beforeTopBar),
    `from-top-bar=${consoleFromTopBar} focus=${afterTopBar?.label}@${afterTopBar?.x} expected=${beforeTopBar?.label}@${beforeTopBar?.x}`
  )

  // ---- B inside a text field -------------------------------------------
  // The add-game dialog autofocuses its title field, so a pad B there must drop
  // the field and leave the dialog (and its contents) alone.
  const addGame = await clickButton('Add game')
  await delay(700)
  const field = await evaluate(`(() => {
    const input = document.querySelector('[data-jf-modal="1"] input')
    const own = document.activeElement === input
    input?.focus()
    return { tag: input?.tagName ?? null, own }
  })()`)
  await press(1, 220) // B
  const typingBlurred = await evaluate(`(() => ({
    modal: Boolean(document.querySelector('[data-jf-modal="1"]')),
    typing: ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')
  }))()`)
  check(
    'B drops the field and leaves the dialog open',
    Boolean(addGame) && field?.tag === 'INPUT' && field.own && typingBlurred.modal && !typingBlurred.typing,
    `field=${field?.tag} own-focus=${field?.own} modal=${typingBlurred.modal} typing=${typingBlurred.typing}`
  )
  await press(1, 220) // B
  const dialogClosed = await route()
  check('a second B closes the dialog', !dialogClosed.modal, `modal=${dialogClosed.modal}`)

  const complete = reportChecks(results, { expected: EXPECTED_CHECKS, subject: 'controller checks' })
  finishRun()

  const exited = app.exitCode === null ? new Promise((resolve) => app.once('exit', resolve)) : Promise.resolve()
  app.kill()
  await Promise.race([exited, delay(4000)])
  removeProfile()
  process.exit(complete ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
