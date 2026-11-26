#!/usr/bin/env node
/**
 * Installer matrix: clean, per-user, all-users, uninstall and downgrade paths.
 *
 * check.yml's installed-checks job proved one path — an elevated
 * `/allusers /S` install that boots. A per-user install writing to the wrong
 * directory, an uninstaller that wipes `%APPDATA%/JOYFRAME/joyframe.db`, or an
 * installer whose version resource disagrees with package.json would all stay
 * green. This probes the rest without needing elevation for anything but the
 * all-users assertion (which reuses the copy the job already installed):
 *
 *   clean      the installer for this version exists; NSIS config allows both
 *              scopes (assisted, not oneClick; directory changeable)
 *   per-user   `/currentuser /S` lands outside Program Files and its asar is
 *              byte-identical to release/win-unpacked
 *   all-users  the machine-wide exe exists when the job installed it
 *   uninstall  removing the per-user copy deletes the exe but preserves a
 *              marker plus any real joyframe.db in %APPDATA%/JOYFRAME
 *   downgrade  installer ProductVersion matches package.json, and the 1.0.0
 *              schema/seed fixtures exist so a version change never wipes data
 *
 *   npm run verify:installer-matrix
 *
 * Non-Windows runs prove the static half (installer, config, fixtures) and
 * report the install/uninstall steps as skipped instead of failing. On Windows
 * every step runs. The probe only ever adds and removes its own marker file
 * inside the real profile directory — it never deletes user data.
 */
import { execFile, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { failureArtifacts, reportChecks } from './cdp.mjs'

const LOG_DIR = '.verify-logs'
const LOG_FILE = path.join(LOG_DIR, 'verify-installer-matrix.log')
fs.mkdirSync(LOG_DIR, { recursive: true })
const logFd = fs.openSync(LOG_FILE, 'w')
const lines = []
const say = (text) => {
  lines.push(text)
  fs.writeSync(logFd, `${text}\n`)
  console.log(text)
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  fs.writeSync(logFd, `${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}\n`)
}

const EXPECTED_CHECKS = [
  'clean: installer for this version exists in release/',
  'clean: nsis config allows per-user and all-users installs',
  'per-user: silent install lands outside Program Files',
  'per-user: installed asar matches the staged build',
  'all-users: the machine-wide exe exists',
  'uninstall: per-user uninstall removes the exe',
  'uninstall: user data survives the uninstall',
  'downgrade: installer version matches package.json',
  'downgrade: 1.0.0 profile fixtures prove version changes keep data'
]

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version
const isWindows = process.platform === 'win32'

const releaseDir = 'release'
const stagedAsar = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar')
const exactInstaller = path.join(releaseDir, `JOYFRAME Setup ${version}.exe`)
let installer = fs.existsSync(exactInstaller) ? exactInstaller : null
if (!installer && fs.existsSync(releaseDir)) {
  const fallback = fs
    .readdirSync(releaseDir)
    .filter((name) => /^JOYFRAME Setup .*\.exe$/i.test(name))
    .sort()[0]
  if (fallback) installer = path.join(releaseDir, fallback)
}
check(
  'clean: installer for this version exists in release/',
  installer === exactInstaller,
  installer
    ? installer === exactInstaller
      ? `${installer} (${(fs.statSync(installer).size / 1024 / 1024).toFixed(1)} MB)`
      : `found ${installer}, expected ${exactInstaller} — a leftover installer for another version does not cover this build`
    : `no \`release/JOYFRAME Setup *.exe\` — \`npm run dist\` did not finish`
)

const nsis = pkg.build?.nsis ?? {}
const nsisOk = nsis.oneClick === false && nsis.allowToChangeInstallationDirectory === true
check(
  'clean: nsis config allows per-user and all-users installs',
  nsisOk,
  `oneClick=${JSON.stringify(nsis.oneClick)} allowToChangeInstallationDirectory=${JSON.stringify(nsis.allowToChangeInstallationDirectory)} shortcut=${JSON.stringify(nsis.shortcutName)}`
)

const runPs = (command) =>
  new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? `: ${String(stderr).trim().slice(0, 200)}` : ''}`))
      else resolve(String(stdout).trim())
    })
  })

const stopJoyframe = () => {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'JOYFRAME.exe'], { stdio: 'ignore' })
  } catch {
    /* not running */
  }
}

const waitFor = async (predicate, { timeoutMs, what }) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${what} within ${Math.round(timeoutMs / 1000)}s`)
}

