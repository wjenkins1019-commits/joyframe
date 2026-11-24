#!/usr/bin/env node
/**
 * Packaged-build verification: boots release/win-unpacked/JOYFRAME.exe against
 * two throwaway profiles and checks what the real installer payload renders.
 *
 *  - demo:  the in-app demo library — home rows, decoded artwork, Console Mode.
 *  - 1.0.0: a database built from scripts/fixtures/schema-1.0.0.sql, the schema
 *           the shipped build created, to prove an old profile still loads its
 *           library and home rows after an upgrade.
 *
 * Finish `npm run dist` first, then run:
 *
 *   npm run verify:dist
 *
 * Checks the payload from release/win-unpacked, so it covers what a dev build
 * never exercises (asar bundling, the jf-art protocol). Uses isolated profiles
 * under .verify-dist/ (gitignored) that are removed on exit. Exits 1 if the
 * build is missing or any reading fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  consoleProblems,
  createAppLog,
  createSession,
  delay,
  findWindow,
  MISSING_PACKAGED,
  preflight,
  removeDir,
  reportChecks
} from './cdp.mjs'
import { assertBuildFresh } from './build-fresh.mjs'
import { assertPackagedBuildFresh } from './packaged-build.mjs'
import { openDatabase } from '../src/main/services/db.ts'
import { buildHomeRows } from '../src/main/services/library.ts'
import { queryGames } from '../src/main/services/repo.ts'

const PORT = Number(process.env.JF_DIST_PORT ?? 9226)
const ROOT = '.verify-dist'
const EXE = path.join('release', 'win-unpacked', 'JOYFRAME.exe')

/** Added for every profile by verifyProfile: the seed and the asar boot. */
const BOOT_CHECKS = ['profile seeded', 'packaged window loads from the asar bundle']

/**
 * What each profile must report beyond the boot checks. A profile that returns
 * early (no window, failed seed) is missing these by name, and a renamed check
 * no longer matches, so neither can pass as a shorter run.
 */
const PROFILE_CHECKS = {
  demo: [
    'home rows and cards match the demo library',
    'home hero renders with metadata',
    'home hero and first-shelf artwork decode',
    'library lists the demo games',
    'console mode opens with populated shelves',
    'console hero renders with metadata',
    'console hero and first-shelf artwork decode'
  ],
  '1.0.0 profile': [
    'home rows and cards match the upgraded library',
    'library lists exactly the visible legacy games'
  ]
}

/** Every check a complete run reports, named exactly as the probe reports it. */
const EXPECTED_CHECKS = [
  ...Object.entries(PROFILE_CHECKS).flatMap(([label, names]) =>
    [...BOOT_CHECKS, ...names].map((name) => `${label}: ${name}`)
  ),
  'no renderer console errors in either boot'
]
const appLog = createAppLog('verify-dist')

/** The two surfaces under test: a container and the hero inside it. */
const HOME = { root: 'main[data-jf-view]', hero: 'section[aria-label="Featured game"]' }
const CONSOLE = { root: '[data-jf-console="1"]', hero: 'main > section' }

/** How many leading shelf cards are guaranteed on screen and therefore sampled. */
const SHELF_SAMPLE = 6

/** Rows, cards, hero text and raw artwork counts inside `root`. */
const layoutProbe = ({ root, hero }) => `(() => {
  const box = document.querySelector(${JSON.stringify(root)})
  if (!box) return null
  const heroBox = box.querySelector(${JSON.stringify(hero)})
  const decoded = (img) => img.complete && img.naturalWidth > 0
  const rows = [...box.querySelectorAll('section[aria-label]')]
    .map((el) => ({ label: el.getAttribute('aria-label'), cards: el.querySelectorAll('[data-game-id]').length }))
    .filter((row) => row.cards > 0)
  // SmartImage swaps a failed <img> for a gradient, so broken artwork shows up
  // as a missing element rather than as an image that never finishes loading.
  const heroImages = heroBox ? [...heroBox.querySelectorAll('img')] : []
  const shelf = [...box.querySelectorAll('section[aria-label]')].find((el) => el.querySelector('[data-game-id]'))
  // Only the leading cards of a shelf are on screen; the rest are lazy-loaded
  // and may never be requested, which is not a failure to report.
  const shelfCards = shelf ? [...shelf.querySelectorAll('[data-game-id]')].slice(0, ${SHELF_SAMPLE}) : []
  const shelfImages = shelfCards.flatMap((card) => [...card.querySelectorAll('img')])
  return {
    rows,
    cards: box.querySelectorAll('[data-game-id]').length,
    hero: heroBox ? heroBox.innerText.split('\\n').filter(Boolean).slice(0, 6) : null,
    heroImages: heroImages.length,
    heroDecoded: heroImages.filter(decoded).length,
    shelfCards: shelfCards.length,
    shelfImages: shelfImages.length,
    shelfDecoded: shelfImages.filter(decoded).length
  }
})()`

