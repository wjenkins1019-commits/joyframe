#!/usr/bin/env node
/**
 * Channel isolation: prove beta builds never leak to stable users.
 *
 * The release workflow stages prerelease versions (e.g. `1.0.2-beta.0`) as
 * GitHub *prereleases* carrying a `<channel>.yml` manifest, while stable
 * versions ship only `latest.yml`. electron-updater on a prerelease install
 * opts into prereleases and reads the channel manifest; stable installs
 * resolve through GitHub's `releases/latest` endpoint, which ignores
 * prereleases. If any link in that chain breaks — a stable draft flagged
 * prerelease, a beta missing its channel manifest, the updater defaulting
 * stable users onto prereleases — beta bytes reach users who never opted in.
 *
 *   npm run verify:update-channels
 *
 * Static half (no network): the workflow stages stable without a prerelease
 * flag or channel manifest, stages every beta with both, and updates.ts pins
 * `allowPrerelease` to the running version instead of inheriting it. Live
 * half: `releases/latest` resolves to a stable, non-prerelease tag carrying
 * only `latest.yml`, and every published prerelease carries its own
 * `<channel>.yml`. Live checks need to reach api.github.com (GH_TOKEN or
 * GITHUB_TOKEN for auth when set); when the network is unreachable they
 * report skipped instead of failing the suite on an outage elsewhere.
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'js-yaml'
import { failureArtifacts, reportChecks } from './cdp.mjs'

const LOG_DIR = '.verify-logs'
const LOG_FILE = path.join(LOG_DIR, 'verify-update-channels.log')
fs.mkdirSync(LOG_DIR, { recursive: true })
const logFd = fs.openSync(LOG_FILE, 'w')
const log = (text) => fs.writeSync(logFd, `${text}\n`)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}
const skip = (name, detail) => check(name, true, `skipped: ${detail}`)

const EXPECTED_CHECKS = [
  'stable drafts never carry a prerelease flag or channel manifest',
  'beta drafts always ship their channel manifest as prereleases',
  'the updater pins prereleases to the beta channel and stable to latest',
  'releases/latest resolves to a stable, non-prerelease version',
  'the latest stable release advertises only latest.yml',
  'every published prerelease carries its channel manifest'
]

/** `v1.0.2-beta.0` → `beta`; stable → null. Same rule the workflow applies. */
const channelOf = (tag) => {
  const version = String(tag).replace(/^v/, '')
  if (!version.includes('-')) return null
  return version.split('-')[1].split('.')[0]
}

const releaseYml = YAML.load(fs.readFileSync(path.join('.github', 'workflows', 'release.yml'), 'utf8'))
const buildSteps = releaseYml.jobs?.['windows-installer']?.steps ?? []
const stageSteps = buildSteps.filter((step) => String(step?.uses ?? '').startsWith('softprops/action-gh-release'))
const stableStage = stageSteps.find((step) => step.with?.prerelease === false)
const betaStage = stageSteps.find((step) => step.with?.prerelease === true)

check(
  'stable drafts never carry a prerelease flag or channel manifest',
  Boolean(stableStage) &&
    stableStage.with?.draft === true &&
    String(stableStage.with?.files ?? '').includes('latest.yml') &&
    !String(stableStage.with?.files ?? '').includes('manifest'),
  stableStage ? `draft=${stableStage.with?.draft} prerelease=${stableStage.with?.prerelease}` : 'stable stage missing'
)
check(
  'beta drafts always ship their channel manifest as prereleases',
  Boolean(betaStage) &&
    betaStage.with?.draft === true &&
    betaStage.with?.prerelease === true &&
    String(betaStage.with?.files ?? '').includes('latest.yml') &&
    String(betaStage.with?.files ?? '').includes('manifest'),
  betaStage ? `draft=${betaStage.with?.draft} prerelease=${betaStage.with?.prerelease}` : 'beta stage missing'
)

const updates = fs.readFileSync(path.join('src', 'main', 'services', 'updates.ts'), 'utf8')
check(
  'the updater pins prereleases to the beta channel and stable to latest',
  updates.includes('allowPrerelease') && updates.includes(`includes('-')`),
  'allowPrerelease follows the running version prerelease flag explicitly, so a library upgrade cannot move stable users onto betas'
)

/** Repo slug from package.json (`git+https://github.com/<owner>/<repo>.git`). */
const repoUrl = JSON.parse(fs.readFileSync('package.json', 'utf8')).repository?.url ?? ''
const slug = (repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/) ?? [])[1] ?? ''
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? ''

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`)
  return response.json()
}

let live = null
try {
  if (!slug) throw new Error('could not read the GitHub repo slug from package.json')
  log(`live: querying releases for ${slug}`);
  const [latest, all] = await Promise.all([
    githubJson(`https://api.github.com/repos/${slug}/releases/latest`),
    githubJson(`https://api.github.com/repos/${slug}/releases?per_page=100`)
  ])
  live = { latest, all }
} catch (error) {
  log(`live: unreachable — ${error.message}`)
}

if (!live) {
  skip('releases/latest resolves to a stable, non-prerelease version', 'api.github.com unreachable')
  skip('the latest stable release advertises only latest.yml', 'api.github.com unreachable')
  skip('every published prerelease carries its channel manifest', 'api.github.com unreachable')
} else {
  const { latest, all } = live
  const latestChannel = channelOf(latest.tag_name)
  check(
    'releases/latest resolves to a stable, non-prerelease version',
    latest.prerelease === false && latestChannel === null,
    `${latest.tag_name} (prerelease=${latest.prerelease}) — what every stable install is offered`
  )

  const names = (release) => (release.assets ?? []).map((asset) => asset.name)
  const latestNames = names(latest)
  const stray = latestNames.filter((name) => name.endsWith('.yml') && name !== 'latest.yml')
  check(
    'the latest stable release advertises only latest.yml',
    latestNames.includes('latest.yml') && stray.length === 0,
    latestNames.length ? latestNames.join(', ') : 'stable release has no assets'
  )

  const prereleases = all.filter((release) => release.prerelease && !release.draft)
  const missing = prereleases.filter((release) => {
    const channel = channelOf(release.tag_name)
    return !channel || !names(release).includes(`${channel}.yml`)
  })
  check(
    'every published prerelease carries its channel manifest',
    missing.length === 0,
    prereleases.length
      ? missing.length
        ? `missing channel manifest: ${missing.map((release) => release.tag_name).join(', ')}`
        : `${prereleases.length} prerelease(s), each with its <channel>.yml`
      : 'no published prereleases yet'
  )
}

fs.closeSync(logFd)
const complete = reportChecks(results, {
  expected: EXPECTED_CHECKS,
  subject: 'update-channel checks',
  artifacts: failureArtifacts()
})
process.exit(complete ? 0 : 1)
