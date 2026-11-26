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

function runPs(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? `: ${String(stderr).trim().slice(0, 400)}` : ''}`))
        return
      }
      resolve(String(stdout).trim())
    })
  })
}

async function signatureStatus(exePath) {
  const quoted = `'${exePath.replace(/'/g, "''")}'`
  // Windows PowerShell 5.1 owns Get-AuthenticodeSignature. Under CI the job
  // shell is PowerShell 7 (pwsh), where that cmdlet lives in
  // Microsoft.PowerShell.Security but the module can fail to autoload — the
  // exact failure that broke the 1.0.2 promotion run. Prefer 5.1 explicitly,
  // then fall back to pwsh with an explicit import.
  const ps51 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const command = `(Get-AuthenticodeSignature -FilePath ${quoted}).Status`
  try {
    return await runPs(ps51, ['-NoProfile', '-NonInteractive', '-Command', command])
  } catch (firstError) {
    return await runPs('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; ${command}`
    ]).catch(() => {
      throw firstError
    })
  }
}

let status
try {
  status = await signatureStatus(exe)
} catch (error) {
  if (requireSigned) {
    console.error(`signature check failed for ${exe}: ${error.message}`)
    process.exit(1)
  }
  console.log(`signature check unavailable for ${exe} — treating as unsigned (this runner cannot load Get-AuthenticodeSignature): ${String(error.message).slice(0, 200)}`)
  console.log('unsigned build — updates stay disabled by design; add Azure signing secrets to prove the signed path')
  process.exit(0)
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