/**
 * 'settled' once the hero and sampled shelf artwork decode, 'missing' when an
 * image has fallen back to its gradient, else still 'pending'.
 */
const artState = (layout) => {
  const fellBack =
    (layout.hero !== null && layout.heroImages === 0) ||
    (layout.shelfCards > 0 && layout.shelfImages < layout.shelfCards)
  if (fellBack) return 'missing'
  const decoded =
    layout.heroImages > 0 &&
    layout.heroDecoded === layout.heroImages &&
    layout.shelfCards > 0 &&
    layout.shelfDecoded === layout.shelfImages
  return decoded ? 'settled' : 'pending'
}

/** Whether the hero art is absent altogether or merely still decoding. */
const artDetail = (layout) => {
  const hero = layout.heroImages === 0 ? 'missing' : `${layout.heroDecoded}/${layout.heroImages} decoded`
  const shelf =
    layout.shelfImages < layout.shelfCards
      ? `${layout.shelfCards - layout.shelfImages}/${layout.shelfCards} missing`
      : `${layout.shelfDecoded}/${layout.shelfImages} decoded`
  return `hero image ${hero}, shelf ${shelf}`
}

/** View id, populated rows with their card labels, and every card in the main view. */
const viewProbe = `(() => {
  const box = document.querySelector('main[data-jf-view]')
  if (!box) return null
  return {
    view: box.getAttribute('data-jf-view'),
    rows: [...box.querySelectorAll('section[aria-label]')]
      .map((el) => ({
        label: el.getAttribute('aria-label'),
        cards: [...el.querySelectorAll('[data-game-id]')].map((card) => card.getAttribute('aria-label') ?? '')
      }))
      .filter((row) => row.cards.length),
    cards: [...box.querySelectorAll('[data-game-id]')].map((el) => el.getAttribute('aria-label') ?? '')
  }
})()`

const cardLabel = (game) => `${game.title}, ${game.platformName ?? game.platformId}`
const cardCount = (rows) => rows.reduce((total, row) => total + row.cards.length, 0)

/** What the seeded profile's home and Library views must render, straight from its database. */
function expectedViews(profile) {
  // Read a copy: opening the profile itself would run the current seeding and
  // migrations before the packaged app's first boot, which is what the 1.0.0
  // check exists to test. The copy is thrown away with the profile.
  const copy = path.join(profile, 'expected.db')
  fs.copyFileSync(path.join(profile, 'joyframe.db'), copy)
  const db = openDatabase(copy)
  try {
    return {
      home: buildHomeRows(db).map((row) => ({ label: row.title, cards: row.games.map(cardLabel) })),
      library: queryGames(db)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(cardLabel)
    }
  } finally {
    db.close()
  }
}

/** First difference between the profile's expected view and what rendered, or null. */
function firstMismatch(expected, actual) {
  if (!actual) return 'nothing rendered'
  if (actual.view !== expected.view) return `showing ${actual.view}, expected ${expected.view}`
  if (expected.rows) {
    for (let i = 0; i < Math.max(actual.rows.length, expected.rows.length); i++) {
      const want = expected.rows[i]
      const got = actual.rows[i]
      if (!want) return `extra row "${got.label}"`
      if (!got) return `missing row "${want.label}"`
      if (got.label !== want.label) return `row ${i + 1} is "${got.label}", expected "${want.label}"`
      if (got.cards.length !== want.cards.length) {
        return `${want.label}: ${got.cards.length} cards, expected ${want.cards.length}`
      }
      const index = got.cards.findIndex((text, card) => text !== want.cards[card])
      if (index !== -1) return `${want.label}: card ${index + 1} is "${got.cards[index]}", expected "${want.cards[index]}"`
    }
    return null
  }
  if (actual.cards.length !== expected.cards.length) {
    return `${actual.cards.length} cards, expected ${expected.cards.length}`
  }
  const index = actual.cards.findIndex((text, card) => text !== expected.cards[card])
  return index === -1 ? null : `card ${index + 1} is "${actual.cards[index]}", expected "${expected.cards[index]}"`
}

/** Compare one view with the profile, reporting the first difference and the expected counts. */
async function compareView({ label, name, expected, read, check }) {
  const rendered = await read(
    viewProbe,
    (value) => value.view === expected.view && (expected.rows ? value.rows.length > 0 : value.cards.length > 0)
  )
  const mismatch = firstMismatch(expected, rendered)
  const counts = expected.rows
    ? `${expected.rows.length} rows, ${cardCount(expected.rows)} cards`
    : `${expected.cards.length} cards`
  check(`${label}: ${name}`, !mismatch, mismatch ?? counts)
}

