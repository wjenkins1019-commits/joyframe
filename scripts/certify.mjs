#!/usr/bin/env node
/**
 * Release certification: one command that proves the shipped artifact.
 *
 * `npm run check` proves the dev build and only *reports* whether release/
 * still matches. It never boots the packaged app and never looks at the
 * install, so a green check could sit next to an installer nobody had run, and
 * certification was a human chaining check → dist → the packaged probes →
 * verify:installed-build and remembering every step.
 *
 *   npm run certify
 *
 * That chain, in order, stopping at the first failure: a later stage cannot
 * say anything about a package that was never built, and a red stage followed
 * by green ones only hides where it went wrong. Only a full pass prints
 * CERTIFIED, together with the SHA-256 of the bundle in release/ and the one
 * in Program Files, so the certificate names the exact build it covers.
 *
 * Exit codes follow the probes: 2 when the machine was not ready for a stage
 * (a missing build, a leftover instance holding a debugging port), 1 when a
 * stage ran and failed.
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const PACKAGED = path.join('release', 'win-unpacked')
const ASAR = path.join(PACKAGED, 'resources', 'app.asar')
const INSTALLED_DIR = process.env.JOYFRAME_INSTALLED_DIR ?? 'C:/Program Files/JOYFRAME'
const INSTALLED_ASAR = path.join(INSTALLED_DIR, 'resources', 'app.asar')

/**
 * Each stage is one command that has to pass on its own. `check` covers the
 * dev build and the guards; the build is repeated so the package is made from
 * sources regardless of what an earlier stage happened to leave in out/; then
 * the installer, the packaged app, a first run on a clean profile, the
 * controller suite against the package, the machine-wide bytes, and finally
 * that installed copy booted — a hash proves the right bytes, not that they
 * still show an intro and open the library.
 */
const STAGES = [
  { script: 'check', label: 'dev-build checks and suite guards' },
  { script: 'build', label: 'production build' },
  { script: 'dist', label: 'packaged installer' },
  { script: 'verify:dist', label: 'packaged app: demo and 1.0.0 profiles' },
  { script: 'verify:first-run', label: 'packaged app: first run' },
  { script: 'verify:intro-name-pad', label: 'packaged app: welcome name step' },
  { script: 'verify:dist-pad', label: 'packaged app: controller suite' },
  { script: 'verify:installed-build', label: 'installed copy matches release/' },
  { script: 'verify:installed', label: 'installed app: intro, skip and cold start' }
]

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Re-read what the certificate covers; the stages already proved it exists. */
function describeBuild() {
  const rows = []
  let packaged = null
  try {
    const stat = fs.statSync(ASAR)
    packaged = sha256(ASAR)
    rows.push(`  packaged   ${ASAR}  sha256 ${packaged}  (${megabytes(stat.size)})`)
  } catch (error) {
    rows.push(`  packaged   ${ASAR} could not be re-read: ${error.message}`)
  }
  try {
    const installed = sha256(INSTALLED_ASAR)
    rows.push(
      `  installed  ${INSTALLED_ASAR}  ${installed === packaged ? 'same sha256' : `sha256 ${installed}`}`
    )
  } catch (error) {
    rows.push(`  installed  ${INSTALLED_ASAR} could not be re-read: ${error.message}`)
  }
  const installer = fs.existsSync('release')
    ? fs
        .readdirSync('release')
        .filter((name) => /^JOYFRAME Setup .*\.exe$/i.test(name))
        .map((name) => path.join('release', name))[0]
    : null
  rows.push(
    installer
      ? `  installer  ${installer}  (${megabytes(fs.statSync(installer).size)}) — install this file, or the copy above is stale`
      : '  installer  no `release/JOYFRAME Setup *.exe` found — `npm run dist` should have produced one'
  )
  return rows.join('\n')
}

console.log(`\nCertifying JOYFRAME ${version} — ${STAGES.length} stages, stopping at the first failure.`)

let total = 0
for (const [index, stage] of STAGES.entries()) {
  const position = `${index + 1}/${STAGES.length}`
  console.log(`\n[${position}] ${stage.label} — npm run ${stage.script}`)
  const started = Date.now()
  // One command string rather than args + shell, which Node deprecates; the
  // script names are this file's own, so there is nothing to quote.
  const result = spawnSync(`npm run ${stage.script}`, { stdio: 'inherit', shell: true })
  const elapsed = Date.now() - started
  total += elapsed

  if (result.status === 0) {
    console.log(`  ${position} passed in ${seconds(elapsed)}`)
    continue
  }

  const status = result.status === null ? 'no exit status (the stage was killed)' : `exit ${result.status}`
  console.log(`\nCERTIFICATION FAILED  ${position} ${stage.label} — npm run ${stage.script} ${status} after ${seconds(elapsed)}.`)
  if (result.status === 2) {
    console.log('The machine was not ready for this stage, so nothing was certified. Fix the cause above and rerun.')
    process.exit(2)
  }
  if (index < STAGES.length - 1) console.log('The stages after this one did not run.')
  process.exit(1)
}

console.log(`\nCERTIFIED  JOYFRAME ${version} — all ${STAGES.length} stages passed in ${seconds(total)}.`)
console.log(describeBuild())
