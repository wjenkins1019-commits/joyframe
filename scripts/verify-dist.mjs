#!/usr/bin/env node
/**
 * Packaged-build verification: boots release/win-unpacked/JOYFRAME.exe against
 * throwaway profiles and checks what the real installer payload renders.
 *
 *  - demo:  the in-app demo library — home rows, decoded artwork, Console Mode.
 *  - 1.0.0: a database built from scripts/fixtures/schema-1.0.0.sql, the schema
 *           the shipped build created, to prove an old profile still loads its
 *           library and home rows after an upgrade.
 *  - rom launch: a seeded ROM game behind a stub emulator, proving Play hands
 *           the emulator the ROM and the per-game switch persists.
 *  - multidisc launch: a two-disc set the packaged scan must group into one
 *           card with a Disc row per disc, proving the default-disc switch
 *           changes the file the stub receives.
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
  failureArtifacts,
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
  ],
  'rom launch': [
    'library opens the seeded ROM game',
    'the ROM switch is on by default',
    'Play passes the ROM to the emulator',
    'the switch turns off before saving',
    'Save profile reports the switch was saved',
    'the saved switch survives reopening the game page',
    'opting out launches the emulator without the ROM'
  ],
  'multidisc launch': [
    'packaged scan imports the set as one game',
    'library shows one card for the two-disc set',
    'game page lists one Disc row per disc',
    'Play launches the default disc',
    'Set default moves to the other disc',
    'Play launches the newly defaulted disc'
  ]
}

/** Every check a complete run reports, named exactly as the probe reports it. */
const EXPECTED_CHECKS = [
  ...Object.entries(PROFILE_CHECKS).flatMap(([label, names]) =>
    [...BOOT_CHECKS, ...names].map((name) => `${label}: ${name}`)
  ),
  'no renderer console errors in any boot'
]
const appLog = createAppLog('verify-dist')

/** The two surfaces under test: a container and the hero inside it. */
const HOME = { root: 'main[data-jf-view]', hero: 'section[aria-label="Featured game"]' }
const CONSOLE = { root: '[data-jf-console="1"]', hero: 'main > section' }

/** How many leading shelf cards are guaranteed on screen and therefore sampled. */
const SHELF_SAMPLE = 6

/** The ROM-launch profile's game and the stub emulator's argv record. */
const ROM_GAME = 'ROM Launch Probe'
const ROM_FILE = path.join('roms', `${ROM_GAME}.nes`)
const ROM_RECORD = 'stub-args.json'

/** The multi-disc profile's set: two cues the packaged scan must group. */
const MULTI_TITLE = 'Multidisc Launch Probe'
const MULTI_DISCS = [1, 2].map((disc) => path.join('roms', 'ps1', `${MULTI_TITLE} (Disc ${disc}).cue`))
const MULTI_RECORD = 'stub-args.json'

/** The game page's ROM switch and its launch button, as rendered in the packaged build. */
const ROM_DETAIL = `(() => {
  const detail = document.querySelector('[data-jf-detail="1"]')
  if (!detail) return null
  const switchLabel = [...detail.querySelectorAll('label')].find((entry) => entry.textContent.includes('Launch the ROM directly'))
  const toggle = switchLabel?.querySelector('input[type="checkbox"]')
  const play = [...detail.querySelectorAll('button')].find((entry) => ['Play', 'Resume'].includes(entry.textContent.trim()))
  return {
    open: true,
    switch: Boolean(toggle),
    direct: Boolean(toggle?.checked),
    canPlay: Boolean(play && !play.disabled),
    playLabel: play?.textContent.trim() ?? null
  }
})()`

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

/**
 * The per-game ROM switch has to be right in the packaged launcher, not just in
 * buildLaunchCommand: Play has to hand the stub the ROM, Save has to persist the
 * opt-out, and Play after reopening has to leave the ROM out.
 */
