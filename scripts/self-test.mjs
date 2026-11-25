#!/usr/bin/env node
/**
 * Self-test for the suite's own guards.
 *
 * The probes are only trustworthy if the machinery that makes a short or silent
 * run fail still fails: the declared check list, the exit-2 preflight, the
 * build-freshness stamp, the unfinished-run hook and the packaged-build guard.
 * Those paths are otherwise exercised by hand, once, and never again — so a
 * guard that quietly stopped working would read as a green suite.
 *
 *   npm run self-test
 *
 * Each case runs scripts/fixtures/guard-fixture.mjs in a child process and
 * asserts the exit code and the message it prints, so no guard has to be broken
 * in a real probe to prove the reporting still works. `npm run verify:freshness`
 * remains the deeper matrix for the build comparison; this only proves its
 * failure path is still reached.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const FIXTURE = path.join('scripts', 'fixtures', 'guard-fixture.mjs')
const ROOT = fs.mkdtempSync('.self-test-')
const STALE = 'out/ is older than the files it was built from'

/** One input edited after the build: the guard must name it and the remedy. */
const STALE_CASES = [
  ['stale-build', 'a src/ edit', 'main/index.ts'],
  ['stale-config', 'a config-only edit', 'electron.vite.config.ts'],
  ['stale-package', 'a package.json-only edit', 'package.json'],
  ['stale-resources', 'a resources-only edit', 'resources/splash.svg'],
  ['stale-tsconfig', 'a tsconfig-only edit', 'tsconfig.web.json']
].map(([mode, what, file]) => ({
  mode,
  name: `${what} makes out/ stale, naming the file and the remedy`,
  exit: 2,
  stderr: [STALE, file, 'npm run build']
}))

