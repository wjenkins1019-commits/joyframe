/**
 * Shared Chrome DevTools Protocol plumbing for the packaged-build verifiers.
 *
 * Both verify-dist and verify-first-run boot release/win-unpacked/JOYFRAME.exe
 * with --remote-debugging-port and drive the real renderer, so window discovery,
 * the socket, evaluation and console capture live here only once.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** How long one DevTools command may go unanswered before the probe gives up. */
const CALL_TIMEOUT_MS = 30000

/**
 * A probe that never reaches its summary must say so. Node ends an unsettled
 * top-level await with exit code 13 and a bare warning, which is indistinguishable
 * from a silent failure inside `npm run check`, and a probe that drains its event
 * loop can end with 0. Both would otherwise pass for a truncated run.
 *
 * Call the returned function once the probe has printed its result.
 */
export function reportUnfinishedRun(label) {
  let finished = false
  process.on('exit', (code) => {
    // A thrown error already explains itself; only unannounced endings need this.
    if (finished || (code !== 0 && code !== 13)) return
    fs.writeSync(
      2,
      `\n${label} ended with exit code ${code} before printing its result — the run did not finish.\n` +
        'The app window most likely closed or exited while a probe was waiting on it.\n'
    )
  })
  return () => {
    finished = true
  }
}

/** Exit code for a run the machine was not ready for, as opposed to a regression. */
export const EXIT_NOT_READY = 2

/** Where each probe keeps the app output from its last run (gitignored). */
const LOG_DIR = '.verify-logs'

/**
 * Capture what the app itself prints, once per probe run.
 *
 * Probes boot the app with its output discarded, so a failure showed only the
 * probe's last reading while the app's own reason (`EPERM`, a crashed renderer,
 * a second instance quitting) was lost. This opens `.verify-logs/<name>.log` at
 * start, hands the same handle to every launch in the run, and prints the tail
 * from an exit hook when the run ends non-zero — a thrown probe, a failed
 * summary and an unfinished run all reach it. The full log stays on disk.
 *
 * The log is opened on the first launch rather than up front, so a run that
 * never boots the app (a preflight refusal, a setup assertion that threw first)
 * leaves the previous run's log intact instead of truncating it or reporting a
 * tail this run did not produce. Nothing else is needed from the caller: the
 * child writes straight to the fd, so the file is current without a flush, and
 * the handle closes with the process.
 */
export function createAppLog(name, { lines = 40 } = {}) {
  const file = path.join(LOG_DIR, `${name}.log`)
  let fd = null

  process.on('exit', (code) => {
    // No app was launched, or the run passed and a refused preflight (2) never
    // reached the app: there is no output to show.
    if (fd === null || code === 0 || code === EXIT_NOT_READY) return
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    // The exit hook can run while npm is still draining a pipe, so write directly.
    if (!text.trim()) {
      fs.writeSync(1, `\nThe app printed nothing — ${file} is empty.\n`)
      return
    }
    const rows = text.replace(/\s+$/, '').split('\n')
    const tail = rows.slice(-lines)
    fs.writeSync(
      1,
      `\nApp output — ${file} (last ${tail.length} of ${rows.length} lines):\n${tail.join('\n')}\n`
    )
  })

  return {
    /** Pass to spawn as `{ stdio: appLog.stdio }`; opens the log on first launch. */
    get stdio() {
      if (fd === null) {
        fs.mkdirSync(LOG_DIR, { recursive: true })
        fd = fs.openSync(file, 'w')
      }
      return ['ignore', fd, fd]
    }
  }
}

