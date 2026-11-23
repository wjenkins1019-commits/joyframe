#!/usr/bin/env node
/**
 * Exercises the packaged-build staleness guard with a throwaway tree, so the
 * failure path is tested without touching release/ or the real out/.
 *
 * The guard compares content, so a fixture package is built from real files:
 * a rebuild that produces identical bytes passes even when it is newer, and
 * any differing, added or missing file still fails.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { packagedBuildProblem } from './packaged-build.mjs'

const require = createRequire(import.meta.url)
const asarLib = require('@electron/asar')

const ROOT = fs.mkdtempSync('.freshness-check-')
const exe = path.join(ROOT, 'JOYFRAME.exe')
const asar = path.join(ROOT, 'resources', 'app.asar')
const out = path.join(ROOT, 'out')

/** Write a stub at a fixed time so ordering is deterministic. */
const write = (file, body, seconds) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  fs.utimesSync(file, seconds, seconds)
}

/** Package the current out/ so the archive holds out/<relative> entries. */
const pack = async () => {
  // electron-builder packages the project, so the archive holds out/ at its root.
  const staging = path.join(ROOT, 'staging')
  fs.rmSync(staging, { recursive: true, force: true })
  fs.cpSync(out, path.join(staging, 'out'), { recursive: true })
  fs.mkdirSync(path.dirname(asar), { recursive: true })
  fs.rmSync(asar, { force: true })
  await asarLib.createPackage(staging, asar)
  // electron-builder writes the asar after out/, so stamp it later than out.
  const seconds = 10_000
  fs.utimesSync(asar, seconds, seconds)
}

const problem = () => packagedBuildProblem({ exe, asar, out })
// Run the real exit path in a child so its status can be asserted without
// exiting the test process.
const guardUrl = pathToFileURL(path.resolve('scripts/packaged-build.mjs')).href
const runGuard = () =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { assertPackagedBuildFresh } from ${JSON.stringify(guardUrl)}; ` +
        `assertPackagedBuildFresh(${JSON.stringify({ exe, asar, out })})`
    ],
    { encoding: 'utf8' }
  )
const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  write(exe, 'stub', 1000)
  write(path.join(out, 'main', 'index.js'), 'first', 2000)
  write(path.join(out, 'renderer', 'index.html'), 'first', 2000)
  await pack()

  check('a package built from the current out/ passes', problem() === null, problem() ?? 'fresh')
  check('the guard exits zero on a matching package', runGuard().status === 0, `exit=${runGuard().status}`)

  // Identical bytes, newer mtimes: the rebuild `npm run check` performs.
  write(path.join(out, 'main', 'index.js'), 'first', 20_000)
  write(path.join(out, 'renderer', 'index.html'), 'first', 20_000)
  const rebuilt = problem()
  check('rebuilding identical bytes does not invalidate the package', rebuilt === null, rebuilt ?? 'fresh')
  check('the guard exits zero after an identical rebuild', runGuard().status === 0, `exit=${runGuard().status}`)

  // Changed content: even with an older timestamp this is a real difference.
  write(path.join(out, 'main', 'index.js'), 'second', 3000)
  const changed = problem()
  check(
    'a changed file is rejected with the remedy',
    Boolean(
      changed?.includes('Packaged build is stale') &&
        changed.includes('index.js') &&
        changed.includes('npm run dist')
    ),
    changed ?? 'no problem reported'
  )
  const staleExit = runGuard()
  check(
    'the guard exits non-zero on changed output',
    staleExit.status === 1 && staleExit.stderr.includes('Packaged build is stale'),
    `exit=${staleExit.status} stderr=${staleExit.stderr.trim().split(/\r?\n/)[0]}`
  )

  // A file the package does not contain at all.
  write(path.join(out, 'main', 'extra.js'), 'new', 4000)
  const added = problem()
  check(
    'a file missing from the package is rejected by name',
    Boolean(added?.includes('extra.js') && added.includes('missing from')),
    added ?? 'no problem reported'
  )

  fs.rmSync(out, { recursive: true, force: true })
  const missing = problem()
  check('a missing out/ fails clearly', Boolean(missing?.includes('out is missing')), missing ?? 'no problem reported')

  fs.rmSync(asar, { force: true })
  const noPackage = packagedBuildProblem({ exe, asar, out: OUT_FIXTURE() })
  check('a missing package fails clearly', Boolean(noPackage?.includes('app.asar is missing')), noPackage ?? 'no problem reported')
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true })
}

function OUT_FIXTURE() {
  fs.mkdirSync(out, { recursive: true })
  return out
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} freshness checks passed.`)
process.exit(failed ? 1 : 0)