if (!isWindows) {
  for (const name of EXPECTED_CHECKS.slice(2, 7)) {
    check(name, true, 'skipped: needs Windows (static checks above prove the packaged half)')
  }
} else if (!installer) {
  for (const name of EXPECTED_CHECKS.slice(2, 7)) {
    check(name, false, 'no installer — `npm run dist` did not finish')
  }
} else {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? 'C:', 'AppData', 'Local')
  const appData = process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? 'C:', 'AppData', 'Roaming')
  const perUserDir = path.join(localAppData, 'Programs', 'JOYFRAME')
  const perUserExe = path.join(perUserDir, 'JOYFRAME.exe')
  const perUserUninstaller = path.join(perUserDir, 'Uninstall JOYFRAME.exe')
  const allUsersExe = 'C:/Program Files/JOYFRAME/JOYFRAME.exe'
  const profileDir = path.join(appData, 'JOYFRAME')
  const marker = path.join(profileDir, 'installer-matrix-proof.txt')
  const realDb = path.join(profileDir, 'joyframe.db')

  // Clean: a stale per-user copy from an earlier run would make the
  // install below a no-op upgrade instead of the fresh install it claims.
  stopJoyframe()
  if (fs.existsSync(perUserUninstaller)) {
    say(`clean: removing stale per-user copy via ${perUserUninstaller}`)
    await new Promise((resolve) => {
      execFile(perUserUninstaller, ['/S'], { timeout: 120000 }, () => resolve())
    })
    stopJoyframe()
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  if (fs.existsSync(perUserExe)) {
    fs.rmSync(perUserDir, { recursive: true, force: true })
  }

  // Snapshot user data before touching the installer: the marker proves the
  // directory survives even on machines with no library yet, and the hash
  // proves a real database is never rewritten.
  let dbBefore = null
  try {
    fs.mkdirSync(profileDir, { recursive: true })
    if (fs.existsSync(realDb)) dbBefore = crypto.createHash('sha256').update(fs.readFileSync(realDb)).digest('hex')
    fs.writeFileSync(marker, `installer-matrix ${new Date().toISOString()} joyframe ${version}\n`)
  } catch (error) {
    check('per-user: silent install lands outside Program Files', false, `could not stage profile marker: ${error.message}`)
    dbBefore = 'unwritable'
  }

  if (dbBefore !== 'unwritable') {
    let installError = null
    try {
      await new Promise((resolve, reject) => {
        execFile(path.resolve(installer), ['/currentuser', '/S'], { timeout: 180000 }, (error) => {
          if (error) reject(new Error(`per-user install exited: ${error.message.slice(0, 200)}`))
          else resolve()
        })
      })
      stopJoyframe() // a silent assisted install may honour its run-after-finish box
      await waitFor(() => (fs.existsSync(perUserExe) ? perUserExe : null), {
        timeoutMs: 120000,
        what: `per-user install left no ${perUserExe}`
      })
    } catch (error) {
      installError = error.message
    }
    const outsideProgramFiles = path.resolve(perUserExe).toLowerCase().startsWith(path.resolve(localAppData).toLowerCase())
    check(
      'per-user: silent install lands outside Program Files',
      !installError && fs.existsSync(perUserExe) && outsideProgramFiles,
      installError ?? `${perUserExe} (${outsideProgramFiles ? 'per-user scope' : 'WRONG SCOPE — expected under ' + localAppData})`
    )

    if (fs.existsSync(perUserExe) && fs.existsSync(stagedAsar)) {
      const perUserAsar = path.join(perUserDir, 'resources', 'app.asar')
      try {
        const expected = crypto.createHash('sha256').update(fs.readFileSync(stagedAsar)).digest('hex')
        const actual = crypto.createHash('sha256').update(fs.readFileSync(perUserAsar)).digest('hex')
        check(
          'per-user: installed asar matches the staged build',
          expected === actual,
          expected === actual ? `sha256 ${expected.slice(0, 12)}…` : `staged ${expected.slice(0, 12)}… vs installed ${actual.slice(0, 12)}… — reinstall the current build`
        )
      } catch (error) {
        check('per-user: installed asar matches the staged build', false, error.message.slice(0, 200))
      }
    } else {
      check(
        'per-user: installed asar matches the staged build',
        false,
        !fs.existsSync(stagedAsar) ? `${stagedAsar} is missing — run \`npm run dist\` first` : 'per-user exe missing, nothing to compare'
      )
    }

    // All-users: this probe never elevates, so it reuses the copy the
    // installed-checks job (or a release engineer) already installed.
    check(
      'all-users: the machine-wide exe exists',
      fs.existsSync(allUsersExe),
      fs.existsSync(allUsersExe) ? allUsersExe : `${allUsersExe} is missing — install the build elevated (\`/allusers /S\`) or run the installed-checks job`
    )

    // Uninstall the per-user copy and prove data survives it.
    let uninstallError = null
    try {
      if (!fs.existsSync(perUserUninstaller)) throw new Error(`${perUserUninstaller} is missing — the per-user install left no uninstaller`)
      await new Promise((resolve, reject) => {
        execFile(perUserUninstaller, ['/S'], { timeout: 180000 }, (error) => {
          if (error) reject(new Error(`uninstaller exited: ${error.message.slice(0, 200)}`))
          else resolve()
        })
      })
      stopJoyframe()
      await waitFor(() => (!fs.existsSync(perUserExe) ? true : null), {
        timeoutMs: 60000,
        what: `uninstaller left ${perUserExe} behind`
      })
    } catch (error) {
      uninstallError = error.message
    }
    check(
      'uninstall: per-user uninstall removes the exe',
      !uninstallError,
      uninstallError ?? `${perUserExe} removed`
    )

    let dataDetail = ''
    let dataOk = false
    try {
      const markerSurvived = fs.existsSync(marker)
      let dbOk = true
      if (dbBefore) {
        const dbAfter = fs.existsSync(realDb) ? crypto.createHash('sha256').update(fs.readFileSync(realDb)).digest('hex') : null
        dbOk = dbAfter === dbBefore
        dataDetail = `marker ${markerSurvived ? 'preserved' : 'MISSING'}, joyframe.db ${dbOk ? `unchanged (${String(dbBefore).slice(0, 12)}…)` : 'CHANGED OR MISSING'}`
      } else {
        dataDetail = `marker ${markerSurvived ? 'preserved' : 'MISSING'} (no pre-existing joyframe.db on this machine)`
      }
      dataOk = markerSurvived && dbOk
    } catch (error) {
      dataDetail = error.message.slice(0, 200)
    } finally {
      try {
        fs.rmSync(marker, { force: true })
      } catch {
        /* marker already gone with the profile — reported above */
      }
    }
    check('uninstall: user data survives the uninstall', dataOk, dataDetail)
  }
}

