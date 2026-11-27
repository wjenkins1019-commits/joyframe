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
  },
  {
    name: `installed-copy-artifacts-attempt-${ATTEMPT}`,
    label: 'the installed-copy artifact keeps its name, paths and hidden files',
    job: 'installed-checks',
    paths: ['.verify-logs/verify-installed.log', '.verify-intro'],
    hidden: true
  },
  {
    name: `update-channels-artifacts-attempt-${ATTEMPT}`,
    label: 'the update-channel artifact keeps its name, path and hidden files',
    job: 'no-gui-checks',
    paths: ['.verify-logs/verify-update-channels.log'],
    hidden: true
  },
  {
    name: `installer-matrix-artifacts-attempt-${ATTEMPT}`,
    label: 'the installer-matrix artifact keeps its name, path and hidden files',
    job: 'installed-checks',
    paths: ['.verify-logs/verify-installer-matrix.log'],
    hidden: true
  },
  {
    name: `intro-ui-artifacts-attempt-${ATTEMPT}`,
    label: 'the intro-dropdown artifact keeps its name, path and hidden files',
    job: 'installer',
    paths: ['.verify-logs/verify-intro-ui.log'],
    hidden: true
  },
  {
    name: `intro-pad-artifacts-attempt-${ATTEMPT}`,
    label: 'the controller intro-dropdown artifact keeps its name, path and hidden files',
    job: 'controller-checks',
    paths: ['.verify-logs/verify-intro-pad.log'],
    hidden: true
  },
  {
    name: `signing-artifacts-attempt-${ATTEMPT}`,
    label: 'the signing-readiness artifact keeps its name, path and hidden files',
    job: 'no-gui-checks',
    paths: ['.verify-logs/verify-signing.log'],
    hidden: true
  },
  {
    name: `intro-artifacts-attempt-${ATTEMPT}`,
    label: 'the startup-ident artifact keeps its name, both logs and hidden files',
    job: 'controller-checks',
    paths: ['.verify-logs/verify-intro.log', '.verify-logs/verify-intro-first-run.log'],
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
  'each probe step names the artifacts its summary lists',
  'every installer probe has a timeout that fits inside the job',
  'the dev controller probe has a timeout that fits inside the job',
  'the intro-pad probe runs in controller-checks and fits inside the job',
  'the intro probe runs in controller-checks and fits inside the job',
  'the installed-copy job installs the built package and runs the installed probe',
  'the update-channel probe runs in no-gui-checks and fits inside the job',
  'the update-channel upload follows its probe and only runs on that probe failure',
  'the signing probe runs in no-gui-checks, keeps its output and fits inside the job',
  'the installer-matrix probe runs per-user, uninstall and downgrade paths',
  'the installer-matrix upload follows its probe and only runs on that probe failure'
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
/** A step's shell text, whatever runner it uses. */
const runText = (step) => String(step?.run ?? '')
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

// A hung probe must fail on its own timeout while the job still runs, or the
// job timeout ends the job before its failure upload. Every probe needs a
// timeout, and together they must fit inside the job.
const probeSteps = installerSteps.filter((step) => step.run?.startsWith('npm run verify:'))
const probeTimeouts = probeSteps.map((step) => step['timeout-minutes'])
const probeMinutes = probeTimeouts.reduce((total, minutes) => total + minutes, 0)
check(
  'every installer probe has a timeout that fits inside the job',
  probeTimeouts.length > 0 &&
    probeTimeouts.every((minutes) => Number.isInteger(minutes) && minutes > 0) &&
    probeMinutes < workflow.jobs.installer['timeout-minutes'],
  `${probeSteps.map((step) => `${step.id ?? step.name} ${step['timeout-minutes'] ?? '(unset)'}m`).join(' | ')} — ${probeMinutes}m total`
)

// The dev controller suite has the same failure upload to reach, so a hang
// there needs a step timeout below the job's too.
const devJob = workflow.jobs['controller-checks']
const devProbe = (devJob?.steps ?? []).find((step) => step.id === 'controller')
const devTimeout = devProbe?.['timeout-minutes']
check(
  'the dev controller probe has a timeout that fits inside the job',
  Number.isInteger(devTimeout) && devTimeout > 0 && devTimeout < devJob['timeout-minutes'],
  `controller ${devTimeout ?? '(unset)'}m of ${devJob?.['timeout-minutes'] ?? '(unset)'}m`
)

// Every probe the controller job runs after the pad suite shares one contract:
// its command, a timeout inside the job budget, a position after the probe
// whose build it depends on, the artifact it exports and the upload that keeps
// its log when it fails.
function controllerProbe({ name, id, run, after, artifact }) {
  const steps = devJob?.steps ?? []
  const step = steps.find((candidate) => candidate.id === id)
  const upload = uploads.find((candidate) => artifactName(candidate.step) === `${artifact}-${ATTEMPT}`)
  const index = steps.findIndex((candidate) => candidate.id === id)
  const afterIndex = steps.findIndex((candidate) => candidate.id === after)
  const timeout = step?.['timeout-minutes']
  check(
    name,
    step?.run === run &&
      Number.isInteger(timeout) &&
      timeout > 0 &&
      timeout < devJob['timeout-minutes'] &&
      index > afterIndex &&
      String(step?.env?.JF_FAILURE_ARTIFACTS ?? '').includes(`${artifact}-`) &&
      gatesOnProbe(upload, id),
    step
      ? `run ${step.run}, timeout ${timeout}m of ${devJob['timeout-minutes']}m, step ${index} after ${after} ${afterIndex}, artifacts ${step?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}, upload ${upload ? condition(upload.step) : 'missing'}`
      : `step ${id} is missing`
  )
}

// The controller path to the intro dropdown has no keyboard equivalent, and the
// ident's own behaviour — auto-advance, the skip paths, never painting in `off`,
// playing once in `first-run` — is what the dropdown probes leave out. Both need
// the dev build `verify:pad` makes, hence `controller` as their predecessor.
controllerProbe({
  name: 'the intro-pad probe runs in controller-checks and fits inside the job',
  id: 'intro-pad',
  run: 'npm run verify:intro-pad',
  after: 'controller',
  artifact: 'intro-pad-artifacts-attempt'
})
controllerProbe({
  name: 'the intro probe runs in controller-checks and fits inside the job',
  id: 'intro',
  run: 'npm run verify:intro',
  after: 'intro-pad',
  artifact: 'intro-artifacts-attempt'
})

// The installed copy is the one thing CI could not prove: the installer job
// builds a package, and nothing installed it. Pin the chain — the package the
// installer job built and tested is uploaded, downloaded by this job and
// installed silently, then the probe runs — so dropping a link back to a
// hand-run command fails here instead of silently leaving the install untested.
const installedJob = workflow.jobs['installed-checks']
const installedSteps = installedJob?.steps ?? []
const packageUpload = uploads.find((upload) => artifactName(upload.step) === 'installer-bytes')
const packageDownload = installedSteps.find((step) => step.uses === 'actions/download-artifact@v4')
const installStep = installedSteps.find((step) => step.id === 'install')
const installedProbe = installedSteps.find((step) => step.run === 'npm run verify:installed')
const installCommand = String(installStep?.run ?? '')
const needsInstaller = [].concat(installedJob?.needs ?? []).includes('installer')
const silentInstall = installCommand.includes('/allusers') && installCommand.includes('/S')
const probeTimeout = installedProbe?.['timeout-minutes']
check(
  'the installed-copy job installs the built package and runs the installed probe',
  Boolean(installedJob) &&
    needsInstaller &&
    Boolean(packageUpload) &&
    packageUpload.jobId === 'installer' &&
    String(packageUpload.step.with?.path ?? '').includes('release/*.exe') &&
    packageDownload?.with?.name === 'installer-bytes' &&
    packageDownload?.with?.path === 'release' &&
    silentInstall &&
    Number.isInteger(probeTimeout) &&
    probeTimeout > 0 &&
    probeTimeout < installedJob['timeout-minutes'],
  installedJob
    ? [
        `needs ${[].concat(installedJob.needs ?? []).join(',') || '(none)'}`,
        `package upload ${packageUpload ? `${packageUpload.jobId}:${packageUpload.step.with?.path}` : '(missing)'}`,
        `download ${packageDownload ? `${packageDownload.with?.name} -> ${packageDownload.with?.path}` : '(missing)'}`,
        `install ${installCommand ? (silentInstall ? 'silent /allusers' : 'not silent') : '(missing)'}`,
        `probe ${probeTimeout ?? '(unset)'}m of ${installedJob['timeout-minutes'] ?? '(unset)'}m`
      ].join(' | ')
    : 'job installed-checks is missing'
)

// Channel isolation has to be proven on every push, not just on tags: the
// no-gui job owns it because it needs no Electron, only the workflow text,
// updates.ts and the live releases. The step carries its own attempt-suffixed
// artifact, a timeout inside the job budget, and a failure-gated upload.
const noGuiJob = workflow.jobs['no-gui-checks']
const noGuiSteps = noGuiJob?.steps ?? []
const channelStep = noGuiSteps.find((step) => step.id === 'update-channels')
const channelUpload = uploads.find((upload) => artifactName(upload.step) === 'update-channels-artifacts-attempt-${{ github.run_attempt }}')
check(
  'the update-channel probe runs in no-gui-checks and fits inside the job',
  channelStep?.run === 'npm run verify:update-channels' &&
    Number.isInteger(channelStep?.['timeout-minutes']) &&
    channelStep['timeout-minutes'] > 0 &&
    channelStep['timeout-minutes'] < noGuiJob['timeout-minutes'] &&
    String(channelStep?.env?.JF_FAILURE_ARTIFACTS ?? '').includes('update-channels-artifacts-attempt-') &&
    String(channelStep?.env?.GH_TOKEN ?? '') === '${{ github.token }}',
  channelStep
    ? `run ${channelStep.run}, timeout ${channelStep['timeout-minutes']}m of ${noGuiJob['timeout-minutes']}m, token ${channelStep?.env?.GH_TOKEN ? 'wired' : 'missing'}`
    : 'step update-channels is missing'
)
check(
  'the update-channel upload follows its probe and only runs on that probe failure',
  gatesOnProbe(channelUpload, 'update-channels'),
  channelUpload ? condition(channelUpload.step) : 'upload missing'
)

// Signing readiness is a second of static work that used to be proven only on
// a tag push, so it runs on every push with its stdout captured for the upload.
const signingStep = noGuiSteps.find((step) => step.id === 'signing')
const signingUpload = uploads.find((upload) => artifactName(upload.step) === `signing-artifacts-attempt-${ATTEMPT}`)
const signingRun = String(signingStep?.run ?? '')
check(
  'the signing probe runs in no-gui-checks, keeps its output and fits inside the job',
  signingRun.includes('npm run verify:signing') &&
    signingRun.includes('tee .verify-logs/verify-signing.log') &&
    Number.isInteger(signingStep?.['timeout-minutes']) &&
    signingStep['timeout-minutes'] > 0 &&
    signingStep['timeout-minutes'] < noGuiJob['timeout-minutes'] &&
    String(signingStep?.env?.JF_FAILURE_ARTIFACTS ?? '').includes('signing-artifacts-attempt-') &&
    gatesOnProbe(signingUpload, 'signing'),
  signingStep
    ? `timeout ${signingStep['timeout-minutes']}m of ${noGuiJob['timeout-minutes']}m, step ${noGuiSteps.findIndex((s) => s.id === 'signing')} after update-channels ${noGuiSteps.findIndex((s) => s.id === 'update-channels')}, artifacts ${signingStep?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}, upload ${signingUpload ? condition(signingUpload.step) : 'missing'}`
    : 'step signing is missing'
)

// The all-users path alone is not a matrix: the per-user scope, the
// uninstaller and the version advertisement need pins too, or a per-user
// install landing in Program Files (or an uninstaller wiping user data)
// stays green. The matrix step runs where the all-users copy already exists.
const matrixStep = installedSteps.find((step) => step.id === 'installer-matrix')
const matrixUpload = uploads.find((upload) => artifactName(upload.step) === 'installer-matrix-artifacts-attempt-${{ github.run_attempt }}')
check(
  'the installer-matrix probe runs per-user, uninstall and downgrade paths',
  matrixStep?.run === 'npm run verify:installer-matrix' &&
    Number.isInteger(matrixStep?.['timeout-minutes']) &&
    matrixStep['timeout-minutes'] > 0 &&
    matrixStep['timeout-minutes'] < installedJob['timeout-minutes'] &&
    installedSteps.findIndex((step) => step.id === 'installer-matrix') > installedSteps.findIndex((step) => step.id === 'installed') &&
    String(matrixStep?.env?.JF_FAILURE_ARTIFACTS ?? '').includes('installer-matrix-artifacts-attempt-'),
  matrixStep
    ? `run ${matrixStep.run}, timeout ${matrixStep['timeout-minutes']}m of ${installedJob['timeout-minutes']}m, artifacts ${matrixStep?.env?.JF_FAILURE_ARTIFACTS ?? '(unset)'}`
    : 'step installer-matrix is missing'
)
check(
  'the installer-matrix upload follows its probe and only runs on that probe failure',
  gatesOnProbe(matrixUpload, 'installer-matrix'),
  matrixUpload ? condition(matrixUpload.step) : 'upload missing'
)

// ---- release.yml: draft → verify → promote must stay ordered and silent ----
// Two tag-push failures (draft 404 on a new prerelease tag, signature module
// load on the stable promotion) only surfaced on a real push, because
// self-test covered check.yml only. These parse release.yml so the next
// draft/verify/promote, tag-guard, staging or signature-gate regression fails
// locally instead of on a tag.
const RELEASE_WORKFLOW = path.join('.github', 'workflows', 'release.yml')
let release = null
let releaseRaw = ''
try {
  releaseRaw = fs.readFileSync(RELEASE_WORKFLOW, 'utf8')
  release = YAML.load(releaseRaw)
} catch (error) {
  check('release workflow parses', false, String(error.message))
}
if (release) {
  const rJobs = release.jobs ?? {}
  const rWindows = rJobs['windows-installer'] ?? {}
  const rVerify = rJobs['verify-published'] ?? {}
  const rPromote = rJobs['promote-release'] ?? {}
  const rWindowsSteps = rWindows.steps ?? []
  const rVerifySteps = rVerify.steps ?? []
  const rPromoteSteps = rPromote.steps ?? []
  const needsOf = (job) => [].concat(job?.needs ?? [])

  check(
    'release jobs are ordered windows-installer → verify-published → promote-release',
    Boolean(rWindows.steps) &&
      needsOf(rVerify).includes('windows-installer') &&
      needsOf(rPromote).includes('verify-published'),
    `verify needs ${needsOf(rVerify).join(',') || '(none)'}, promote needs ${needsOf(rPromote).join(',') || '(none)'}`
  )

  // New prerelease tags own only a draft, which the `releases/tags/*`
  // endpoint 404s on with a read-only token. Write is the least privilege
  // that can read the draft this job must prove before promotion.
  const topPermissions = release.permissions?.contents ?? release.permissions
  check(
    'release keeps contents:write so draft lookups work',
    topPermissions === 'write' && rVerify.permissions?.contents === 'write',
    `top ${JSON.stringify(topPermissions)}, verify-published ${JSON.stringify(rVerify.permissions?.contents)}`
  )

  const guardIndex = rWindowsSteps.findIndex((s) => String(s?.name ?? '').toLowerCase().includes('guard tag'))
  const buildIndex = rWindowsSteps.findIndex((s) => runText(s).includes('npm run dist'))
  const guardText = guardIndex >= 0 ? runText(rWindowsSteps[guardIndex]) : ''
  check(
    'release tag guard runs before the build and refuses mismatched versions',
    guardIndex >= 0 &&
      buildIndex > guardIndex &&
      guardText.includes('v$pkg') &&
      guardText.includes('does not match package'),
    guardIndex >= 0 ? `guard step ${guardIndex}, build step ${buildIndex}` : 'guard step missing'
  )

  // A tag from a red tree must not reach a draft. The gate has to run before
  // the build, ask the API for this exact commit and fail on anything but a
  // green conclusion.
  const gateIndex = rWindowsSteps.findIndex((s) => s?.id === 'check-gate')
  const gate = gateIndex >= 0 ? rWindowsSteps[gateIndex] : null
  const gateText = runText(gate)
  check(
    'release requires a green check run for the commit before building',
    gateIndex >= 0 &&
      gateIndex < buildIndex &&
      String(gate?.env?.GH_TOKEN ?? '') === '${{ github.token }}' &&
      String(gate?.env?.SHA ?? '') === '${{ github.sha }}' &&
      gateText.includes('check.yml/runs?head_sha=$SHA') &&
      gateText.includes('conclusion') &&
      gateText.includes('::error::'),
    gate ? `gate step ${gateIndex} before build ${buildIndex}, sha ${gate?.env?.SHA ?? '(unset)'}` : 'gate step missing'
  )

  // The package that ships is signed, and check.yml only ever boots an unsigned
  // one. These three probes are the only proof of the bytes staged below, so
  // they must sit between `dist` and the first draft upload, each with a
  // timeout inside the job and a failure log of its own.
  const stageIndex = rWindowsSteps.findIndex((s) => String(s?.uses ?? '').startsWith('softprops/action-gh-release'))
  const releaseProblems = []
  for (const probe of [
    { script: 'verify:dist', artifact: 'dist-profiles-artifacts-attempt' },
    { script: 'verify:first-run', artifact: 'first-run-artifacts-attempt' },
    { script: 'verify:intro-ui', artifact: 'intro-ui-artifacts-attempt', packaged: true }
  ]) {
    const step = rWindowsSteps.find((s) => runText(s) === `npm run ${probe.script}`)
    if (!step) {
      releaseProblems.push(`${probe.script} missing`)
      continue
    }
    const index = rWindowsSteps.indexOf(step)
    const timeout = step['timeout-minutes']
    const uploadStep = rWindowsSteps.find((s) => artifactName(s) === `${probe.artifact}-${ATTEMPT}`)
    if (!(index > buildIndex && index < stageIndex)) {
      releaseProblems.push(`${probe.script} at ${index}, outside build ${buildIndex}..stage ${stageIndex}`)
    }
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout >= rWindows['timeout-minutes']) {
      releaseProblems.push(`${probe.script} timeout ${timeout ?? '(unset)'} of ${rWindows['timeout-minutes']}m`)
    }
    if (!uploadStep || !condition(uploadStep).includes(`steps.${step.id}.outcome == 'failure'`)) {
      releaseProblems.push(`${probe.script} failure upload`)
    }
    // Without this the probe boots dev Electron and proves nothing about the
    // package being staged.
    if (probe.packaged && !String(step?.env?.JOYFRAME_EXE ?? '').includes('win-unpacked')) {
      releaseProblems.push(`${probe.script} JOYFRAME_EXE ${step?.env?.JOYFRAME_EXE ?? '(unset)'}`)
    }
  }
  check(
    'release boots the signed package after dist and before staging the draft',
    releaseProblems.length === 0 && stageIndex > buildIndex,
    releaseProblems.join('; ') || `probes between build ${buildIndex} and stage ${stageIndex}`
  )

  const azureStep = rWindowsSteps.find((s) => runText(s).includes('enable-azure-signing.mjs'))
  const azureEnv = Object.keys(azureStep?.env ?? {})
  const azureKeys = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_SIGNING_ENDPOINT',
    'AZURE_SIGNING_ACCOUNT',
    'AZURE_SIGNING_PROFILE',
    'AZURE_PUBLISHER_NAME'
  ]
  check(
    'release azure step is ungated and carries all 7 secrets',
    Boolean(azureStep) && !azureStep.if && azureKeys.every((k) => azureEnv.includes(k)),
    azureStep ? `if: ${azureStep.if ?? '(none)'}, env ${azureEnv.join(',')}` : 'enable-azure-signing step missing'
  )

  const pkgStep = rWindowsSteps.find((s) => s?.id === 'pkg')
  const pkgText = runText(pkgStep)
  check(
    'release version/channel derivation matches the updater rule',
    Boolean(pkgStep) &&
      pkgText.includes('*-*') &&
      pkgText.includes('prerelease=true') &&
      pkgText.includes('prerelease=false') &&
      pkgText.includes('channel=') &&
      pkgText.includes('manifest='),
    pkgStep ? `id pkg ${pkgText.slice(0, 120).replace(/\s+/g, ' ')}…` : 'id pkg step missing'
  )

  const betaCopy = rWindowsSteps.find((s) => runText(s).includes('latest.yml') && runText(s).includes('manifest'))
  check(
    'release beta manifest copy is prerelease-gated',
    Boolean(betaCopy) && String(betaCopy.if ?? '').includes("steps.pkg.outputs.prerelease == 'true'"),
    betaCopy ? `if: ${betaCopy.if ?? '(none)'}` : 'beta copy step missing'
  )

  const stageStable = rWindowsSteps.find((s) => String(s?.name ?? '').toLowerCase().includes('draft (stable)'))
  const stageBeta = rWindowsSteps.find((s) => String(s?.name ?? '').toLowerCase().includes('draft (beta)'))
  const stageUsesAction = (s) => String(s?.uses ?? '').startsWith('softprops/action-gh-release')
  check(
    'release stable and beta drafts stay draft with correct prerelease flags',
    stageUsesAction(stageStable) &&
      stageStable.with?.draft === true &&
      stageStable.with?.prerelease === false &&
      String(stageStable.if ?? '').includes("prerelease == 'false'") &&
      stageUsesAction(stageBeta) &&
      stageBeta.with?.draft === true &&
      stageBeta.with?.prerelease === true &&
      String(stageBeta.if ?? '').includes("prerelease == 'true'"),
    `stable draft=${stageStable?.with?.draft} prerelease=${stageStable?.with?.prerelease} | beta draft=${stageBeta?.with?.draft} prerelease=${stageBeta?.with?.prerelease}`
  )

  const stableFiles = String(stageStable?.with?.files ?? '')
  const betaFiles = String(stageBeta?.with?.files ?? '')
  check(
    'release drafts stage latest.yml always and the channel manifest on beta',
    stableFiles.includes('latest.yml') &&
      stageStable?.with?.fail_on_unmatched_files === true &&
      betaFiles.includes('latest.yml') &&
      betaFiles.includes('manifest') &&
      stageBeta?.with?.fail_on_unmatched_files === true,
    `stable: ${stableFiles.replace(/\s+/g, ' ').slice(0, 120)} | beta: ${betaFiles.replace(/\s+/g, ' ').slice(0, 160)}`
  )

  const digestStep = rVerifySteps.find((s) => runText(s).includes('release digest') || runText(s).includes('expectedHash'))
  const digestText = runText(digestStep)
  check(
    'verify-published checks the download digest, size and latest.yml version',
    Boolean(digestStep) &&
      digestText.includes('Get-FileHash') &&
      digestText.includes('sha256') &&
      digestText.includes('latest.yml') &&
      digestText.includes('manifestVersion'),
    digestStep ? `download step found (${digestText.length} chars)` : 'download/digest step missing'
  )

  check(
    'verify-published checks the channel manifest version on prereleases',
    digestText.includes('channelFile') && digestText.includes('channelManifest'),
    digestText.includes('channelFile') ? 'channel check present' : 'no channel check in download step'
  )

  const sigSteps = rVerifySteps.filter((s) => runText(s).includes('verify-signature.mjs'))
  const sigGated = sigSteps.length === 2 && sigSteps.every((s) => runText(s).includes('--require-signed'))
  const sigConditional = sigSteps.every((s) => runText(s).includes('AZURE_TENANT_ID') || runText(s).includes('require'))
  check(
    'verify-published requires a Valid signature only when signing was on',
    sigGated && sigConditional,
    `${sigSteps.length} signature steps: ${sigSteps.map((s) => runText(s).slice(0, 80).replace(/\s+/g, ' ')).join(' | ') || '(none)'}`
  )

  const installStep = rVerifySteps.find((s) => s?.id === 'install')
  const installText = runText(installStep)
  check(
    'verify-published installs silently and waits for the exe',
    installText.includes('/allusers') && installText.includes('/S') && installText.includes('C:\\Program Files\\JOYFRAME\\JOYFRAME.exe'),
    installStep ? installText.slice(0, 140).replace(/\s+/g, ' ') : 'install step missing'
  )

  const bootStep = rVerifySteps.find((s) => s?.id === 'installed')
  check(
    'verify-published boots the published copy',
    runText(bootStep).includes('verify-installed.mjs'),
    bootStep ? runText(bootStep).slice(0, 80) : 'installed boot step missing'
  )

  const promoteText = rPromoteSteps.map(runText).join('\n')
  check(
    'promote-release publishes via gh release edit without touching prerelease',
    promoteText.includes('gh release edit') &&
      promoteText.includes('--draft=false') &&
      !promoteText.includes('--prerelease'),
    rPromoteSteps.length ? promoteText.slice(0, 160).replace(/\s+/g, ' ') : 'promote steps missing'
  )

  // A hung probe must fail on its own timeout while the job keeps running.
  const rProbeTimeouts = [...rWindowsSteps, ...rVerifySteps]
    .filter((s) => runText(s).startsWith('npm run verify:') || runText(s).includes('verify-signature.mjs'))
    .map((s) => s['timeout-minutes'])
  check(
    'release probes carry timeouts inside their job budgets',
    rProbeTimeouts.length > 0 &&
      rProbeTimeouts.every((m) => m === undefined || (Number.isInteger(m) && m > 0)) &&
      (rVerify['timeout-minutes'] ?? 0) > 0,
    `verify-published ${rVerify['timeout-minutes'] ?? '(unset)'}m, probe timeouts ${rProbeTimeouts.map((m) => m ?? '(none)').join(',')}`
  )

  const enablerText = fs.readFileSync('scripts/enable-azure-signing.mjs', 'utf8')
  check(
    'signing enabler emits timestamped azureSignOptions',
    ['publisherName', 'endpoint', 'certificateProfileName', 'codeSigningAccountName', 'timestampRfc3161', 'timestampDigest', 'timestamp.acs.microsoft.com'].every((token) =>
      enablerText.includes(token)
    ),
    'enable-azure-signing.mjs must pin the Microsoft RFC 3161 timestamp server'
  )
}