/** True when something already accepts connections on the loopback port. */
function portIsInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const settle = (inUse) => {
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(500, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

/** Remedies for the prerequisites probes share, phrased as the command that fixes each. */
export const MISSING_ELECTRON = 'Run `npx install-electron` (Electron ships no binary without it), then retry.'
export const MISSING_PACKAGED = 'Run `npm run dist` to package the app, then retry.'
const MISSING_BUILD = 'Run `npm run build` to produce out/, then retry.'

/**
 * What every probe that boots the dev build needs before it can start. Shared
 * so a probe cannot drift into checking a different set of files. Read-only.
 */
export const DEV_BOOT_NEEDS = [
  { file: 'node_modules/electron/dist/electron.exe', remedy: MISSING_ELECTRON },
  { file: 'out/main/index.js', remedy: MISSING_BUILD },
  { file: 'out/renderer/index.html', remedy: MISSING_BUILD }
]

/**
 * The short list of conditions a probe cannot boot without. They are states of
 * the machine rather than changes in the app — a missing build or Electron
 * binary, and a debugging port a leftover instance still holds — so they exit
 * with EXIT_NOT_READY and the fix, leaving exit 1 to mean the build regressed.
 */
export async function preflight({ label, needs = [], port, portVariable = 'JF_DEBUG_PORT' }) {
  const notReady = (reason, remedy) => {
    fs.writeSync(2, `\n${label}: environment not ready — ${reason}\n${remedy}\n`)
    process.exit(EXIT_NOT_READY)
  }

  for (const need of needs) {
    if (!fs.existsSync(need.file)) notReady(`${need.file} is missing.`, need.remedy)
  }

  if (port && (await portIsInUse(port))) {
    notReady(
      `port ${port} is already accepting connections — a leftover JOYFRAME instance is the usual cause.`,
      `Close that window (or whatever holds the port), or run again with a different ${portVariable}.`
    )
  }
}

/** Artifact names a workflow step exports for the failure summary. */
export function failureArtifacts() {
  return (process.env.JF_FAILURE_ARTIFACTS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

/** Escape a workflow-command payload; properties also escape `:` and `,`. */
const escapeCommand = (text, property = false) => {
  const escaped = String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  return property ? escaped.replace(/:/g, '%3A').replace(/,/g, '%2C') : escaped
}

/** Summary lines are one line each; a probe's detail may carry a newline. */
const oneLine = (text) => String(text).replace(/\r?\n/g, ' ')

/** GitHub Actions renders at most ten error annotations from one step. */
const ANNOTATION_LIMIT = 10

/** One value in a summary code span; a backtick would end the span. */
const code = (text) => `\`${oneLine(text).replace(/`/g, "'")}\``

/** A compact record of the state the first failed check saw. */
const firstFailureNote = (firstFailure) => {
  if (!firstFailure) return []
  const lines = ['First failure state:', '']
  if (firstFailure.error) {
    lines.push(`- Capture: failed — ${oneLine(firstFailure.error)}`)
  } else {
    lines.push(`- Route: ${code(firstFailure.route ?? 'unavailable')}`)
    lines.push(`- Focus: ${code(firstFailure.focus ?? 'none')}`)
    lines.push(`- Controller: ${code(firstFailure.controller ?? 'unavailable')}`)
    lines.push(`- Screenshot: ${code(firstFailure.screenshot ?? 'unavailable')}`)
  }
  if (firstFailure.readErrors?.length) {
    lines.push(`- State reads failed: ${firstFailure.readErrors.map(oneLine).join('; ')}`)
  }
  lines.push('')
  return lines
}

/** Append one section to the job summary, when this step has one. */
function appendSummary(lines) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (!summaryFile) return
  try {
    fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`)
  } catch (error) {
    console.error(`Could not append to the job summary — ${error.message}`)
  }
}

/** The artifacts this job uploads for the failure, as summary lines. */
const artifactNote = (artifacts) =>
  artifacts.length
    ? [`Artifacts uploaded for this failure: ${artifacts.map((name) => `\`${name}\``).join(', ')}`, '']
    : []

/**
 * Make a red probe readable from the run page.
 *
 * Annotations put each failed check in the run's annotations view, and the job
 * summary keeps the same list beside the artifacts the job uploads, so triage
 * does not begin with a download. A broad failure keeps the first nine
 * annotations and adds one aggregate line; GitHub accepts only ten error
 * annotations from one step, while the summary lists every failure. Both are
 * written only inside Actions; a local run keeps its plain output. A failed
 * summary write is reported but never changes the probe's verdict.
 */
function reportFailure({ subject, total, failed, problems, artifacts, firstFailure = null }) {
  const annotations = []
  if (problems.length) {
    annotations.push({
      kind: 'problems',
      title: `${subject} did not match its declared list`,
      message: problems.join('. ')
    })
  }
  for (const result of failed) {
    annotations.push({ kind: 'failed', title: result.name, message: result.detail ?? '' })
  }

  let shown = annotations
  let truncated = false
  if (process.env.GITHUB_ACTIONS === 'true' && annotations.length > ANNOTATION_LIMIT) {
    truncated = true
    const visible = annotations.slice(0, ANNOTATION_LIMIT - 1)
    const hidden = annotations.length - visible.length
    shown = [
      ...visible,
      {
        kind: 'aggregate',
        title: `${subject} — ${hidden} more failed checks`,
        message: `The job summary lists all ${failed.length} failed ${subject}${problems.length ? ' and the declared-list problem' : ''}.`
      }
    ]
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const annotation of shown) {
      console.log(
        `::error title=${escapeCommand(annotation.title, true)}::${escapeCommand(annotation.message)}`
      )
    }
  }

  const lines = [
    failed.length ? `## ${subject} — ${failed.length} of ${total} failed` : `## ${subject} — run incomplete`,
    ''
  ]
  for (const result of failed) {
    lines.push(`- **${oneLine(result.name)}** — ${oneLine(result.detail ?? '')}`)
  }
  if (failed.length) lines.push('')
  lines.push(...firstFailureNote(firstFailure))
  if (problems.length) {
    lines.push('The run does not match its declared check list:', '')
    for (const problem of problems) lines.push(`- ${problem}`)
    lines.push('')
  }
  if (truncated) {
    const shownFailed = shown.filter((annotation) => annotation.kind === 'failed').length
    lines.push(
      `Only ${shownFailed} of ${failed.length} failed checks fit in the run-page annotations; the aggregate reports the remainder. This list is complete.`,
      ''
    )
  }
  lines.push(...artifactNote(artifacts))
  appendSummary(lines)
}

/**
 * Record a probe that threw before reportChecks ran.
 *
 * The job still fails, but with no result list there is nothing for
 * reportFailure to write and the run page shows only the raw log. Emit the
 * error as an annotation and a summary naming the artifacts the job uploads,
 * so an early crash is triaged like any other red run.
 */
export function reportCrash({ subject, error, artifacts = [] }) {
  const message = error instanceof Error ? error.message : String(error)
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::error title=${escapeCommand(`${subject} failed before reporting`, true)}::${escapeCommand(message)}`)
  }
  const lines = [`## ${subject} — run failed before reporting`, '', `> ${oneLine(message)}`, '']
  lines.push(...artifactNote(artifacts))
  appendSummary(lines)
}

/**
 * Print a probe's checks and hold the run to the list the suite declares.
 *
 * A probe that skips a block — an early `return`, a loop that never ran its
 * body — has no way to notice on its own, and its `x/x passed` summary then
 * reads as a full pass. Comparing the reported names against `expected` catches
 * that, and catches a renamed check too: a rename has to be made in the
 * declaration as well, instead of quietly shifting a count.
 *
 * A red run annotates up to ten failures (GitHub's per-step limit) and appends
 * them, the first failure's captured state and the artifact names the caller
 * passes to the job summary. See reportFailure.
 *
 * Returns true only when exactly the declared checks ran and every check passed.
 */
export function reportChecks(results, { expected, subject, artifacts = [], firstFailure = null }) {
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
  }
  const ran = new Set(results.map((result) => result.name))
  const missing = expected.filter((name) => !ran.has(name))
  const undeclared = [...ran].filter((name) => !expected.includes(name))
  const failed = results.filter((result) => !result.ok)
  const problems = []
  if (missing.length) {
    problems.push(`${missing.length} of ${expected.length} declared ${subject} never ran: ${missing.join(' | ')}`)
  }
  if (undeclared.length) problems.push(`undeclared ${subject} ran: ${undeclared.join(' | ')}`)
  if (problems.length) {
    console.log(`\nFAIL  ${problems.join('. ')}. The run does not match its declared check list.`)
  } else {
    console.log(`\n${results.length - failed.length}/${results.length} ${subject} passed.`)
  }
  if (failed.length || problems.length) {
    reportFailure({ subject, total: results.length, failed, problems, artifacts, firstFailure })
  }
  return failed.length === 0 && problems.length === 0
}