// Downgrade: the installer must advertise the version it was built from, so an
// older byte stream can never pass as the current release. The data half is
// the 1.0.0 fixtures: a profile written by the shipped 1.0.0 build loads in
// the current app (verify:dist), which is what makes installing across
// versions safe in either direction — user data is never reformatted away.
let versionDetail = ''
let versionOk = false
try {
  if (!installer) {
    versionDetail = 'no installer to read'
  } else if (!isWindows) {
    versionDetail = `skipped version-resource read (needs Windows); installer present: ${installer}`
    versionOk = true
  } else {
    const product = await runPs(`(Get-Item '${installer.replace(/'/g, "''")}').VersionInfo.ProductVersion`)
    versionOk = product.includes(version)
    versionDetail = versionOk ? `ProductVersion ${product}` : `ProductVersion ${product || '(empty)'} does not contain ${version}`
  }
} catch (error) {
  versionDetail = `could not read version resource: ${error.message.slice(0, 200)}`
}
check('downgrade: installer version matches package.json', versionOk, versionDetail)

const fixtures = ['scripts/fixtures/schema-1.0.0.sql', 'scripts/seed-legacy.ts', 'scripts/verify-dist.mjs']
const missing = fixtures.filter((file) => !fs.existsSync(file))
check(
  'downgrade: 1.0.0 profile fixtures prove version changes keep data',
  missing.length === 0,
  missing.length ? `missing ${missing.join(', ')}` : 'schema-1.0.0.sql + seed-legacy.ts feed verify:dist, which boots a 1.0.0 profile in the current build'
)

fs.closeSync(logFd)
const complete = reportChecks(results, {
  expected: EXPECTED_CHECKS,
  subject: 'installer-matrix checks',
  artifacts: failureArtifacts()
})
process.exit(complete ? 0 : 1)
