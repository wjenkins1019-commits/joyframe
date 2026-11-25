#!/usr/bin/env node
/**
 * Self-test for the workflow's failure-artifact contract.
 *
 * The failure uploads only run on a red CI job, so the contract between
 * check.yml and the probes — artifact names, paths, hidden directories and
 * run-attempt suffixes — was otherwise checked by pushing a throwaway branch
 * and reading a real failed run. A renamed artifact or a dropped path is
 * invisible to every local check. Parsing the workflow here catches that
 * before the probe does.
 *
 *   npm run self-test:workflow
 *
 * The checks also fail when an upload is added without an attempt suffix or
 * without opting into hidden files for a dot-directory, so the next artifact
 * inherits the same rules instead of recreating the collision.
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'js-yaml'
import { reportChecks } from './cdp.mjs'

const WORKFLOW = path.join('.github', 'workflows', 'check.yml')
const ATTEMPT = '${{ github.run_attempt }}'

/** The failure uploads the probes rely on: job, exact name, paths, hidden flag. */
const EXPECTED_ARTIFACTS = [
  {
    name: `controller-suite-dev-artifacts-attempt-${ATTEMPT}`,
    label: 'the dev controller artifact keeps its name, paths and hidden files',
    job: 'controller-checks',
    paths: ['.verify-shots', '.verify-logs/verify-pad.log'],
    hidden: true
  },
  {
    name: `installer-build-log-attempt-${ATTEMPT}`,
    label: 'the installer log artifact keeps its name and path',
    job: 'installer',
    paths: ['dist.log'],
    hidden: false
  },
  {
    name: `controller-suite-packaged-artifacts-attempt-${ATTEMPT}`,
    label: 'the packaged controller artifact keeps its name, paths and hidden files',
    job: 'installer',
    paths: ['.verify-shots', '.verify-logs/verify-dist-pad.log'],
    hidden: true
  },
  {
    name: `dist-profiles-artifacts-attempt-${ATTEMPT}`,
    label: 'the packaged profile artifact keeps its name, path and hidden files',
    job: 'installer',
    paths: ['.verify-logs/verify-dist.log'],
    hidden: true
  },
  {
    name: `first-run-artifacts-attempt-${ATTEMPT}`,
    label: 'the first-run artifact keeps its name, path and hidden files',
    job: 'installer',
    paths: ['.verify-logs/verify-first-run.log'],
    hidden: true
  }
]

const DIST_PROFILES = EXPECTED_ARTIFACTS[3]
const FIRST_RUN = EXPECTED_ARTIFACTS[4]

const EXPECTED_CHECKS = [
  ...EXPECTED_ARTIFACTS.map((artifact) => artifact.label),
  'every failure upload is gated on failure() and attempt-suffixed',
  'every failure upload of a dot-directory opts into hidden files',
  'the installer log uploads on any installer failure, after the packaged suite',
  'the packaged profile probes run after the packaged controller and before the log upload',
  'each packaged profile upload follows its probe and only runs on that probe failure',
  'each probe step names the artifacts its summary lists'
]

