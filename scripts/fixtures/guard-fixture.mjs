/**
 * A deliberately broken probe for scripts/self-test.mjs.
 *
 * Each mode calls one guard from cdp.mjs, build-fresh.mjs or packaged-build.mjs
 * and then ends in the way that guard is supposed to end: a shortened list
 * exits 1, a missing prerequisite, a busy port and a stale build exit 2, an
 * unsettled run exits 13, a drained run exits 0, and a stale package is
 * refused. The self-test asserts those endings, so a guard that stops working
 * fails the suite instead of quietly passing everything.
 *
 * Run through node, never imported:
 *
 *   node scripts/fixtures/guard-fixture.mjs <mode> [workdir]
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { preflight, reportChecks, reportCrash, reportUnfinishedRun, waitForValue } from '../cdp.mjs'
import { assertBuildFresh, writeBuildStamp } from '../build-fresh.mjs'
import { assertPackagedBuildFresh } from '../packaged-build.mjs'

const require = createRequire(import.meta.url)
const asarLib = require('@electron/asar')

const [mode, work] = process.argv.slice(2)

/** The names a complete probe reports; a pass must match them exactly. */
const GUARD_CHECKS = ['first', 'second', 'third']
const guardResults = (names) => names.map((name) => ({ name, ok: true, detail: 'ok' }))

if (mode === 'crash') {
  // A probe that dies before reportChecks: no PASS/FAIL list, only the error.
  reportCrash({
    subject: 'guard checks',
    error: new Error('the app window never opened'),
    artifacts: ['guard-artifact-attempt-1']
  })
  process.exit(1)
}

if (mode === 'failed-check') {
  // A red check whose detail contains a pipe, plus the artifact the job uploads.
  const complete = reportChecks(
    [
      { name: 'first', ok: true, detail: 'ok' },
      { name: 'second', ok: false, detail: 'pad 1 | stuck at 0.5' }
    ],
    {
      expected: ['first', 'second'],
      subject: 'guard checks',
      artifacts: ['guard-artifact-attempt-1'],
      firstFailure: {
        route: 'view=home console=false detail=false modal=false',
        focus: 'Scan library at x=1180',
        controller: 'pinned=true pads=0*,1 mapping=standard last=D-pad down checks=3/14',
        screenshot: 'guard-failure.jpg',
        readErrors: []
      }
    }
  )
  process.exit(complete ? 0 : 1)
}

if (mode === 'many-failures') {
  // More failures than GitHub's ten-annotation step limit.
  const names = Array.from({ length: 12 }, (_, index) => `guard ${String(index + 1).padStart(2, '0')}`)
  const complete = reportChecks(
    names.map((name, index) => ({ name, ok: false, detail: `forced failure ${String(index + 1).padStart(2, '0')}` })),
    { expected: names, subject: 'guard checks', artifacts: ['guard-artifact-attempt-1'] }
  )
  process.exit(complete ? 0 : 1)
}

if (mode === 'short-list') {
  // A probe that skipped a block: two of the three declared checks ran.
  const complete = reportChecks(guardResults(GUARD_CHECKS.slice(0, 2)), {
    expected: GUARD_CHECKS,
    subject: 'guard checks'
  })
  process.exit(complete ? 0 : 1)
}

if (mode === 'complete-list') {
  const complete = reportChecks(guardResults(GUARD_CHECKS.slice(0, 2)), {
    expected: GUARD_CHECKS.slice(0, 2),
    subject: 'guard checks'
  })
  process.exit(complete ? 0 : 1)
}

if (mode === 'renamed-list') {
  // A check renamed without renaming it in the declaration: same count, new name.
  const renamed = [...guardResults(GUARD_CHECKS.slice(0, 1)), { name: 'renamed', ok: true, detail: 'ok' }]
  const complete = reportChecks(renamed, { expected: GUARD_CHECKS.slice(0, 2), subject: 'guard checks' })
  process.exit(complete ? 0 : 1)
}

