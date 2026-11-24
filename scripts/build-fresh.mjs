#!/usr/bin/env node
/**
 * Build freshness stamp: what out/ was built from.
 *
 * `npm run build` writes `.build-stamp.json` once electron-vite finishes,
 * recording a hash of every file under src/ and of electron.vite.config.ts. A
 * probe calls `assertBuildFresh()` before it boots anything, so an edit that
 * was never rebuilt fails with exit 2 and the remedy instead of the probe
 * quietly driving the previous bundle and passing or failing against code
 * nobody is working on. The config is an input too: changing an alias, an
 * entry point or the plugin list rebuilds out/ differently without touching a
 * single file in src/, and that must invalidate the bundle just the same.
 *
 * The comparison is by content, not timestamp: a checkout, a copy or a clock
 * skew can move mtimes without changing a byte, and none of that should either
 * fake freshness or break it. Only a real difference is reported, by file name,
 * and a missing, unreadable or older-format stamp is refused rather than
 * trusted.
 *
 *   node scripts/build-fresh.mjs        # write the stamp (run by `npm run build`)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXIT_NOT_READY } from './cdp.mjs'

export const SOURCE_ROOT = 'src'
export const CONFIG_FILE = 'electron.vite.config.ts'
export const OUTPUT_ROOT = 'out'
export const STAMP_FILE = '.build-stamp.json'

/** Everything that changes what electron-vite puts in out/. */
export const BUILD_INPUTS = [SOURCE_ROOT, CONFIG_FILE]

/** Bumped when the stamp's shape changes, so an old stamp is rebuilt, not trusted. */
const STAMP_VERSION = 2

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const display = (file) => path.normalize(file).split(path.sep).join('/')

/** Every regular file under `root`, relative and sorted, so a stamp is stable. */
function filesUnder(root, base = root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(file, base))
    else if (entry.isFile()) files.push(path.relative(base, file))
  }
  return files.sort()
}

/** The files one build input contributes: a single file, or a whole tree. */
function filesIn(input) {
  let stat
  try {
    stat = fs.statSync(input)
  } catch (error) {
    throw new Error(`${display(input)} is missing (${error.code ?? error.message}).`)
  }
  if (stat.isFile()) return [display(input)]
  if (!stat.isDirectory()) throw new Error(`${display(input)} is neither a file nor a directory.`)
  return filesUnder(input).map((relative) => display(path.join(input, relative)))
}

/** Current content of the build inputs: per-file hashes, one digest, newest file. */
export function sourceSnapshot(inputs = BUILD_INPUTS) {
  const files = {}
  let newest = null
  for (const input of inputs) {
    for (const file of filesIn(input)) {
      const hash = sha256(fs.readFileSync(file))
      files[file] = hash
      const mtimeMs = fs.statSync(file).mtimeMs
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { file, mtimeMs, at: new Date(mtimeMs).toISOString() }
      }
    }
  }
  const digest = sha256(
    Buffer.from(Object.entries(files).map(([file, hash]) => `${file} ${hash}`).join('\n'))
  )
  return { files, digest, newest }
}

/**
 * Write the stamp for the build just produced. Called by `npm run build` after
 * electron-vite succeeds; the CLI catches its errors and exits 1, because a
 * build that cannot stamp itself must not look like a finished one.
 */
export function writeBuildStamp({ inputs = BUILD_INPUTS, out = OUTPUT_ROOT, stamp = STAMP_FILE } = {}) {
  if (!fs.existsSync(out)) throw new Error(`${display(out)} is missing — did electron-vite build succeed?`)
  const snapshot = sourceSnapshot(inputs)
  const record = {
    version: STAMP_VERSION,
    builtAt: new Date().toISOString(),
    sources: {
      inputs: inputs.map(display),
      digest: snapshot.digest,
      newest: snapshot.newest,
      files: snapshot.files
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(stamp)), { recursive: true })
  fs.writeFileSync(stamp, `${JSON.stringify(record, null, 2)}\n`)
  console.log(
    `Stamped ${display(out)}/ from ${Object.keys(snapshot.files).length} files (${inputs.map(display).join(', ')}) — ` +
      `sha256 ${snapshot.digest.slice(0, 12)}`
  )
  return record
}

