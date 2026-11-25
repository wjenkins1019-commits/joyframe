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
  }
]

const EXPECTED_CHECKS = [
  ...EXPECTED_ARTIFACTS.map((artifact) => artifact.label),
  'every failure upload is gated on failure()',
  'the dev artifact is still gated on the controller step',
  'the packaged artifact is still gated on the packaged-controller step',
  'the installer log uploads on any installer failure',
  'every failure upload keeps a run-attempt suffix',
  'every failure upload of a dot-directory opts into hidden files',
  'the installer log upload runs after the packaged suite',
  'the controller step names the artifact its summary lists',
  'the packaged step names both artifacts its summary lists',
  'the icon check names the installer log artifact'
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

const artifact = (name) => uploads.find((upload) => artifactName(upload.step) === name)
const dev = artifact(EXPECTED_ARTIFACTS[0].name)
const installerLog = artifact(EXPECTED_ARTIFACTS[1].name)
const packaged = artifact(EXPECTED_ARTIFACTS[2].name)

const expectGate = (label, upload, pattern) =>
  check(
    label,
    Boolean(upload && condition(upload.step).includes('failure()') && pattern.test(condition(upload.step))),
    upload ? `if: ${condition(upload.step) || '(none)'}` : 'upload missing'
  )

check(
  'every failure upload is gated on failure()',
  EXPECTED_ARTIFACTS.every((expected) => condition(artifact(expected.name)?.step ?? {}).includes('failure()')),
  EXPECTED_ARTIFACTS.map((expected) => condition(artifact(expected.name)?.step ?? {}) || '(missing)').join(' | ')
)
expectGate('the dev artifact is still gated on the controller step', dev, /steps\.controller\.outcome\s*==\s*'failure'/)
expectGate(
  'the packaged artifact is still gated on the packaged-controller step',
  packaged,
  /steps\.packaged-controller\.outcome\s*==\s*'failure'/
)
check(
  'the installer log uploads on any installer failure',
  Boolean(installerLog && condition(installerLog.step).trim() === 'failure()'),
  installerLog ? `if: ${condition(installerLog.step) || '(none)'}` : 'upload missing'
)

const failureUploads = uploads.filter((upload) => condition(upload.step).includes('failure()'))
check(
  'every failure upload keeps a run-attempt suffix',
  failureUploads.length > 0 &&
    failureUploads.every((upload) => artifactName(upload.step).endsWith(`-attempt-${ATTEMPT}`)),
  failureUploads.map((upload) => artifactName(upload.step) || '(unnamed)').join(' | ') || 'no failure uploads found'
)
const dottedUploads = failureUploads.filter((upload) => uploadsHidden(stepPaths(upload.step)))
check(
  'every failure upload of a dot-directory opts into hidden files',
  dottedUploads.every((upload) => upload.step.with?.['include-hidden-files'] === true),
  dottedUploads.map((upload) => `${artifactName(upload.step)}=${upload.step.with?.['include-hidden-files'] ?? '(unset)'}`).join(' | ')
)

// The upload must be reached after every step it has to cover, or its
// failure() gate can never see the failure it exists for.
const installerSteps = workflow.jobs.installer.steps ?? []
const logIndex = installerSteps.findIndex((step) => artifactName(step) === EXPECTED_ARTIFACTS[1].name)
const packagedIndex = installerSteps.findIndex((step) => step.id === 'packaged-controller')
check(
  'the installer log upload runs after the packaged suite',
  logIndex >= 0 && packagedIndex >= 0 && logIndex > packagedIndex,
  `log step ${logIndex}, packaged step ${packagedIndex}`
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
check(
  'the controller step names the artifact its summary lists',
  envArtifacts(devStep).includes(EXPECTED_ARTIFACTS[0].name),
  `JF_FAILURE_ARTIFACTS=${devStep?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}`
)
check(
  'the packaged step names both artifacts its summary lists',
  [EXPECTED_ARTIFACTS[2].name, EXPECTED_ARTIFACTS[1].name].every((name) => envArtifacts(packagedStep).includes(name)),
  `JF_FAILURE_ARTIFACTS=${packagedStep?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}`
)
check(
  'the icon check names the installer log artifact',
  envArtifacts(iconStep).includes(EXPECTED_ARTIFACTS[1].name),
  `JF_FAILURE_ARTIFACTS=${iconStep?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}`
)

const complete = reportChecks(results, { expected: EXPECTED_CHECKS, subject: 'workflow checks' })
process.exit(complete ? 0 : 1)