if (mode === 'missing-prereq') {
  await preflight({
    label: 'guard-fixture',
    needs: [{ file: 'C:/definitely-not-here/JOYFRAME.exe', remedy: 'Run `npm run nope` to fix this.' }]
  })
  process.exit(0)
}

/**
 * A clock that moves only when something sleeps on it, so a wait budget of
 * seconds costs no real time. Returning a value here is the only way the two
 * slow-bridge modes can end, which is what makes them evidence.
 */
function virtualClock() {
  let elapsed = 0
  return {
    clock: {
      now: () => elapsed,
      sleep: async (ms) => {
        elapsed += ms
      }
    },
    elapsed: () => elapsed
  }
}

if (mode === 'late-bridge') {
  // The bridge a cold launch withholds for ten seconds. The poll must still be
  // running at the ten-second mark and return the value, not give up first.
  const { clock, elapsed } = virtualClock()
  const value = await waitForValue(
    async () => {
      // The reload that precedes the bridge destroys the execution context.
      if (elapsed() < 5000) throw new Error('Execution context was destroyed')
      return elapsed() < 10000 ? null : 'bridge'
    },
    'window.joyframe?.settings',
    { timeout: 30000, clock }
  )
  console.log(`late bridge: value=${value} waited=${elapsed()}ms`)
  process.exit(value === 'bridge' ? 0 : 1)
}

if (mode === 'never-bridge') {
  // Nothing ever appears: the wait must end at its deadline with null, so the
  // probe reports what never showed up instead of hanging.
  const { clock, elapsed } = virtualClock()
  const value = await waitForValue(async () => null, 'window.joyframe?.settings', { timeout: 30000, clock })
  console.log(`missing bridge: value=${value} waited=${elapsed()}ms`)
  process.exit(value === null ? 0 : 1)
}

if (mode === 'busy-port') {
  // Hold the port from this process so preflight sees something accepting.
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await preflight({ label: 'guard-fixture', port: server.address().port, portVariable: 'JF_FIXTURE_PORT' })
  process.exit(0)
}

if (
  [
    'stale-build',
    'stale-config',
    'stale-package',
    'stale-resources',
    'stale-tsconfig',
    'fresh-build',
    'missing-stamp'
  ].includes(mode)
) {
  if (!work) throw new Error(`${mode} needs a work directory`)
  const root = path.join(work, mode)
  fs.mkdirSync(root, { recursive: true })
  // The guard uses fixed paths, so the fixture becomes the project for this run.
  process.chdir(root)
  const FILES = {
    'src/main/index.ts': 'the source the build was made from',
    'electron.vite.config.ts': 'export default {}',
    'package.json': '{"dependencies":{"electron":"1.0.0"}}\n',
    'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
    'tsconfig.node.json': '{"compilerOptions":{"target":"es2022"}}',
    'tsconfig.web.json': '{"compilerOptions":{"target":"es2022"}}',
    'resources/splash.svg': '<svg><!-- the splash the package ships --></svg>'
  }
  // The edit nobody rebuilt: out/ now predates its inputs and must not be trusted.
  const EDITS = {
    'stale-build': ['src/main/index.ts', 'an edit after the build'],
    'stale-config': ['electron.vite.config.ts', 'export default { aliases: { patched: true } }'],
    // A dependency change with no rebuild: src/ and the config are untouched.
    'stale-package': ['package.json', '{"dependencies":{"electron":"2.0.0"}}\n'],
    // An asset the package ships, changed with no rebuild: the bundle is identical.
    'stale-resources': ['resources/splash.svg', '<svg><!-- an edit with no rebuild --></svg>'],
    // A compiler setting the build consumed, changed with no rebuild.
    'stale-tsconfig': ['tsconfig.web.json', '{"compilerOptions":{"target":"es2019"}}']
  }
  for (const [file, contents] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  fs.mkdirSync('out', { recursive: true })
  if (mode !== 'missing-stamp') writeBuildStamp()
  if (EDITS[mode]) fs.writeFileSync(...EDITS[mode])
  assertBuildFresh({ label: 'guard-fixture' })
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