// ---- rollback.yml: yank a bad published release, prove the fallback ----
// A bad build that stays on `releases/latest` keeps reaching every stable
// install that checks. The rollback workflow converts it back to a draft and
// polls the same endpoint updaters resolve through until the prior stable
// serves again. These parse it so a dropped guard (identical tags, a draft
// or prerelease prior, a republish instead of a yank) fails locally.
const ROLLBACK_WORKFLOW = path.join('.github', 'workflows', 'rollback.yml')
let rollback = null
try {
  rollback = YAML.load(fs.readFileSync(ROLLBACK_WORKFLOW, 'utf8'))
} catch (error) {
  check('rollback workflow parses', false, String(error.message))
}
if (rollback) {
  const rbOn = rollback.on ?? rollback[true] ?? {}
  const rbInputs = rbOn.workflow_dispatch?.inputs ?? {}
  check(
    'rollback requires bad_tag and prior_tag inputs',
    rbInputs.bad_tag?.required === true && rbInputs.prior_tag?.required === true,
    `inputs: ${Object.keys(rbInputs).join(', ') || '(none)'}`
  )
  check(
    'rollback keeps contents:write to edit releases',
    (rollback.permissions?.contents ?? rollback.permissions) === 'write',
    `permissions ${JSON.stringify(rollback.permissions)}`
  )
  const rbYank = rollback.jobs?.yank ?? {}
  const rbVerify = rollback.jobs?.['verify-latest'] ?? {}
  check(
    'rollback verifies the prior stable before yanking',
    [].concat(rbVerify?.needs ?? []).includes('yank'),
    `verify-latest needs ${[].concat(rbVerify?.needs ?? []).join(',') || '(none)'}`
  )
  const rbText = [...(rbYank.steps ?? []), ...(rbVerify.steps ?? [])].map(runText).join('\n')
  check(
    'rollback refuses identical tags and requires a published stable prior',
    rbText.includes('bad_tag') &&
      rbText.includes('prior_tag') &&
      rbText.includes('prerelease') &&
      rbText.includes('draft') &&
      rbText.includes('latest.yml'),
    rbText ? `${rbText.length} chars of run text` : 'no run text'
  )
  check(
    'rollback yanks with gh release edit --draft without republishing',
    rbText.includes('gh release edit') &&
      rbText.includes('--draft') &&
      !rbText.includes('--draft=false') &&
      !rbText.includes('--prerelease'),
    'yank flips draft on only; the prerelease flag keeps its value'
  )
  check(
    'rollback verifies releases/latest resolves to the prior stable',
    rbText.includes('releases/latest') && rbText.includes('prior'),
    rbText.includes('releases/latest') ? 'polls the endpoint updaters resolve through' : 'no latest check'
  )
  const rbBudget = (job) => job?.['timeout-minutes'] ?? 0
  const rbSteps = [...(rbYank.steps ?? []), ...(rbVerify.steps ?? [])]
  const rbTimeouts = rbSteps.map((step) => step['timeout-minutes'])
  check(
    'rollback steps fit inside their job budgets',
    rbBudget(rbYank) > 0 &&
      rbBudget(rbVerify) > 0 &&
      rbTimeouts.every((minutes) => minutes === undefined || (Number.isInteger(minutes) && minutes > 0)) &&
      rbSteps.every((step, index) => {
        const budget = index < (rbYank.steps ?? []).length ? rbBudget(rbYank) : rbBudget(rbVerify)
        return step['timeout-minutes'] === undefined || step['timeout-minutes'] < budget
      }),
    `yank ${rbBudget(rbYank)}m, verify-latest ${rbBudget(rbVerify)}m`
  )
}