async function checkDemoLibrary({ label, evaluate, read, readLayout, check, expected }) {
  await compareView({ label, name: 'home rows and cards match the demo library', expected: { view: 'home', rows: expected.home }, read, check })

  const home = await readLayout(HOME)
  check(
    `${label}: home hero renders with metadata`,
    (home?.hero?.length ?? 0) >= 4,
    home?.hero?.join(' · ') ?? 'no hero'
  )
  check(
    `${label}: home hero and first-shelf artwork decode`,
    Boolean(home) && artState(home) === 'settled',
    home ? artDetail(home) : 'no artwork'
  )

  await evaluate(`document.querySelector('button[aria-label="Library"]')?.click()`)
  await compareView({ label, name: 'library lists the demo games', expected: { view: 'library', cards: expected.library }, read, check })

  await evaluate(`document.querySelector('button[aria-label="Console Mode"]')?.click()`)
  const consoleMode = await readLayout(CONSOLE)
  check(
    `${label}: console mode opens with populated shelves`,
    Boolean(consoleMode) && consoleMode.rows.length >= 5 && consoleMode.cards >= 20,
    consoleMode
      ? `${consoleMode.rows.length} shelves: ${consoleMode.rows.map((row) => `${row.label} (${row.cards})`).join(', ')}`
      : 'overlay did not render'
  )
  check(
    `${label}: console hero renders with metadata`,
    Boolean(consoleMode) && (consoleMode.hero?.length ?? 0) >= 4,
    consoleMode?.hero?.join(' · ') ?? 'no hero'
  )
  check(
    `${label}: console hero and first-shelf artwork decode`,
    Boolean(consoleMode) && artState(consoleMode) === 'settled',
    consoleMode ? artDetail(consoleMode) : 'no artwork'
  )
}

async function checkLegacyProfile({ label, evaluate, read, check, expected }) {
  await compareView({ label, name: 'home rows and cards match the upgraded library', expected: { view: 'home', rows: expected.home }, read, check })

  await evaluate(`document.querySelector('button[aria-label="Library"]')?.click()`)
  await compareView({
    label,
    name: 'library lists exactly the visible legacy games',
    expected: { view: 'library', cards: expected.library },
    read,
    check
  })
}

async function main() {
  await preflight({
    label: 'verify:dist',
    port: PORT,
    portVariable: 'JF_DIST_PORT',
    needs: [{ file: EXE, remedy: MISSING_PACKAGED }]
  })
  assertBuildFresh({ label: 'verify:dist' })
  assertPackagedBuildFresh()

  removeDir(ROOT)
  const results = []
  const problems = []
  const check = (name, ok, detail) => results.push({ name, ok, detail })

  /** Seed one profile, boot the packaged app on it and run its checks. */
  const verifyProfile = async ({ label, profile, seeder, checks }) => {
    const seeded = spawnSync(process.execPath, [seeder, profile], { stdio: 'inherit' })
    check(`${label}: profile seeded`, seeded.status === 0, `exit=${seeded.status}`)
    if (seeded.status !== 0) return
    const expected = expectedViews(profile)

    const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.resolve(profile)}`], {
      stdio: appLog.stdio
    })

    try {
      const target = await findWindow(PORT)
      check(
        `${label}: packaged window loads from the asar bundle`,
        Boolean(target?.url.includes('app.asar')),
        target?.url ?? 'no window'
      )
      if (!target) return

      const { events, evaluate, read } = await createSession(target)
      const readLayout = (surface) =>
        read(layoutProbe(surface), (layout) => artState(layout) !== 'pending')

      await checks({ label, evaluate, read, readLayout, check, expected })

      problems.push(...consoleProblems(events, label))
    } finally {
      if (app.exitCode === null) {
        const exited = new Promise((resolve) => app.once('exit', resolve))
        app.kill()
        await Promise.race([exited, delay(4000)])
      }
    }
  }

  try {
    await verifyProfile({
      label: 'demo',
      profile: path.join(ROOT, 'demo'),
      seeder: 'scripts/seed-demo.ts',
      checks: checkDemoLibrary
    })
    await verifyProfile({
      label: '1.0.0 profile',
      profile: path.join(ROOT, '1.0.0'),
      seeder: 'scripts/seed-legacy.ts',
      checks: checkLegacyProfile
    })
  } finally {
    removeDir(ROOT)
  }

  check(
    'no renderer console errors in either boot',
    problems.length === 0,
    problems.length ? problems.slice(0, 5).join(' | ') : 'both boots clean'
  )

  const complete = reportChecks(results, { expected: EXPECTED_CHECKS, subject: 'packaged-build checks' })
  process.exit(complete ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  removeDir(ROOT)
  process.exit(1)
})
