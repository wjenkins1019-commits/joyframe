/**
 * The controller probe's own minimal CDP client over the built-in WebSocket
 * (Node 22+).
 *
 * Every call settles. If the app's window goes away the socket closes, and a
 * command left pending would otherwise drain the event loop and end the run
 * with 0 — a silent green — instead of reporting the app that vanished.
 *
 * It lives here rather than inline in verify-pad.mjs so scripts/fixtures can
 * drive it: the reason it hands a rejected call is what a probe prints, and
 * nothing else exercises this client without launching the app.
 *
 *   node scripts/verify-pad.mjs
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
  let nextId = 0
  let closed = null
  // Why the probe asked for the close, when it did. The probe kills the app as
  // its run ends, so that close is the probe's own doing, not a lost app.
  let closing = null
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve(message)
  })
  socket.addEventListener('close', () => {
    closed = closing ?? 'the app closed the DevTools connection (its window closed or the process exited)'
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
  call.expectClose = () => {
    closing = 'the probe killed the app to end the run'
  }
  return call
}
