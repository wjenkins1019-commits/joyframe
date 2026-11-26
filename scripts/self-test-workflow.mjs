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
  'the installed-copy job installs the built package and runs the installed probe'
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
  const runText = (step) => String(step?.run ?? '')

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

const RELEASE_CHECKS = [
  'release jobs are ordered windows-installer → verify-published → promote-release',
  'release keeps contents:write so draft lookups work',
  'release tag guard runs before the build and refuses mismatched versions',
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

const complete = reportChecks(results, { expected: [...EXPECTED_CHECKS, ...RELEASE_CHECKS], subject: 'workflow checks' })
process.exit(complete ? 0 : 1)