/** mode, expected exit code, and text/counts that must (not) appear on each stream. */
const CASES = [
  {
    mode: 'short-list',
    name: 'a dropped check fails by name instead of printing a pass',
    exit: 1,
    stdout: ['FAIL  1 of 3 declared guard checks never ran: third']
  },
  {
    mode: 'short-list',
    name: 'an incomplete run is annotated and summarized for the run page',
    exit: 1,
    env: { GITHUB_ACTIONS: 'true' },
    stdout: [
      '::error title=guard checks did not match its declared list::1 of 3 declared guard checks never ran: third'
    ],
    summary: ['## guard checks — run incomplete', '1 of 3 declared guard checks never ran: third']
  },
  {
    mode: 'crash',
    name: 'a probe that throws before reporting is annotated and summarized',
    exit: 1,
    env: { GITHUB_ACTIONS: 'true' },
    stdout: ['::error title=guard checks failed before reporting::the app window never opened'],
    summary: [
      '## guard checks — run failed before reporting',
      '> the app window never opened',
      '`guard-artifact-attempt-1`'
    ]
  },
  {
    mode: 'failed-check',
    name: 'a failed check is annotated and summarized with its artifact',
    exit: 1,
    env: { GITHUB_ACTIONS: 'true' },
    stdout: ['::error title=second::pad 1 | stuck at 0.5'],
    summary: [
      '## guard checks — 1 of 2 failed',
      '- **second** — pad 1 | stuck at 0.5',
      'First failure state:',
      '- Route: `view=home console=false detail=false modal=false`',
      '- Focus: `Scan library at x=1180`',
      '- Controller: `pinned=true pads=0*,1 mapping=standard last=D-pad down checks=3/14`',
      '- Screenshot: `guard-failure.jpg`',
      '`guard-artifact-attempt-1`'
    ]
  },
  {
    mode: 'many-failures',
    name: 'annotations cap at ten and name the rest in an aggregate line',
    exit: 1,
    env: { GITHUB_ACTIONS: 'true' },
    stdout: [
      '::error title=guard checks — 3 more failed checks::The job summary lists all 12 failed guard checks.',
      '::error title=guard 09::forced failure 09'
    ],
    stdoutAbsent: ['::error title=guard 10::'],
    stdoutLines: [{ prefix: '::error', count: 10 }],
    summary: [
      '## guard checks — 12 of 12 failed',
      '- **guard 12** — forced failure 12',
      'Only 9 of 12 failed checks fit in the run-page annotations; the aggregate reports the remainder. This list is complete.',
      '`guard-artifact-attempt-1`'
    ]
  },
  {
    mode: 'renamed-list',
    name: 'a renamed check fails even though the count is unchanged',
    exit: 1,
    stdout: ['declared guard checks never ran: second', 'undeclared guard checks ran: renamed']
  },
  {
    mode: 'complete-list',
    name: 'a complete check list still passes',
    exit: 0,
    stdout: ['2/2 guard checks passed']
  },
  {
    // The failure this suite was built for: a cold launch whose bridge arrives
    // long after the fixed sleeps the probe used to trust.
    mode: 'late-bridge',
    name: 'a bridge that appears ten seconds late is still awaited',
    exit: 0,
    stdout: ['late bridge: value=bridge waited=10000ms']
  },
  {
    mode: 'never-bridge',
    name: 'a bridge that never appears ends at the deadline instead of hanging',
    exit: 0,
    stdout: ['missing bridge: value=null waited=30000ms']
  },
  {
    mode: 'missing-prereq',
    name: 'a missing prerequisite exits 2 with the file and its remedy',
    exit: 2,
    stderr: ['environment not ready', 'C:/definitely-not-here/JOYFRAME.exe is missing', 'npm run nope']
  },
  {
    mode: 'busy-port',
    name: 'a busy debugging port exits 2 and names the override',
    exit: 2,
    stderr: ['already accepting connections', 'JF_FIXTURE_PORT']
  },
  ...STALE_CASES,
  {
    mode: 'fresh-build',
    name: 'an out/ stamped from the current files still passes',
    exit: 0
  },
  {
    mode: 'missing-stamp',
    name: 'an unstamped out/ is refused instead of trusted',
    exit: 2,
    stderr: ['has no freshness stamp', 'npm run build']
  },
  {
    mode: 'unfinished',
    name: 'an unsettled run exits 13 and says it did not finish',
    exit: 13,
    stderr: ['did not finish']
  },
  {
    mode: 'silent-zero',
    name: 'a drained run that exits 0 is reported too',
    exit: 0,
    stderr: ['did not finish']
  },
  {
    mode: 'finished',
    name: 'a finished failure is not reported as unfinished',
    exit: 1,
    stderrAbsent: ['did not finish']
  },
  {
    mode: 'stale-asar',
    name: 'a stale package is refused with the repackage remedy',
    exit: 1,
    stderr: ['Packaged build is stale', 'npm run dist']
  }
]

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  for (const [index, testCase] of CASES.entries()) {
    // One summary file per case, so an appended section cannot satisfy another.
    const summaryFile = testCase.summary ? path.join(ROOT, `${index}-${testCase.mode}.md`) : ''
    const run = spawnSync(process.execPath, [FIXTURE, testCase.mode, ROOT], {
      encoding: 'utf8',
      env: { ...process.env, ...(testCase.env ?? {}), GITHUB_STEP_SUMMARY: summaryFile }
    })
    const stdout = run.stdout ?? ''
    const stderr = run.stderr ?? ''
    const summary = summaryFile && fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : ''
    const missing = [
      ...(testCase.stdout ?? []).filter((text) => !stdout.includes(text)),
      ...(testCase.stderr ?? []).filter((text) => !stderr.includes(text)),
      ...(testCase.summary ?? []).filter((text) => !summary.includes(text))
    ]
    const unexpected = [
      ...(testCase.stdoutAbsent ?? []).filter((text) => stdout.includes(text)),
      ...(testCase.stderrAbsent ?? []).filter((text) => stderr.includes(text))
    ]
    const lineProblems = (testCase.stdoutLines ?? []).flatMap(({ prefix, count }) => {
      const actual = stdout.split(/\r?\n/).filter((line) => line.startsWith(prefix)).length
      return actual === count ? [] : [`${actual} stdout lines starting with ${prefix}, expected ${count}`]
    })
    const problems = []
    if (run.status !== testCase.exit) problems.push(`exit ${run.status}, expected ${testCase.exit}`)
    if (missing.length) problems.push(`missing from output: ${missing.join(' | ')}`)
    if (unexpected.length) problems.push(`should not have printed: ${unexpected.join(' | ')}`)
    if (lineProblems.length) problems.push(...lineProblems)
    check(
      testCase.name,
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : `exit ${run.status}${stderr.trim() ? ` — ${stderr.trim().split(/\r?\n/).find((line) => line.trim())}` : ''}`
    )
  }
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} guard self-checks passed.`)
process.exit(failed ? 1 : 0)
