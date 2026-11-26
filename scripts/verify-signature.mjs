#!/usr/bin/env node
/**
 * Verify Authenticode signature on a Windows exe.
 *
 * Signed download-to-restart proof needs this: electron-updater refuses an
 * unsigned download, and updates.ts skips the check entirely on unsigned
 * installs. CI runs this on the published installer (and the installed copy)
 * so a signed beta proves the whole path, while unsigned builds stay green.
 *
 *   node scripts/verify-signature.mjs <exe>              # log status, pass either way
 *   node scripts/verify-signature.mjs <exe> --require-signed  # fail when not Valid
 *
 * Release workflow passes --require-signed only when the Azure secrets were
 * present for the build (signing was actually enabled). Local runs and
 * unsigned betas log `unsigned` and exit 0 so `npm run self-test` never goes
 * red before the signing account exists.
 */
import { execFile } from 'node:child_process'

const exe = process.argv[2]
const requireSigned = process.argv.includes('--require-signed')

if (!exe) {
  console.error('usage: node scripts/verify-signature.mjs <exe> [--require-signed]')
  process.exit(2)
}

function signatureStatus(exePath) {
  return new Promise((resolve, reject) => {
    const quoted = `'${exePath.replace(/'/g, "''")}'`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -FilePath ${quoted}).Status`],
      { timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}${stderr ? `: ${String(stderr).trim()}` : ''}`))
          return
        }
        resolve(String(stdout).trim())
      }
    )
  })
}

let status
try {
  status = await signatureStatus(exe)
} catch (error) {
  console.error(`signature check failed for ${exe}: ${error.message}`)
  process.exit(2)
}

console.log(`Authenticode status for ${exe}: ${status}`)

if (status === 'Valid') {
  console.log('PASS signature is Valid — signed download-to-restart path is enabled')
  process.exit(0)
}

if (requireSigned) {
  console.error(`FAIL expected a Valid Authenticode signature for ${exe}, got ${status} — signing was enabled but the binary is not signed`)
  process.exit(1)
}

console.log('unsigned build — updates stay disabled by design; add Azure signing secrets to prove the signed path')
process.exit(0)
