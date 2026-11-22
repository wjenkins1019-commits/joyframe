#!/usr/bin/env node
/**
 * Exercises the packaged-build staleness guard with a throwaway tree, so the
 * failure path is tested without touching release/ or the real out/.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { packagedBuildProblem } from './packaged-build.mjs'

const ROOT = fs.mkdtempSync('.freshness-check-')
const exe = path.join(ROOT, 'JOYFRAME.exe')
const asar = path.join(ROOT, 'resources', 'app.asar')
const out = path.join(ROOT, 'out')
const output = path.join(out, 'renderer', 'index.html')

/** Write a stub at a fixed time so the ordering is deterministic. */
const write = (file, seconds) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'stub')
  fs.utimesSync(file, seconds, seconds)
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
  write(exe, 1000)
  write(asar, 2000)
  write(output, 3000)
  const stale = problem()
  check(
    'a newer out/ file is rejected with the remedy',
    Boolean(stale?.includes('Packaged build is stale') && stale.includes('index.html') && stale.includes('npm run dist')),
    stale ?? 'no problem reported'
  )

  const staleExit = runGuard()
  check(
    'the guard exits non-zero on stale output',
    staleExit.status === 1 && staleExit.stderr.includes('Packaged build is stale'),
    `exit=${staleExit.status} stderr=${staleExit.stderr.trim().split(/\r?\n/)[0]}`
  )

  write(asar, 4000)
  const fresh = problem()
  check('a package written after out/ passes', fresh === null, fresh ?? 'fresh')
  const freshExit = runGuard()
  check('the guard exits zero on a fresh package', freshExit.status === 0, `exit=${freshExit.status}`)

  fs.rmSync(out, { recursive: true, force: true })
  const missing = problem()
  check('a missing out/ fails clearly', Boolean(missing?.includes('out is missing')), missing ?? 'no problem reported')
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true })
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} freshness checks passed.`)
process.exit(failed ? 1 : 0)
