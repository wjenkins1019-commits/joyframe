/**
 * A deliberately broken probe for scripts/self-test.mjs.
 *
 * Each mode calls one guard from cdp.mjs or packaged-build.mjs and then ends in
 * the way that guard is supposed to end: a shortened list exits 1, a missing
 * prerequisite and a busy port exit 2, an unsettled run exits 13, a drained run
 * exits 0, and a stale package is refused. The self-test asserts those endings,
 * so a guard that stops working fails the suite instead of quietly passing
 * everything.
 *
 * Run through node, never imported:
 *
 *   node scripts/fixtures/guard-fixture.mjs <mode> [workdir]
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { preflight, reportChecks, reportUnfinishedRun } from '../cdp.mjs'
import { assertBuildFresh, writeBuildStamp } from '../build-fresh.mjs'
import { assertPackagedBuildFresh } from '../packaged-build.mjs'

const require = createRequire(import.meta.url)
const asarLib = require('@electron/asar')

const [mode, work] = process.argv.slice(2)

if (mode === 'short-list') {
  // A probe that skipped a block: two checks out of three.
  const complete = reportChecks(
    [
      { name: 'first', ok: true, detail: 'ok' },
      { name: 'second', ok: true, detail: 'ok' }
    ],
    { expected: 3, subject: 'guard checks' }
  )
  process.exit(complete ? 0 : 1)
}

if (mode === 'complete-list') {
  const complete = reportChecks(
    [
      { name: 'first', ok: true, detail: 'ok' },
      { name: 'second', ok: true, detail: 'ok' }
    ],
    { expected: 2, subject: 'guard checks' }
  )
  process.exit(complete ? 0 : 1)
}

if (mode === 'missing-prereq') {
  await preflight({
    label: 'guard-fixture',
    needs: [{ file: 'C:/definitely-not-here/JOYFRAME.exe', remedy: 'Run `npm run nope` to fix this.' }]
  })
  process.exit(0)
}

if (mode === 'busy-port') {
  // Hold the port from this process so preflight sees something accepting.
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await preflight({ label: 'guard-fixture', port: server.address().port, portVariable: 'JF_FIXTURE_PORT' })
  process.exit(0)
}

if (['stale-build', 'stale-config', 'fresh-build', 'missing-stamp'].includes(mode)) {
  if (!work) throw new Error(`${mode} needs a work directory`)
  const root = path.join(work, mode)
  // Both inputs the real build stamps: the src/ tree and the Vite config.
  const src = path.join(root, 'src')
  const config = path.join(root, 'electron.vite.config.ts')
  const out = path.join(root, 'out')
  const stamp = path.join(root, '.build-stamp.json')
  const inputs = [src, config]
  fs.mkdirSync(path.join(src, 'main'), { recursive: true })
  fs.writeFileSync(path.join(src, 'main', 'index.ts'), 'the source the build was made from')
  fs.writeFileSync(config, 'export default {}')
  fs.mkdirSync(out, { recursive: true })
  if (mode !== 'missing-stamp') writeBuildStamp({ inputs, out, stamp })
  // The edit nobody rebuilt: out/ now predates its inputs and must not be trusted.
  if (mode === 'stale-build') fs.writeFileSync(path.join(src, 'main', 'index.ts'), 'an edit after the build')
  if (mode === 'stale-config') fs.writeFileSync(config, 'export default { aliases: { patched: true } }')
  assertBuildFresh({ label: 'guard-fixture', inputs, out, stamp })
  process.exit(0)
}

if (mode === 'unfinished') {
  // The window vanished mid-probe: the await never settles, so Node ends with 13.
  reportUnfinishedRun('guard-fixture')
  await new Promise(() => {})
}

if (mode === 'silent-zero') {
  // Drained event loop: Node ends with 0 without the probe printing anything.
  reportUnfinishedRun('guard-fixture')
  process.exit(0)
}

if (mode === 'finished') {
  // A probe that reported its own failure must not be second-guessed.
  const done = reportUnfinishedRun('guard-fixture')
  done()
  process.exit(1)
}

if (mode === 'stale-asar') {
  if (!work) throw new Error('stale-asar needs a work directory')
  // Same layout electron-builder produces, with the package one edit behind out/.
  const out = path.join(work, 'out')
  const staging = path.join(work, 'staging')
  const exe = path.join(work, 'pkg', 'JOYFRAME.exe')
  const asar = path.join(work, 'pkg', 'resources', 'app.asar')
  fs.mkdirSync(path.join(out, 'main'), { recursive: true })
  fs.writeFileSync(path.join(out, 'main', 'index.js'), 'the current build')
  fs.mkdirSync(path.join(staging, 'out', 'main'), { recursive: true })
  fs.writeFileSync(path.join(staging, 'out', 'main', 'index.js'), 'an older build')
  fs.mkdirSync(path.dirname(asar), { recursive: true })
  await asarLib.createPackage(staging, asar)
  fs.writeFileSync(exe, 'stub')
  assertPackagedBuildFresh({ exe, asar, out })
  process.exit(0)
}

throw new Error(`unknown guard-fixture mode ${JSON.stringify(mode)}`)