/** Read a stamp, or say why it cannot be used. */
function readStamp(stamp) {
  let record
  try {
    record = JSON.parse(fs.readFileSync(stamp, 'utf8'))
  } catch (error) {
    return { problem: `${display(stamp)} is unreadable (${error.message}).` }
  }
  if (record?.version !== STAMP_VERSION) {
    return {
      problem:
        `${display(stamp)} was written by ${record?.version ? `an older build (format ${record.version})` : 'an unknown build'}.`
    }
  }
  const files = record?.sources?.files
  if (!files || typeof files !== 'object' || typeof record.sources.digest !== 'string') {
    return { problem: `${display(stamp)} is not a build stamp — it has no source record.` }
  }
  return { record }
}

/** First few names, then how many were left out. */
function summarize(files, limit = 3) {
  const shown = files.slice(0, limit).join(', ')
  return files.length > limit ? `${shown} and ${files.length - limit} more` : shown
}

/**
 * What is wrong with out/ relative to the inputs it should have been built
 * from, or null when the build is current. Returns the reason and the command
 * that fixes it, so callers can either exit or report it.
 */
export function buildFreshnessProblem({ inputs = BUILD_INPUTS, out = OUTPUT_ROOT, stamp = STAMP_FILE } = {}) {
  if (!fs.existsSync(out)) {
    return { reason: `${display(out)}/ is missing.`, remedy: 'Run `npm run build` to produce it, then retry.' }
  }
  if (!fs.existsSync(stamp)) {
    return {
      reason: `${display(out)}/ has no freshness stamp (${display(stamp)} is missing), so nothing records which sources it came from.`,
      remedy: 'Run `npm run build` to rebuild out/ and write the stamp, then retry.'
    }
  }

  const { record, problem } = readStamp(stamp)
  if (problem) {
    return { reason: problem, remedy: 'Run `npm run build` to write a current stamp, then retry.' }
  }

  let current
  try {
    current = sourceSnapshot(inputs)
  } catch (error) {
    return {
      reason: `could not read the build inputs (${error.message}), so out/ cannot be shown to match them.`,
      remedy: 'Restore the missing input, then run `npm run build`.'
    }
  }
  if (current.digest === record.sources.digest) return null

  const recorded = record.sources.files
  const changed = Object.keys(recorded).filter(
    (file) => file in current.files && current.files[file] !== recorded[file]
  )
  const removed = Object.keys(recorded).filter((file) => !(file in current.files))
  const added = Object.keys(current.files).filter((file) => !(file in recorded))
  const total = changed.length + removed.length + added.length
  const detail = [
    changed.length ? `changed: ${summarize(changed)}` : null,
    added.length ? `added: ${summarize(added)}` : null,
    removed.length ? `removed: ${summarize(removed)}` : null
  ]
    .filter(Boolean)
    .join('; ')
  const built = record.builtAt ? ` (stamp written ${record.builtAt})` : ''

  return {
    reason:
      `out/ is older than its sources — ${total} input file${total === 1 ? '' : 's'} ` +
      `${total === 1 ? 'differs' : 'differ'} from the build${built}: ${detail}.`,
    remedy: 'Run `npm run build` to rebuild out/ from the current sources, then retry.'
  }
}

/**
 * Exit with the stamp's diagnosis unless out/ was built from the current
 * inputs. Stale output is a state of the machine, not a regression, so this
 * uses EXIT_NOT_READY like a missing build or a busy debugging port.
 */
export function assertBuildFresh({ label = 'build', ...options } = {}) {
  const problem = buildFreshnessProblem(options)
  if (!problem) return
  fs.writeSync(2, `\n${label}: environment not ready — ${problem.reason}\n${problem.remedy}\n`)
  process.exit(EXIT_NOT_READY)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    writeBuildStamp()
  } catch (error) {
    console.error(`Could not stamp the build: ${error.message}`)
    process.exit(1)
  }
}
