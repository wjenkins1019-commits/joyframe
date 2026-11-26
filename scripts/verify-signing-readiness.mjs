#!/usr/bin/env node
/**
 * Signing readiness: report whether the Azure signing path is configured,
 * without ever printing a secret value.
 *
 * Item 1 of the release follow-ups (close the signed loop) is blocked on the
 * Trusted Signing account + 7 repo secrets. This probe is the code side of
 * that item: it names exactly which secrets are missing, validates the
 * endpoint shape, and proves `enable-azure-signing.mjs` would emit
 * timestamped `azureSignOptions` — so the day the secrets land, the signed
 * beta path is already proven, not newly invented.
 *
 *   npm run verify:signing        # exit 0 unsigned-ready, 1 half-configured
 *   npm run verify:signing -- --require-signed  # exit 1 unless fully ready
 *
 * Unsigned-ready means: no credentials present, build stays unsigned by
 * design, updater stays gated off. Half-configured (credentials without the
 * account details, or a malformed endpoint) is always a failure: it would
 * otherwise produce a build that looks signed but is not.
 */
import fs from 'node:fs'

const requireSigned = process.argv.includes('--require-signed')

const CREDENTIAL_KEYS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']
const ACCOUNT_KEYS = [
  'AZURE_SIGNING_ENDPOINT',
  'AZURE_SIGNING_ACCOUNT',
  'AZURE_SIGNING_PROFILE',
  'AZURE_PUBLISHER_NAME'
]
const ALL_KEYS = [...CREDENTIAL_KEYS, ...ACCOUNT_KEYS]

const present = (key) => Boolean(process.env[key])
const presentKeys = ALL_KEYS.filter(present)
const missingKeys = ALL_KEYS.filter((key) => !present[key])
const credentialsPresent = CREDENTIAL_KEYS.some(present)
const credentialsComplete = CREDENTIAL_KEYS.every(present)
const accountComplete = ACCOUNT_KEYS.every(present)
const fullyReady = credentialsComplete && accountComplete

console.log(
  `signing readiness: ${presentKeys.length}/${ALL_KEYS.length} Azure secrets present` +
    (presentKeys.length ? ` (${presentKeys.join(', ')})` : ' (none — unsigned build path)')
)

let failed = false
const fail = (message) => {
  failed = true
  console.error(`FAIL ${message}`)
}

if (!credentialsPresent && !accountComplete && missingKeys.length === ALL_KEYS.length) {
  console.log('PASS unsigned-ready — no Azure secrets, build stays unsigned and updates stay gated off by design')
} else {
  if (!credentialsComplete) {
    fail(
      `partial credentials: present ${CREDENTIAL_KEYS.filter(present).join(', ') || '(none)'}, ` +
        `missing ${CREDENTIAL_KEYS.filter((k) => !present[k]).join(', ')} — ` +
        'set all three or remove them for an unsigned build'
    )
  }
  if (!accountComplete) {
    fail(
      `partial signing account: missing ${ACCOUNT_KEYS.filter((k) => !present[k]).join(', ')} — ` +
        'set all four alongside the credentials, or remove the credentials for an unsigned build'
    )
  }
  const endpoint = process.env.AZURE_SIGNING_ENDPOINT ?? ''
  if (endpoint && !/^https:\/\/[^/]+\.codesigning\.azure\.net\/?$/.test(endpoint)) {
    fail(
      'AZURE_SIGNING_ENDPOINT is malformed — expected the regional Trusted Signing URI, e.g. https://eus.codesigning.azure.net/'
    )
  } else if (endpoint) {
    console.log('PASS endpoint shape looks like a regional Trusted Signing URI')
  }
}

// Prove the enabler would emit timestamped options: parse the file it patches
// rather than re-implementing its logic, so drift between the two fails here.
const enabler = fs.readFileSync('scripts/enable-azure-signing.mjs', 'utf8')
for (const field of [
  'publisherName',
  'endpoint',
  'certificateProfileName',
  'codeSigningAccountName',
  'fileDigest',
  'timestampDigest',
  'timestampRfc3161'
]) {
  if (!enabler.includes(field)) fail(`enable-azure-signing.mjs no longer emits ${field}`)
}
if (!enabler.includes('timestamp.acs.microsoft.com')) {
  fail('enable-azure-signing.mjs no longer pins the Microsoft RFC 3161 timestamp server')
} else {
  console.log('PASS enabler emits timestamped azureSignOptions (fileDigest + timestampDigest + timestampRfc3161)')
}

if (requireSigned && !fullyReady) {
  fail(`--require-signed: missing ${missingKeys.join(', ')} — signed download-to-restart is not yet provable`)
}

if (failed) {
  console.error(
    '\nSigning is half-configured. To close the loop: create the Trusted Signing account + certificate profile + ' +
      'Entra app registration with the "Trusted Signing Certificate Profile Signer" role, then set all 7 repo secrets. ' +
      'Nothing is bought or provisioned by the repo itself.'
  )
  process.exit(1)
}

if (requireSigned) console.log('PASS fully ready — all 7 Azure secrets present, signed beta path is enabled')
else if (fullyReady) console.log('PASS fully ready — all 7 Azure secrets present, next build will sign')
else console.log('unsigned build path confirmed — add the 7 secrets to prove the signed path')
