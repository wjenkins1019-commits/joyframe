#!/usr/bin/env node
/**
 * Build freshness stamp: what out/ was built from.
 *
 * `npm run build` writes `.build-stamp.json` after electron-vite finishes,
 * recording a hash of every build input: src/, the Vite config, the dependency
 * manifests, the brand resources the package ships and the tsconfigs that shape
 * the emitted code. A probe calls `assertBuildFresh()` before it boots
 * anything, so an edit that was never rebuilt fails with exit 2 and the remedy
 * instead of the probe quietly driving the previous bundle and passing or
 * failing against code nobody is working on. The config matters because an
 * alias, entry point or plugin change rebuilds out/ without touching src/; the
 * manifests matter because a dependency — including an upgraded native module —
 * changes what is bundled or loaded while src/ stands still. `resources/` matters
 * because the package ships it beside out/, so a changed splash or icon is a
 * changed app even though the bundle is identical, and the tsconfigs because
 * their options change what electron-vite emits.
 *
 * The comparison is by content, not timestamp: a checkout or a copy can move
 * mtimes without changing a byte, so only a real difference is reported, by
 * file name. A missing, unreadable or older-format stamp is refused, not
 * trusted.
 *
 *   node scripts/build-fresh.mjs        # write the stamp (run by `npm run build`)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXIT_NOT_READY } from './cdp.mjs'

/** Everything that changes what the app ships: electron-vite's output and the resources beside it. */
const INPUTS = [
  'src',
  'electron.vite.config.ts',
  'package.json',
  'package-lock.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'resources'
]
const OUT = 'out'
const STAMP = '.build-stamp.json'
/** Bumped when the stamp's shape changes, so an older stamp is rebuilt, not trusted. */
const STAMP_VERSION = 4
const REMEDY = 'Run `npm run build` to rebuild out/ from the current inputs, then retry.'

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const display = (file) => path.normalize(file).split(path.sep).join('/')

/** Every regular file under `dir`, in a stable order. */
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(file)
      return entry.isFile() ? [file] : []
    })
}

/** The files an input contributes: itself, or everything under a directory. */
const filesOf = (input) => (fs.statSync(input).isDirectory() ? walk(input) : [input])

/** Current content of the build inputs: per-file hashes and one digest. */
function snapshot() {
  const files = {}
  for (const input of INPUTS) {
    for (const file of filesOf(input)) files[display(file)] = sha256(fs.readFileSync(file))
  }
  const digest = sha256(
    Buffer.from(Object.entries(files).map(([file, hash]) => `${file} ${hash}`).join('\n'))
  )
  return { files, digest }
}

/**
 * Write the stamp for the build just produced. Called by `npm run build` after
 * electron-vite succeeds; the CLI reports its errors and exits 1, because a
 * build that cannot stamp itself must not look like a finished one.
 */
export function writeBuildStamp() {
  if (!fs.existsSync(OUT)) throw new Error(`${OUT}/ is missing — did electron-vite build succeed?`)
  const { files, digest } = snapshot()
  const record = { version: STAMP_VERSION, builtAt: new Date().toISOString(), digest, files }
  fs.writeFileSync(STAMP, `${JSON.stringify(record, null, 2)}\n`)
  console.log(
    `Stamped ${OUT}/ from ${Object.keys(files).length} files (${INPUTS.join(', ')}) — sha256 ${digest.slice(0, 12)}`
  )
}

/** First few names, then how many were left out. */
function summarize(files) {
  const shown = files.slice(0, 3).join(', ')
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown
}

/**
 * What is wrong with out/ relative to the inputs it should have been built
 * from, or null when the build is current. Returns the reason and the command
 * that fixes it, so a caller can exit or report it without rebuilding the text.
 */
export function buildFreshnessProblem() {
  if (!fs.existsSync(OUT)) return { reason: `${OUT}/ is missing.`, remedy: REMEDY }

  let stamp
  try {
    stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'))
  } catch (error) {
    return {
      reason:
        error.code === 'ENOENT'
          ? `${OUT}/ has no freshness stamp (${STAMP} is missing), so nothing records which files it came from.`
          : `${STAMP} is unreadable (${error.message}).`,
      remedy: REMEDY
    }
  }
  if (stamp?.version !== STAMP_VERSION || typeof stamp.digest !== 'string' || !stamp.files) {
    return { reason: `${STAMP} was written by a different build (format ${stamp?.version ?? 'unknown'}).`, remedy: REMEDY }
  }

  let current
  try {
    current = snapshot()
  } catch (error) {
    return {
      reason: `could not read the build inputs (${error.message}), so ${OUT}/ cannot be shown to match them.`,
      remedy: REMEDY
    }
  }
  if (current.digest === stamp.digest) return null

  const changed = Object.keys(stamp.files).filter(
    (file) => file in current.files && current.files[file] !== stamp.files[file]
  )
  const removed = Object.keys(stamp.files).filter((file) => !(file in current.files))
  const added = Object.keys(current.files).filter((file) => !(file in stamp.files))
  const total = changed.length + removed.length + added.length
  const detail = [
    changed.length ? `changed: ${summarize(changed)}` : null,
    added.length ? `added: ${summarize(added)}` : null,
    removed.length ? `removed: ${summarize(removed)}` : null
  ]
    .filter(Boolean)
    .join('; ')
  const built = stamp.builtAt ? ` (stamp written ${stamp.builtAt})` : ''

  return {
    reason:
      `${OUT}/ is older than the files it was built from — ${total} input file` +
      `${total === 1 ? ' differs' : 's differ'} from the build${built}: ${detail}.`,
    remedy: REMEDY
  }
}

/**
 * Exit with the stamp's diagnosis unless out/ was built from the current
 * inputs. Stale output is a state of the machine, not a regression, so this
 * uses EXIT_NOT_READY like a missing build or a busy debugging port.
 */
export function assertBuildFresh({ label = 'build' } = {}) {
  const problem = buildFreshnessProblem()
  if (!problem) return
  fs.writeSync(2, `\n${label}: environment not ready — ${problem.reason}\n${problem.remedy}\n`)
  process.exit(EXIT_NOT_READY)
}

/**
 * True when Node was asked to run this file rather than import it. Comparing
 * paths instead of reading `import.meta.main`, which older Node does not have:
 * there the flag is simply undefined, the stamp would never be written, and
 * `npm run build` would still exit 0.
 */
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    writeBuildStamp()
    // Run the probes' own check once here: a build that wrote a stamp the guard
    // rejects is not a build the probes can trust, and must fail now, not there.
    const problem = buildFreshnessProblem()
    if (problem) throw new Error(`the stamp just written does not satisfy the guard — ${problem.reason}`)
  } catch (error) {
    console.error(`Could not stamp the build: ${error.message}`)
    process.exit(1)
  }
}
