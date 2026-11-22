/**
 * Shared Chrome DevTools Protocol plumbing for the packaged-build verifiers.
 *
 * Both verify-dist and verify-first-run boot release/win-unpacked/JOYFRAME.exe
 * with --remote-debugging-port and drive the real renderer, so window discovery,
 * the socket, evaluation and console capture live here only once.
 */
import fs from 'node:fs'

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Minimal CDP client over the built-in WebSocket (Node 22+). */
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else {
      events.push(message)
    }
  })

  return {
    events,
    call: (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++nextId
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, method, params }))
      })
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
 * return `evaluate` plus `read` for probing the rendered page.
 */
export async function createSession(target) {
  const { call, events } = await connect(target.webSocketDebuggerUrl)
  await call('Runtime.enable')
  await call('Log.enable')
  await call('Page.enable')
  await call('Page.reload')

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

  return { events, evaluate, read }
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
