#!/usr/bin/env node
/**
 * Installed-copy integrity: fails when the machine-wide install is not the
 * build sitting in release/win-unpacked.
 *
 * `verify:dist` and `verify:dist-pad` only ever look at release/win-unpacked,
 * so a blocked file, an aborted install or a stale Program Files copy is
 * invisible to them. This compares the packaged app bundle byte-for-byte and
 * exits 1 on any difference, before anything is launched.
 *
 *   npm run verify:installed-build
 *
 * Paths can be redirected with JOYFRAME_INSTALLED_DIR (default
 * `C:\Program Files\JOYFRAME`) and JOYFRAME_RELEASE_DIR (default
 * `release/win-unpacked`). `npm run verify:installed` runs this first.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const RELEASE = path.resolve(process.env.JOYFRAME_RELEASE_DIR ?? 'release/win-unpacked')
const INSTALLED = path.resolve(process.env.JOYFRAME_INSTALLED_DIR ?? 'C:/Program Files/JOYFRAME')
const ASAR = path.join('resources', 'app.asar')

const asarAt = (root) => path.join(root, ASAR)
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const describe = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`

function fail(message) {
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

const built = asarAt(RELEASE)
const installed = asarAt(INSTALLED)

if (!fs.existsSync(built)) fail(`${built} is missing — run \`npm run dist\` first.`)
if (!fs.existsSync(installed)) {
  fail(`${installed} is missing — install the build (elevated \`/allusers /S\`), or set JOYFRAME_INSTALLED_DIR.`)
}

const expected = sha256(built)
const actual = sha256(installed)
if (expected !== actual) {
  fail(
    `installed copy does not match the build:\n` +
      `  release:   ${expected}  (${describe(built)})\n` +
      `  installed: ${actual}  (${describe(installed)})\n` +
      `  reinstall the current build, then rerun this check.`
  )
}

console.log(`PASS  installed app matches release/win-unpacked — sha256 ${expected} (${describe(installed)})`)