/**
 * Minimal CDP client over the built-in WebSocket (Node 22+).
 *
 * Every call settles: if the app's window goes away the socket closes, and an
 * unresolved command would otherwise leave the awaiting probe hanging until Node
 * exits with a bare code 13. Closing the socket fails the calls in flight with
 * the reason, and a command that is never answered times out, so a probe reports
 * which app and which stage went quiet instead of ending silently.
 */
export async function connect(debuggerUrl) {
  const socket = new WebSocket(debuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools websocket refused')), { once: true })
  })
  // The app drops this socket on exit; that is expected, not a failure.
  socket.addEventListener('error', () => undefined)

  const pending = new Map()
  const events = []
  let nextId = 0
  let closed = null

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) {
      events.push(message)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve(message)
  })

  socket.addEventListener('close', () => {
    closed = 'the app closed the DevTools connection (its window closed or the process exited)'
    if (!pending.size) return
    // Name the cause on stderr too: probes that tolerate transient reload errors
    // catch the rejection, and the reason would be lost with it.
    fs.writeSync(2, `\n[cdp] ${closed} while ${pending.size} command(s) were in flight.\n`)
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(closed))
    }
    pending.clear()
  })

  return {
    events,
    close: () => socket.close(),
    call: (method, params = {}, timeout = CALL_TIMEOUT_MS) => {
      if (closed) return Promise.reject(new Error(`DevTools ${method} never ran: ${closed}`))
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => {
          pending.delete(id)
          fs.writeSync(2, `\n[cdp] ${method} went unanswered for ${timeout}ms.\n`)
          reject(new Error(`DevTools did not answer ${method} within ${timeout}ms — the renderer stopped responding`))
        }, timeout)
        // The timeout is a failure report, not work worth keeping the process alive for.
        timer.unref?.()
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}

