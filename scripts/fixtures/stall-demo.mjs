/**
 * Throwaway demonstration: force exactly one stalled read.
 *
 * The warning path only fires when a value arrives but its predicate never
 * accepts it, which is rare on a healthy build. This runs that path once in a
 * real Actions step so the annotation and job-summary section the suite now
 * emits can be checked on an actual run page. It exits 0 on purpose: the point
 * is that a stall is a notice, not a failure.
 */
import { waitForValue } from '../cdp.mjs'

const value = await waitForValue(
  async () => ({ open: true, profileCard: false }),
  'demoState()',
  {
    timeout: 1200,
    ready: (state) => Boolean(state?.open && state?.profileCard),
    label: 'stall-demo'
  }
)

console.log(`stalled read returned ${JSON.stringify(value)} — the step itself stays green.`)
process.exit(0)