const ROLLBACK_CHECKS = [
  'rollback requires bad_tag and prior_tag inputs',
  'rollback keeps contents:write to edit releases',
  'rollback verifies the prior stable before yanking',
  'rollback refuses identical tags and requires a published stable prior',
  'rollback yanks with gh release edit --draft without republishing',
  'rollback verifies releases/latest resolves to the prior stable',
  'rollback steps fit inside their job budgets'
]

const RELEASE_CHECKS = [
  'release jobs are ordered windows-installer → verify-published → promote-release',
  'release keeps contents:write so draft lookups work',
  'release tag guard runs before the build and refuses mismatched versions',
  'release requires a green check run for the commit before building',
  'release boots the signed package after dist and before staging the draft',
  'release azure step is ungated and carries all 7 secrets',
  'release version/channel derivation matches the updater rule',
  'release beta manifest copy is prerelease-gated',
  'release stable and beta drafts stay draft with correct prerelease flags',
  'release drafts stage latest.yml always and the channel manifest on beta',
  'verify-published checks the download digest, size and latest.yml version',
  'verify-published checks the channel manifest version on prereleases',
  'verify-published requires a Valid signature only when signing was on',
  'verify-published installs silently and waits for the exe',
  'verify-published boots the published copy',
  'promote-release publishes via gh release edit without touching prerelease',
  'release probes carry timeouts inside their job budgets',
  'signing enabler emits timestamped azureSignOptions'
]

const complete = reportChecks(results, { expected: [...EXPECTED_CHECKS, ...RELEASE_CHECKS, ...ROLLBACK_CHECKS], subject: 'workflow checks' })
process.exit(complete ? 0 : 1)
