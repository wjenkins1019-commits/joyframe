#!/usr/bin/env node
/**
 * First-run verification: boots the packaged app against a throwaway profile and
 * proves a new install starts empty — welcome screen, empty library, fresh
 * database.
 *
 * Run after `npm run dist`:
 *
 *   npm run verify:first-run
 *
 * The profile lives under .verify-first-run/ (gitignored) and is passed with
 * --user-data-dir, so Electron never opens the real %APPDATA%/JOYFRAME profile.
 * The script also refuses to run if that isolation guard is ever broken, and it
 * records the real database's size/mtime to prove it was not modified. Profiles
 * are removed on exit; a locked leftover is retried on the next run.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  consoleProblems,
  createAppLog,
  createSession,
  delay,
  failureArtifacts,
  findWindow,
  MISSING_PACKAGED,
  preflight,
  removeDir,
  reportChecks
} from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'
import { assertPackagedBuildFresh } from './packaged-build.mjs'

const PORT = Number(process.env.JF_FIRST_RUN_PORT ?? 9227)
const ROOT = '.verify-first-run'
const PROFILE = path.resolve(ROOT, 'profile')
const EXE = path.join('release', 'win-unpacked', 'JOYFRAME.exe')
const DB = path.join(PROFILE, 'joyframe.db')
const REAL_PROFILE = process.env.APPDATA ? path.resolve(process.env.APPDATA, 'JOYFRAME') : null
const REAL_DB = REAL_PROFILE ? path.join(REAL_PROFILE, 'joyframe.db') : null

/**
 * Every check a complete pass makes, by name. A missing window skips the page
 * and database checks, which is a missing name here, and a renamed check no
 * longer matches — so neither reads as a shorter but passing run.
 */
const EXPECTED_CHECKS = [
  'the throwaway profile starts without a database',
  'the packaged window loads from the asar bundle',
  'the app is using the temporary profile, not the real user data',
  'the welcome screen renders its first-run copy',
  'the home screen shows no cards, rows or hero',
  'the library API reports no games, collections, emulators or scan paths',
  'the library view is empty',
  'the first-run database is readable',
  'the first-run database was created with no library data',
  'the first-run database was seeded with the platform catalogue',
  'artwork and backups are still empty',
  'the real user data was not modified',
  'no renderer console errors'
]
const appLog = createAppLog('verify-first-run')

/** Windows paths are case-insensitive. */
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/**
 * Never let a bad edit point the packaged app at the real library. The profile
 * must sit inside this workspace and outside the real %APPDATA%/JOYFRAME.
 */
function assertIsolatedProfile() {
  const workspace = path.resolve('.')
  if (!PROFILE.toLowerCase().startsWith(workspace.toLowerCase() + path.sep)) {
    throw new Error(`Refusing to run: ${PROFILE} is outside the workspace.`)
  }
  if (REAL_PROFILE) {
    const nested =
      samePath(PROFILE, REAL_PROFILE) ||
      PROFILE.toLowerCase().startsWith(REAL_PROFILE.toLowerCase() + path.sep)
    if (nested) throw new Error(`Refusing to run: ${PROFILE} is inside the real user data at ${REAL_PROFILE}.`)
  }
}

/** First-run home: welcome copy, no hero, no rows and no cards. */
const welcomeProbe = `(() => {
  const box = document.querySelector('main[data-jf-view]')
  // CSS uppercases the eyebrow label, so compare without case.
  const text = document.body.innerText.toLowerCase()
  return {
    headline: text.includes('every game you own.') && text.includes('one universe.'),
    welcome: text.includes('welcome to joyframe'),
    prompt: text.includes('your universe is empty'),
    view: box ? box.getAttribute('data-jf-view') : null,
    hero: Boolean(document.querySelector('section[aria-label="Featured game"]')),
    cards: box ? box.querySelectorAll('[data-game-id]').length : -1,
    rows: box ? [...box.querySelectorAll('section[aria-label]')].filter((el) => el.querySelector('[data-game-id]')).length : -1
  }
})()`

/** Library view rendered from the same empty profile. */
const libraryProbe = `(() => {
  const box = document.querySelector('main[data-jf-view]')
  const text = document.body.innerText.toLowerCase()
  return {
    view: box ? box.getAttribute('data-jf-view') : null,
    cards: box ? box.querySelectorAll('[data-game-id]').length : -1,
    empty: text.includes('no games match those filters'),
    results: text.includes('0 results')
  }
})()`

/** Counts behind the UI, read through the same preload API the app uses. */
const libraryCountsProbe = `(async () => {
  const [games, collections, emulators, paths] = await Promise.all([
    window.joyframe.library.list({}),
    window.joyframe.collections.list(),
    window.joyframe.emulators.list(),
    window.joyframe.library.paths()
  ])
  return { games: games.length, collections: collections.length, emulators: emulators.length, paths: paths.length }
})()`

/** Size/mtime of the real database, so a leak into it is visible. */
const realDbStamp = () => {
  try {
    const stat = fs.statSync(REAL_DB)
    return `${stat.size}@${stat.mtimeMs}`
  } catch {
    return 'absent'
  }
}

const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0)

/** Table row counts in the freshly created profile database. */
function readFreshDatabase() {
  const db = new DatabaseSync(DB)
  try {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c
    return {
      games: count('games'),
      collections: count('collections'),
      emulators: count('emulators'),
      libraryPaths: count('library_paths'),
      playSessions: count('play_sessions'),
      saves: count('game_saves'),
      platforms: count('platforms'),
      settings: count('settings')
    }
  } finally {
    db.close()
  }
}

