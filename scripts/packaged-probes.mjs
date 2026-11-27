/**
 * The packaged probes: the one list `certify` builds its stages from and the
 * workflow self-test checks `check.yml` against.
 *
 * The same five probes used to be enumerated three times — `verify:packaged` in
 * package.json, `STAGES` in certify.mjs and the installer job's steps — and they
 * drifted: the intro dropdown probe ran everywhere locally and nowhere in CI,
 * and certify never ran it at all. Anything that enumerates these probes should
 * read this list instead.
 *
 * `script` is the npm script, `label` the stage text certify prints, `log` the
 * file the probe writes under .verify-logs/, `timeout` the step budget in
 * minutes, `artifact` the attempt-suffixed upload name check.yml uses, and
 * `packagedEnv` means the probe boots the package only when JOYFRAME_EXE says
 * so — without it, it would quietly test dev Electron.
 */
export const PACKAGED_PROBES = [
  {
    script: 'verify:dist',
    label: 'packaged app: demo and 1.0.0 profiles',
    log: 'verify-dist.log',
    timeout: 5,
    artifact: 'dist-profiles-artifacts-attempt'
  },
  {
    script: 'verify:first-run',
    label: 'packaged app: first run',
    log: 'verify-first-run.log',
    timeout: 3,
    artifact: 'first-run-artifacts-attempt'
  },
  {
    script: 'verify:intro-name-pad',
    label: 'packaged app: welcome name step',
    log: 'verify-intro-name-pad.log',
    timeout: 3,
    artifact: 'intro-name-pad-artifacts-attempt'
  },
  {
    script: 'verify:intro-ui',
    label: 'packaged app: intro dropdown modes',
    log: 'verify-intro-ui.log',
    timeout: 3,
    artifact: 'intro-ui-artifacts-attempt',
    packagedEnv: true
  },
  {
    script: 'verify:dist-pad',
    label: 'packaged app: controller suite',
    log: 'verify-dist-pad.log',
    timeout: 5,
    artifact: 'controller-suite-packaged-artifacts-attempt'
  }
]

/**
 * The subset release.yml boots before it stages a draft.
 *
 * The release job runs against the signed package, which no other job builds,
 * so it must boot it — but the controller suite and the name step are slower
 * than a tag build should wait for and are already proven on every push. These
 * are resolved through PACKAGED_PROBES rather than copied, so a renamed script
 * or a changed budget fails at import instead of drifting into the workflow.
 */
const RELEASE_SCRIPTS = ['verify:dist', 'verify:first-run', 'verify:intro-ui']

export const RELEASE_PROBES = RELEASE_SCRIPTS.map((script) => {
  const probe = PACKAGED_PROBES.find((candidate) => candidate.script === script)
  if (!probe) {
    throw new Error(`release.yml declares ${script}, which packaged-probes.mjs no longer defines`)
  }
  return probe
})