async function checkRomLaunch({ label, evaluate, read, check, profile }) {
  const record = path.join(profile, ROM_RECORD)
  const rom = path.join(profile, ROM_FILE)

  const openDetail = async () => {
    await evaluate(`document.querySelector('button[aria-label="Library"]')?.click()`)
    await read(`document.querySelector('main[data-jf-view]')?.getAttribute('data-jf-view') === 'library'`, Boolean)
    const card = await read(
      `(() => {
        const entry = [...document.querySelectorAll('[data-game-id]')].find((card) =>
          card.getAttribute('aria-label')?.startsWith(${JSON.stringify(ROM_GAME)})
        )
        return entry ? entry.getAttribute('aria-label') : null
      })()`,
      Boolean
    )
    if (!card) return null
    await evaluate(`(() => {
      const entry = [...document.querySelectorAll('[data-game-id]')].find((card) =>
        card.getAttribute('aria-label')?.startsWith(${JSON.stringify(ROM_GAME)})
      )
      entry?.click()
      return Boolean(entry)
    })()`)
    return read(ROM_DETAIL, (state) => Boolean(state?.open))
  }

  /** Clicks Play/Resume once the launcher has returned to idle and the button is enabled. */
  const clickPlay = () =>
    read(
      `(() => {
        const detail = document.querySelector('[data-jf-detail="1"]')
        const play = detail && [...detail.querySelectorAll('button')].find(
          (entry) => ['Play', 'Resume'].includes(entry.textContent.trim()) && !entry.disabled
        )
        if (!play) return null
        play.click()
        return play.textContent.trim()
      })()`,
      Boolean
    )

  /** The stub writes on process start; wait for that, not for a timer. */
  const waitForArgs = async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (fs.existsSync(record)) {
        try {
          return JSON.parse(fs.readFileSync(record, 'utf8'))
        } catch {
          /* the stub is still writing */
        }
      }
      await delay(100)
    }
    return null
  }

  const opened = await openDetail()
  check(
    `${label}: library opens the seeded ROM game`,
    Boolean(opened?.switch),
    opened ? `switch=${opened.direct ? 'on' : 'off'}` : 'game page did not open'
  )
  if (!opened) return
  check(`${label}: the ROM switch is on by default`, opened.direct, `switch=${opened.direct ? 'on' : 'off'}`)

  fs.rmSync(record, { force: true })
  const directPlay = await clickPlay()
  const directArgs = await waitForArgs()
  check(
    `${label}: Play passes the ROM to the emulator`,
    Boolean(directPlay) &&
      Array.isArray(directArgs) &&
      directArgs.length === 1 &&
      path.resolve(directArgs[0]) === path.resolve(rom),
    `button=${directPlay ?? 'missing'} stub=${JSON.stringify(directArgs)}`
  )

  const turnedOff = await read(
    `(() => {
      const detail = document.querySelector('[data-jf-detail="1"]')
      const switchLabel = [...detail.querySelectorAll('label')].find((entry) => entry.textContent.includes('Launch the ROM directly'))
      const toggle = switchLabel?.querySelector('input[type="checkbox"]')
      if (!toggle || !toggle.checked) return null
      toggle.click()
      return true
    })()`,
    Boolean
  )
  const off = await read(ROM_DETAIL, (state) => Boolean(state?.switch) && state.direct === false)
  check(
    `${label}: the switch turns off before saving`,
    Boolean(turnedOff && off),
    `switch=${off?.direct === false ? 'off' : 'unchanged'}`
  )

  const saveClicked = await evaluate(`(() => {
    const detail = document.querySelector('[data-jf-detail="1"]')
    const save = detail && [...detail.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Save profile')
    save?.click()
    return Boolean(save)
  })()`)
  const saved = await read(
    `(() => {
      const detail = document.querySelector('[data-jf-detail="1"]')
      const save = detail && [...detail.querySelectorAll('button')].find((entry) =>
        ['Save profile', 'Profile saved'].includes(entry.textContent.trim())
      )
      return save?.textContent.trim() ?? null
    })()`,
    (text) => text === 'Profile saved'
  )
  check(
    `${label}: Save profile reports the switch was saved`,
    Boolean(saveClicked) && saved === 'Profile saved',
    `button=${saved ?? 'missing'}`
  )

  const closed = await evaluate(`(() => {
    const detail = document.querySelector('[data-jf-detail="1"]')
    const back = detail && [...detail.querySelectorAll('button')].find((entry) => entry.textContent.includes('Back to library'))
    back?.click()
    return Boolean(back)
  })()`)
  await read(`!document.querySelector('[data-jf-detail="1"]')`, Boolean)
  const reopened = await openDetail()
  check(
    `${label}: the saved switch survives reopening the game page`,
    Boolean(closed) && Boolean(reopened?.switch) && reopened.direct === false,
    `switch=${reopened?.direct === false ? 'off' : 'on'}`
  )

  fs.rmSync(record, { force: true })
  const barePlay = await clickPlay()
  const bareArgs = await waitForArgs()
  check(
    `${label}: opting out launches the emulator without the ROM`,
    Boolean(barePlay) && Array.isArray(bareArgs) && bareArgs.length === 0,
    `button=${barePlay ?? 'missing'} stub=${JSON.stringify(bareArgs)}`
  )
}