/** One app window is expected; the packaged build may spend a moment starting up. */
export async function findWindow(port) {
  for (let attempt = 0; attempt < 80; attempt++) {
    await delay(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = list.find((entry) => entry.type === 'page' && entry.url.includes('index.html'))
      if (target) return target
    } catch {
      /* still starting */
    }
  }
  return null
}

/**
 * Connect to a window with console capture enabled, reload so the capture
 * covers the whole boot rather than the tail after the window appeared, and
 * return `evaluate` plus `read` for probing the rendered page. Pass
 * `{ reload: false }` when the test is about what the first load does — a
 * reload would spend a one-shot startup ident before it can be observed.
 */
export async function createSession(target, { reload = true } = {}) {
  const { call, close, events } = await connect(target.webSocketDebuggerUrl)
  await call('Runtime.enable')
  await call('Log.enable')
  await call('Page.enable')
  if (reload) await call('Page.reload')

  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails))
    return response.result?.result?.value
  }

  /**
   * Poll `expression` until `ready` accepts its value. Reloads make the probe
   * throw briefly; the error is kept and rethrown when nothing ever renders, so
   * a broken probe fails instead of timing out silently.
   */
  const read = async (expression, ready, timeout = 20000) => {
    const deadline = Date.now() + timeout
    let value = null
    let error = null
    while (Date.now() < deadline) {
      try {
        value = await evaluate(expression)
        error = null
      } catch (thrown) {
        error = thrown
      }
      if (value && ready(value)) return value
      await delay(150)
    }
    if (!value && error) throw error
    return value
  }

  return { call, close, events, evaluate, read }
}

/** Renderer console warnings, errors and exceptions captured during a boot. */
export function consoleProblems(events, label = '') {
  const problems = []
  const prefix = label ? `${label} ` : ''
  for (const event of events) {
    if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(event.params.type)) {
      const text = event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
      problems.push(`${prefix}console.${event.params.type}: ${text}`)
    } else if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params.entry.level)) {
      problems.push(`${prefix}log.${event.params.entry.level}: ${event.params.entry.text}`)
    } else if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails
      problems.push(`${prefix}exception: ${details.exception?.description ?? details.text}`)
    }
  }
  return problems
}

/** Remove a throwaway profile; Windows may keep files locked briefly after exit. */
export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    /* still locked — retried on the next run */
  }
}
