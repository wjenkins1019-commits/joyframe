/**
 * Freshness guard for verification that drives release/win-unpacked.
 *
 * `npm run dist` builds out/ and then packages it. Running the packaged checks
 * against a package built from different sources would report failures against
 * the current code, so compare what the asar actually contains for out/ with
 * the current out/ tree.
 *
 * The comparison is by content, not timestamp: a rebuild that produces the same
 * bytes (the usual `npm run check` after a test-only edit) leaves the package
 * valid, while any real difference is still refused. Timestamps only ever
 * explain a mismatch, never excuse one.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const asarLib = require('@electron/asar')

const PACKAGED = path.join('release', 'win-unpacked')
const EXE = path.join(PACKAGED, 'JOYFRAME.exe')
const ASAR = path.join(PACKAGED, 'resources', 'app.asar')
const OUT = 'out'

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

/** Every regular file under `root`, as paths relative to it, sorted. */
function filesUnder(root, base = root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(file, base))
    else if (entry.isFile()) files.push(path.relative(base, file))
  }
  return files.sort()
}

/** What is wrong with the packaged build, or null when it is current. */
export function packagedBuildProblem({ exe = EXE, asar = ASAR, out = OUT } = {}) {
  for (const required of [exe, asar, out]) {
    if (!fs.existsSync(required)) return `${required} is missing — run \`npm run dist\` first.`
  }

  // electron-builder packages the project with out/ at the archive root, so the
  // same relative path names a file in both places.
  const prefix = path.basename(out)
  let files
  try {
    files = filesUnder(out)
  } catch (error) {
    return `Could not read ${out}: ${error.message}`
  }

  for (const relative of files) {
    const local = fs.readFileSync(path.join(out, relative))
    let packaged
    try {
      packaged = asarLib.extractFile(asar, path.join(prefix, relative))
    } catch {
      return (
        `Packaged build is stale: ${path.join(prefix, relative)} is missing from ${asar}.\n` +
        'Run `npm run dist` to repackage the current out/ build, then retry.'
      )
    }
    if (packaged.length !== local.length || sha256(packaged) !== sha256(local)) {
      const packagedAt = fs.statSync(asar).mtimeMs
      const writtenAt = fs.statSync(path.join(out, relative)).mtimeMs
      const timing =
        writtenAt > packagedAt
          ? ` (out/ was written ${new Date(writtenAt).toISOString()}, after the package at ${new Date(packagedAt).toISOString()})`
          : ''
      return (
        `Packaged build is stale: ${path.join(prefix, relative)} differs from the copy in ${asar}${timing}.\n` +
        'Run `npm run dist` to repackage the current out/ build, then retry.'
      )
    }
  }

  return null
}

/** Exit with an actionable message unless the packaged build includes the current out/. */
export function assertPackagedBuildFresh(options = {}) {
  const problem = packagedBuildProblem(options)
  if (!problem) return
  console.error(problem)
  process.exit(1)
}
