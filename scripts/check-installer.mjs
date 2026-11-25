#!/usr/bin/env node
/**
 * Assert the installer build shipped JOYFRAME's own icon.
 *
 * `npm run dist` is the only step that proves the tracked brand assets reach a
 * real package, and it runs nowhere in CI until now. The failure it must catch
 * is quiet: when `build.win.icon` is missing, electron-builder does not fail —
 * it packages the default Electron icon and carries on. The builder states that
 * once, in its log, so the log is the evidence, together with the installer it
 * produced and the icon resources inside the package.
 *
 *   npm run dist > dist.log 2>&1
 *   npm run verify:installer            # reads dist.log by default
 *   npm run verify:installer -- <path>  # or another log
 *
 * Run after `npm run dist`; it inspects, it does not build.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { failureArtifacts, reportChecks } from './cdp.mjs'

const require = createRequire(import.meta.url)
const asarLib = require('@electron/asar')

const RELEASE = 'release'
const UNPACKED = path.join(RELEASE, 'win-unpacked')
const ASAR = path.join(UNPACKED, 'resources', 'app.asar')
const logPath = process.argv[2] ?? 'dist.log'

/** electron-builder's own wording when it substitutes its fallback icon. */
const FALLBACK = 'default Electron icon'

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

const installer = fs.existsSync(RELEASE)
  ? fs.readdirSync(RELEASE).find((name) => /^JOYFRAME Setup .*\.exe$/i.test(name))
  : null
check(
  'the installer exists in release/',
  Boolean(installer),
  installer
    ? `${path.join(RELEASE, installer)} (${(fs.statSync(path.join(RELEASE, installer)).size / 1024 / 1024).toFixed(1)} MB)`
    : `no \`release/JOYFRAME Setup *.exe\` — \`npm run dist\` did not finish`
)

let log = null
try {
  log = fs.readFileSync(logPath, 'utf8')
} catch {
  /* reported below */
}
check(
  'the dist log was captured',
  log !== null,
  log !== null ? `${logPath} (${log.split('\n').length} lines)` : `${logPath} is missing — redirect \`npm run dist\` into it`
)
check(
  'electron-builder did not fall back to the default Electron icon',
  log !== null && !log.includes(FALLBACK),
  log === null ? 'no log to inspect' : log.includes(FALLBACK) ? `the log says "${FALLBACK}" — build.win.icon did not resolve` : 'no fallback warning in the log'
)

check(
  'the packaged exe exists',
  fs.existsSync(path.join(UNPACKED, 'JOYFRAME.exe')),
  fs.existsSync(path.join(UNPACKED, 'JOYFRAME.exe')) ? path.join(UNPACKED, 'JOYFRAME.exe') : `${UNPACKED}/JOYFRAME.exe is missing`
)

let entries = []
let archiveProblem = null
if (!fs.existsSync(ASAR)) {
  archiveProblem = `${ASAR} is missing`
} else {
  try {
    entries = asarLib.listPackage(ASAR)
  } catch (error) {
    archiveProblem = error.message
  }
}
check('the package archive is readable', archiveProblem === null, archiveProblem ?? `${entries.length} entries`)

const needed = ['icon.ico', 'icon-512.png']
for (const name of needed) {
  const found = entries.some((entry) => entry.endsWith(`\\resources\\${name}`) || entry.endsWith(`/resources/${name}`))
  check(
    `the package carries resources/${name}`,
    found,
    found ? 'present in app.asar' : `not in app.asar — the window icon and installer art would be missing`
  )
}

const ok = reportChecks(results, {
  expected: [
    'the installer exists in release/',
    'the dist log was captured',
    'electron-builder did not fall back to the default Electron icon',
    'the packaged exe exists',
    'the package archive is readable',
    ...needed.map((name) => `the package carries resources/${name}`)
  ],
  subject: 'installer checks',
  artifacts: failureArtifacts()
})
process.exit(ok ? 0 : 1)