/**
 * The two-disc set has to hold together in the packaged build, not just in
 * buildLaunchCommand: the packaged scan must group the cues into one card
 * with a Disc row per disc, and switching the default disc must change the
 * file the stub emulator receives.
 */
async function checkMultidiscLaunch({ label, evaluate, read, check, profile }) {
  const record = path.join(profile, MULTI_RECORD)
  const roms = path.join(profile, 'roms')
  const disc = (index) => path.join(profile, MULTI_DISCS[index])

  const scanned = await evaluate(`window.joyframe.scans.romFolders([${JSON.stringify(roms)}])`)
  check(
    `${label}: packaged scan imports the set as one game`,
    scanned?.added === 1 && (scanned?.errors?.length ?? 0) === 0,
    `added=${scanned?.added} errors=${JSON.stringify(scanned?.errors)}`
  )
  if (scanned?.added !== 1) return

  // The window exists before the shell mounts; driving it earlier silently
  // no-ops, so wait for the sidebar before clicking anything.
  await read(`Boolean(document.querySelector('button[aria-label="Library"]'))`, Boolean)
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Library"]')
    if (!button) return 'missing'
    button.click()
    return 'clicked'
  })()`)
  const library = await read(viewProbe, (value) => value.view === 'library' && value.cards.length > 0)
  check(
    `${label}: library shows one card for the two-disc set`,
    library?.view === 'library' && library?.cards.length === 1 && library.cards[0].startsWith(MULTI_TITLE),
    `click=${clicked} view=${library?.view} cards=${library ? library.cards.join(' | ') : 'none'}`
  )
  if (library?.cards.length !== 1) return

  await evaluate(`(() => {
    const entry = [...document.querySelectorAll('[data-game-id]')].find((card) =>
      card.getAttribute('aria-label')?.startsWith(${JSON.stringify(MULTI_TITLE)})
    )
    entry?.click()
    return Boolean(entry)
  })()`)
  // Method rows are the only `div.rounded-lg` blocks naming a cue file; the
  // badge is the row header's first span (a bare text search would also catch
  // the save-state slot's "Default" option elsewhere on the page).
  const readMethods = `(() => {
    const detail = document.querySelector('[data-jf-detail="1"]')
    if (!detail) return null
    const rows = [...detail.querySelectorAll('div.rounded-lg')].filter((row) =>
      row.querySelector('p')?.textContent.includes('.cue')
    )
    return rows.map((row) => {
      const spans = [...row.querySelectorAll(':scope > div > span')]
      return {
        badge: spans[0]?.textContent.trim() ?? null,
        label: spans[1]?.textContent.trim() ?? null,
        file: row.querySelector('p')?.textContent.trim() ?? null
      }
    })
  })()`
  const methods = await read(readMethods, Boolean)
  const badges = (methods ?? []).map((entry) => entry.badge).sort()
  const labels = (methods ?? []).map((entry) => entry.label).sort()
  check(
    `${label}: game page lists one Disc row per disc`,
    (methods?.length ?? 0) === 2 && badges.join('|') === 'Default|Disc' && labels.join('|') === 'Disc 1|Disc 2',
    methods ? `badges=${badges.join(',')} labels=${labels.join(',')}` : 'game page did not open'
  )
  if (methods?.length !== 2) return

  /** Clicks Play/Resume once the launcher has returned to idle and the button is enabled. */
  const clickPlay = () =>
    read(
      `(() => {
        const detail = document.querySelector('[data-jf-detail="1"]')
        const play = detail && [...detail.querySelectorAll('button')].find(
          (entry) => ['Play', 'Resume'].includes(entry.textContent.trim()) && !entry.disabled
        )
        if (!play) return null
        play.click()
        return play.textContent.trim()
      })()`,
      Boolean
    )

  /** The stub writes on process start; wait for that, not for a timer. */
  const waitForArgs = async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (fs.existsSync(record)) {
        try {
          return JSON.parse(fs.readFileSync(record, 'utf8'))
        } catch {
          /* the stub is still writing */
        }
      }
      await delay(100)
    }
    return null
  }

  fs.rmSync(record, { force: true })
  const firstPlay = await clickPlay()
  const firstArgs = await waitForArgs()
  check(
    `${label}: Play launches the default disc`,
    Boolean(firstPlay) &&
      Array.isArray(firstArgs) &&
      firstArgs.length === 1 &&
      path.resolve(firstArgs[0]) === path.resolve(disc(0)),
    `button=${firstPlay ?? 'missing'} stub=${JSON.stringify(firstArgs)}`
  )

  const switched = await evaluate(`(() => {
    const detail = document.querySelector('[data-jf-detail="1"]')
    if (!detail) return null
    const button = [...detail.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Set default')
    const row = button ? button.closest('div.rounded-lg') : null
    const want = row?.querySelector('p')?.textContent ?? ''
    if (!button || !want.includes('Disc 2')) return null
    button.click()
    return true
  })()`)
  const moved = await read(
    `(() => {
      const detail = document.querySelector('[data-jf-detail="1"]')
      if (!detail) return null
      const rows = [...detail.querySelectorAll('div.rounded-lg')].filter((row) =>
        row.querySelector('p')?.textContent.includes('.cue')
      )
      const row = rows.find((entry) =>
        entry.querySelector('p')?.textContent.includes(${JSON.stringify(path.basename(disc(1)))})
      )
      const badge = row?.querySelector(':scope > div > span')?.textContent.trim()
      return badge === 'Default' ? true : null
    })()`,
    Boolean
  )
  check(
    `${label}: Set default moves to the other disc`,
    Boolean(switched && moved),
    switched && moved
      ? 'default badge on the second disc'
      : switched
        ? 'default badge still on the first disc'
        : 'Set default button not found on the second disc'
  )
  if (!moved) return

  fs.rmSync(record, { force: true })
  const secondPlay = await clickPlay()
  const secondArgs = await waitForArgs()
  check(
    `${label}: Play launches the newly defaulted disc`,
    Boolean(secondPlay) &&
      Array.isArray(secondArgs) &&
      secondArgs.length === 1 &&
      path.resolve(secondArgs[0]) === path.resolve(disc(1)),
    `button=${secondPlay ?? 'missing'} stub=${JSON.stringify(secondArgs)}`
  )
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

      await checks({ label, evaluate, read, readLayout, check, expected, profile })

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
    await verifyProfile({
      label: 'rom launch',
      profile: path.join(ROOT, 'rom-launch'),
      seeder: 'scripts/seed-rom-launch.ts',
      checks: checkRomLaunch
    })
    await verifyProfile({
      label: 'multidisc launch',
      profile: path.join(ROOT, 'multidisc-launch'),
      seeder: 'scripts/seed-multidisc-launch.ts',
      checks: checkMultidiscLaunch
    })
  } finally {
    removeDir(ROOT)
  }

  check(
    'no renderer console errors in any boot',
    problems.length === 0,
    problems.length ? problems.slice(0, 5).join(' | ') : 'all boots clean'
  )

  const complete = reportChecks(results, {
    expected: EXPECTED_CHECKS,
    subject: 'packaged-build checks',
    artifacts: failureArtifacts()
  })
  process.exit(complete ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  removeDir(ROOT)
  process.exit(1)
})
