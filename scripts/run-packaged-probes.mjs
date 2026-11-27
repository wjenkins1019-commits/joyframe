#!/usr/bin/env node
/**
 * Runs every packaged probe against the current package, in order, stopping at
 * the first failure.
 *
 *   npm run verify:packaged
 *
 * The list lives in ./packaged-probes.mjs — the same one `certify` builds its
 * stages from and the workflow self-test checks check.yml against — so this
 * command cannot fall behind them the way the hand-written `&&` chain did.
 *
 * Exit codes follow the probes: 2 when the machine was not ready for a probe (a
 * missing package, a leftover instance holding a debugging port), 1 when a probe
 * ran and failed. The probes after a failure do not run: a later probe cannot
 * say anything about a package an earlier one already refused.
 */
import { spawnSync } from 'node:child_process'
import { PACKAGED_PROBES } from './packaged-probes.mjs'

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`

console.log(`\nPackaged probes — ${PACKAGED_PROBES.length} in order, stopping at the first failure.`)

let total = 0
for (const [index, probe] of PACKAGED_PROBES.entries()) {
  const position = `${index + 1}/${PACKAGED_PROBES.length}`
  console.log(`\n[${position}] ${probe.label} — npm run ${probe.script}`)
  const started = Date.now()
  // One command string rather than args + shell, which Node deprecates; the
  // script names are the list's own, so there is nothing to quote.
  const result = spawnSync(`npm run ${probe.script}`, { stdio: 'inherit', shell: true })
  const elapsed = Date.now() - started
  total += elapsed

  if (result.status === 0) {
    console.log(`  ${position} passed in ${seconds(elapsed)}`)
    continue
  }

  const status = result.status === null ? 'no exit status (the probe was killed)' : `exit ${result.status}`
  console.log(`\nPACKAGED PROBES FAILED  ${position} ${probe.label} — npm run ${probe.script} ${status} after ${seconds(elapsed)}.`)
  if (index < PACKAGED_PROBES.length - 1) console.log('The probes after this one did not run.')
  process.exit(result.status ?? 1)
}

console.log(`\nPACKAGED PROBES PASSED — all ${PACKAGED_PROBES.length} passed in ${seconds(total)}.`)
