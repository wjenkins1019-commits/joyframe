#!/usr/bin/env node
/**
 * Says, at the end of `npm run check`, whether release/win-unpacked still
 * matches the build check just produced. Never fails: a source change is
 * expected to make the package stale, it just should not happen silently.
 */
import { packagedBuildProblem } from './packaged-build.mjs'

const problem = packagedBuildProblem()
if (!problem) {
  console.log('\nrelease/win-unpacked matches out/ — packaged checks need no rebuild.')
} else {
  console.log('\nNOTE  release/win-unpacked is stale for the build check just produced:')
  console.log(problem)
  console.log('Then reinstall: run `npm run verify:installed-build` to confirm the installed copy.')
}