async function main() {
  await preflight({
    label: 'verify:first-run',
    port: PORT,
    portVariable: 'JF_FIRST_RUN_PORT',
    needs: [{ file: EXE, remedy: MISSING_PACKAGED }]
  })
  assertBuildFresh({ label: 'verify:first-run' })
  assertPackagedBuildFresh()
  assertIsolatedProfile()

  removeDir(path.resolve(ROOT))
  fs.mkdirSync(PROFILE, { recursive: true })

  const results = []
  const problems = []
  const check = (name, ok, detail) => results.push({ name, ok, detail })

  check('the throwaway profile starts without a database', !fs.existsSync(DB), path.relative(process.cwd(), PROFILE))
  const realBefore = realDbStamp()

  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
    stdio: appLog.stdio
  })

  try {
    const target = await findWindow(PORT)
    check(
      'the packaged window loads from the asar bundle',
      Boolean(target?.url.includes('app.asar')),
      target?.url ?? 'no window appeared'
    )

    if (target) {
      const { events, evaluate, read } = await createSession(target)

      // This probe covers the empty first-run library, not the welcome flow:
      // quiet the intro and name step before reading the shell.
      await evaluate(`window.joyframe.settings.update({ playerName: 'Probe', introMode: 'off' })`)
      await evaluate('location.reload()')
      await delay(800)

      const info = await evaluate('window.joyframe.app.info()')
      check(
        'the app is using the temporary profile, not the real user data',
        Boolean(info?.userDataPath) &&
          samePath(info.userDataPath, PROFILE) &&
          !(REAL_PROFILE && samePath(info.userDataPath, REAL_PROFILE)),
        info?.userDataPath ?? 'no app info'
      )

      const welcome = await read(welcomeProbe, (value) => value.welcome && value.view === 'home')
      check(
        'the welcome screen renders its first-run copy',
        Boolean(welcome?.welcome && welcome.headline && welcome.prompt),
        welcome
          ? `welcome=${welcome.welcome} headline=${welcome.headline} empty-state=${welcome.prompt}`
          : 'nothing rendered'
      )
      check(
        'the home screen shows no cards, rows or hero',
        Boolean(welcome) && welcome.cards === 0 && welcome.rows === 0 && !welcome.hero,
        welcome ? `cards=${welcome.cards} rows=${welcome.rows} hero=${welcome.hero}` : 'nothing rendered'
      )

      const counts = await evaluate(libraryCountsProbe)
      check(
        'the library API reports no games, collections, emulators or scan paths',
        Boolean(counts) &&
          counts.games === 0 &&
          counts.collections === 0 &&
          counts.emulators === 0 &&
          counts.paths === 0,
        counts
          ? `${counts.games} games, ${counts.collections} collections, ${counts.emulators} emulators, ${counts.paths} paths`
          : 'no counts'
      )

      await evaluate(`document.querySelector('button[aria-label="Library"]')?.click()`)
      const library = await read(libraryProbe, (value) => value.view === 'library' && value.empty)
      check(
        'the library view is empty',
        Boolean(library) && library.view === 'library' && library.cards === 0 && library.empty && library.results,
        library ? `${library.cards} cards, empty-state=${library.empty}, ${library.results ? '0 results' : 'no result count'}` : 'no library view'
      )

      problems.push(...consoleProblems(events))
    }
  } finally {
    if (app.exitCode === null) {
      const gone = new Promise((resolve) => app.once('exit', resolve))
      app.kill()
      await Promise.race([gone, delay(5000)])
    }
  }

  // The app has exited, so its database and folders are readable on disk. A
  // missing or unreadable database fails all three checks rather than replacing
  // them, so the tally stays the same whatever goes wrong.
  const fresh = (() => {
    if (!fs.existsSync(DB)) return { rows: null, error: `${DB} is missing` }
    try {
      return { rows: readFreshDatabase(), error: null }
    } catch (error) {
      return { rows: null, error: error.message }
    }
  })()
  const rows = fresh.rows
  check('the first-run database is readable', Boolean(rows), fresh.error ?? 'read from disk')
  check(
    'the first-run database was created with no library data',
    Boolean(rows) &&
      rows.games === 0 &&
      rows.collections === 0 &&
      rows.emulators === 0 &&
      rows.libraryPaths === 0 &&
      rows.playSessions === 0 &&
      rows.saves === 0,
    rows
      ? `${rows.games} games, ${rows.collections} collections, ${rows.emulators} emulators, ` +
          `${rows.libraryPaths} scan paths, ${rows.playSessions} sessions, ${rows.saves} saves`
      : fresh.error
  )
  // Settings rows are written lazily once a setting changes, so only the
  // seeded platform catalogue is guaranteed on a first boot.
  check(
    'the first-run database was seeded with the platform catalogue',
    Boolean(rows) && rows.platforms > 0,
    rows ? `${rows.platforms} platforms, ${rows.settings} settings rows` : fresh.error
  )

  const artwork = entries(path.join(PROFILE, 'artwork'))
  const backups = entries(path.join(PROFILE, 'backups'))
  check('artwork and backups are still empty', artwork === 0 && backups === 0, `${artwork} artwork files, ${backups} backups`)
  check(
    'the real user data was not modified',
    realDbStamp() === realBefore,
    REAL_DB ? `${REAL_DB}: ${realBefore}` : 'no real database present'
  )
  check('no renderer console errors', problems.length === 0, problems.length ? problems.slice(0, 5).join(' | ') : 'boot was clean')

  removeDir(path.resolve(ROOT))

  const complete = reportChecks(results, {
    expected: EXPECTED_CHECKS,
    subject: 'first-run checks',
    artifacts: failureArtifacts()
  })
  process.exit(complete ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  removeDir(path.resolve(ROOT))
  process.exit(1)
})
