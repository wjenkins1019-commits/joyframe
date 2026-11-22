/**
 * Freshness guard for verification that drives release/win-unpacked.
 *
 * `npm run dist` builds out/ and then packages it. Running the packaged checks
 * after a newer `npm run build` would otherwise exercise the previous app while
 * reporting failures against the current source. Compare the newest output
 * file with the packaged asar, which is written after out/ is copied in.
 */
import fs from 'node:fs'
import path from 'node:path'

const PACKAGED = path.join('release', 'win-unpacked')
const EXE = path.join(PACKAGED, 'JOYFRAME.exe')
const ASAR = path.join(PACKAGED, 'resources', 'app.asar')
const OUT = 'out'

/** Newest regular file under `root`, recursively. */
function newestFile(root) {
  let newest = null
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      const child = newestFile(file)
      if (child && (!newest || child.mtimeMs > newest.mtimeMs)) newest = child
    } else if (entry.isFile()) {
      const mtimeMs = fs.statSync(file).mtimeMs
      if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs }
    }
  }
  return newest
}

/** What is wrong with the packaged build, or null when it is current. */
export function packagedBuildProblem({ exe = EXE, asar = ASAR, out = OUT } = {}) {
  for (const required of [exe, asar, out]) {
    if (!fs.existsSync(required)) return `${required} is missing — run \`npm run dist\` first.`
  }

  const built = newestFile(out)
  const packagedAt = fs.statSync(asar).mtimeMs
  if (!built || built.mtimeMs <= packagedAt) return null

  return (
    `Packaged build is stale: ${asar} was built at ${new Date(packagedAt).toISOString()}, ` +
    `before ${built.file} was written at ${new Date(built.mtimeMs).toISOString()}.\n` +
    'Run `npm run dist` to repackage the current out/ build, then retry.'
  )
}

/** Exit with an actionable message unless the packaged build includes the current out/. */
export function assertPackagedBuildFresh(options = {}) {
  const problem = packagedBuildProblem(options)
  if (!problem) return
  console.error(problem)
  process.exit(1)
}