/** A step's `path:` is a block scalar; compare the non-empty lines as a set. */
const stepPaths = (step) =>
  String(step.with?.path ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
const sameSet = (actual, expected) =>
  actual.length === expected.length && expected.every((entry) => actual.includes(entry))
const condition = (step) => String(step.if ?? '')
/** The artifact's download name; the step's own `name` is only the job-log label. */
const artifactName = (step) => String(step.with?.name ?? '')
const uploadsHidden = (paths) =>
  paths.some((entry) => entry.split('/').some((part) => part.startsWith('.')))

let workflow
try {
  workflow = YAML.load(fs.readFileSync(WORKFLOW, 'utf8'))
} catch (error) {
  console.error(`Could not parse ${WORKFLOW} — ${error.message}`)
  process.exit(1)
}
if (!workflow?.jobs || typeof workflow.jobs !== 'object') {
  console.error(`${WORKFLOW} has no jobs to check.`)
  process.exit(1)
}

const uploads = []
for (const [jobId, job] of Object.entries(workflow.jobs)) {
  for (const step of job.steps ?? []) {
    if (typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact')) {
      uploads.push({ jobId, step })
    }
  }
}

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

/** Each expected upload must exist once, in its job, with its paths and flag. */
for (const expected of EXPECTED_ARTIFACTS) {
  const found = uploads.filter((upload) => artifactName(upload.step) === expected.name)
  const upload = found[0]
  const problems = []
  if (found.length !== 1) problems.push(`${found.length} uploads named ${expected.name}`)
  if (upload && upload.jobId !== expected.job) problems.push(`job ${upload.jobId}, expected ${expected.job}`)
  if (upload && !sameSet(stepPaths(upload.step), expected.paths)) {
    problems.push(`paths ${stepPaths(upload.step).join(', ') || '(none)'}, expected ${expected.paths.join(', ')}`)
  }
  if (upload && Boolean(upload.step.with?.['include-hidden-files']) !== expected.hidden) {
    problems.push(
      `include-hidden-files=${upload.step.with?.['include-hidden-files'] ?? '(unset)'}, expected ${expected.hidden}`
    )
  }
  check(expected.label, problems.length === 0, problems.join('; ') || `job ${expected.job}: ${expected.paths.join(', ')}`)
}

const installerLog = uploads.find((upload) => artifactName(upload.step) === EXPECTED_ARTIFACTS[1].name)

// A failure upload that is not gated, or could collide between attempts, is
// useless exactly when it is needed. Cover every failure-gated upload, so a
// future one inherits the rule too.
const failureUploads = uploads.filter((upload) => condition(upload.step).includes('failure()'))
check(
  'every failure upload is gated on failure() and attempt-suffixed',
  EXPECTED_ARTIFACTS.every((expected) =>
    failureUploads.some((upload) => artifactName(upload.step) === expected.name)
  ) && failureUploads.every((upload) => artifactName(upload.step).endsWith(`-attempt-${ATTEMPT}`)),
  failureUploads.map((upload) => `${artifactName(upload.step) || '(unnamed)'} [${condition(upload.step)}]`).join(' | ')
)

const dottedUploads = failureUploads.filter((upload) => uploadsHidden(stepPaths(upload.step)))
check(
  'every failure upload of a dot-directory opts into hidden files',
  dottedUploads.every((upload) => upload.step.with?.['include-hidden-files'] === true),
  dottedUploads
    .map((upload) => `${artifactName(upload.step)}=${upload.step.with?.['include-hidden-files'] ?? '(unset)'}`)
    .join(' | ') || 'no dot-directory uploads'
)

// The log upload has to be reached after every step it covers, or its
// failure() gate can never see the failure it exists for.
const installerSteps = workflow.jobs.installer.steps ?? []
const logIndex = installerSteps.findIndex((step) => artifactName(step) === EXPECTED_ARTIFACTS[1].name)
const packagedIndex = installerSteps.findIndex((step) => step.id === 'packaged-controller')
check(
  'the installer log uploads on any installer failure, after the packaged suite',
  Boolean(installerLog) && condition(installerLog.step).trim() === 'failure()' && logIndex > packagedIndex,
  installerLog
    ? `if: ${condition(installerLog.step) || '(none)'}, log step ${logIndex}, packaged step ${packagedIndex}`
    : 'upload missing'
)

const distProbeIndex = installerSteps.findIndex((step) => step.id === 'dist-profiles')
const firstRunProbeIndex = installerSteps.findIndex((step) => step.id === 'first-run')
const distUploadIndex = installerSteps.findIndex((step) => artifactName(step) === DIST_PROFILES.name)
const firstRunUploadIndex = installerSteps.findIndex((step) => artifactName(step) === FIRST_RUN.name)
check(
  'the packaged profile probes run after the packaged controller and before the log upload',
  packagedIndex >= 0 &&
    distProbeIndex > packagedIndex &&
    firstRunProbeIndex > distProbeIndex &&
    distUploadIndex > distProbeIndex &&
    firstRunUploadIndex > firstRunProbeIndex &&
    logIndex > firstRunUploadIndex,
  `packaged ${packagedIndex}, dist ${distProbeIndex}, dist upload ${distUploadIndex}, first run ${firstRunProbeIndex}, first-run upload ${firstRunUploadIndex}, log ${logIndex}`
)

const distUpload = uploads.find((upload) => artifactName(upload.step) === DIST_PROFILES.name)
const firstRunUpload = uploads.find((upload) => artifactName(upload.step) === FIRST_RUN.name)
const gatesOnProbe = (upload, stepId) =>
  Boolean(upload) &&
  condition(upload.step).includes('failure()') &&
  condition(upload.step).includes(`steps.${stepId}.outcome == 'failure'`)
check(
  'each packaged profile upload follows its probe and only runs on that probe failure',
  gatesOnProbe(distUpload, 'dist-profiles') && gatesOnProbe(firstRunUpload, 'first-run'),
  [distUpload, firstRunUpload].map((upload) => (upload ? condition(upload.step) : 'missing')).join(' | ')
)

/** The artifact names a probe step exports to its failure summary. */
const envArtifacts = (step) =>
  String(step?.env?.JF_FAILURE_ARTIFACTS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
const devStep = (workflow.jobs['controller-checks']?.steps ?? []).find((step) => step.id === 'controller')
const iconStep = installerSteps.find((step) => step.run === 'npm run verify:installer')
const packagedStep = installerSteps.find((step) => step.id === 'packaged-controller')
const distStep = installerSteps.find((step) => step.id === 'dist-profiles')
const firstRunStep = installerSteps.find((step) => step.id === 'first-run')
const namesIn = (step, names) => names.every((name) => envArtifacts(step).includes(name))
const envSummary = (label, step) => `${label}: ${envArtifacts(step).join(',') || '(unset)'}`
check(
  'each probe step names the artifacts its summary lists',
  namesIn(devStep, [EXPECTED_ARTIFACTS[0].name]) &&
    namesIn(iconStep, [EXPECTED_ARTIFACTS[1].name]) &&
    namesIn(packagedStep, [EXPECTED_ARTIFACTS[2].name, EXPECTED_ARTIFACTS[1].name]) &&
    namesIn(distStep, [DIST_PROFILES.name, EXPECTED_ARTIFACTS[1].name]) &&
    namesIn(firstRunStep, [FIRST_RUN.name, EXPECTED_ARTIFACTS[1].name]),
  [
    envSummary('dev', devStep),
    envSummary('icon', iconStep),
    envSummary('packaged', packagedStep),
    envSummary('dist', distStep),
    envSummary('first run', firstRunStep)
  ].join(' | ')
)

const complete = reportChecks(results, { expected: EXPECTED_CHECKS, subject: 'workflow checks' })
process.exit(complete ? 0 : 1)
