#!/usr/bin/env node
/**
 * Enables Azure Artifact Signing (formerly Trusted Signing) for the
 * electron-builder Windows build — but only when the Azure secrets are
 * configured. With no secrets (local dev, forks, or before the signing
 * account exists) it exits quietly and the build stays unsigned, exactly
 * as today. Nothing is bought or provisioned here; adding the secrets
 * later is what turns signing on.
 *
 * When credentials are present but the account details are missing it
 * fails loudly instead of producing a build that looks signed but is not.
 *
 * Run in CI before `npm run dist`; it patches the workspace package.json
 * (ephemeral in CI) with `build.win.azureSignOptions` for electron-builder
 * v26, which signs the installer, uninstaller and app exe via the Azure
 * service using AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.
 */
import fs from 'node:fs'

const {
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  AZURE_SIGNING_ENDPOINT,
  AZURE_SIGNING_ACCOUNT,
  AZURE_SIGNING_PROFILE,
  AZURE_PUBLISHER_NAME
} = process.env

if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
  console.log(
    'Azure signing not configured (missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET) — building unsigned.'
  )
  process.exit(0)
}

const missing = Object.entries({
  AZURE_SIGNING_ENDPOINT,
  AZURE_SIGNING_ACCOUNT,
  AZURE_SIGNING_PROFILE,
  AZURE_PUBLISHER_NAME
})
  .filter(([, value]) => !value)
  .map(([key]) => key)
if (missing.length > 0) {
  console.error(
    `Azure signing credentials are present but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing — ` +
      'set all four secrets so the build signs with the intended publisher identity, or remove the credentials for an unsigned build.'
  )
  process.exit(1)
}

// Endpoint must be the regional Trusted Signing URI (e.g.
// https://eus.codesigning.azure.net/). A bare hostname or wrong service
// fails deep inside the signing module, so refuse it here with the fix.
if (!/^https:\/\/[^/]+\.codesigning\.azure\.net\/?$/.test(AZURE_SIGNING_ENDPOINT)) {
  console.error(
    `AZURE_SIGNING_ENDPOINT looks wrong: ${JSON.stringify(AZURE_SIGNING_ENDPOINT)} — ` +
      'expected the regional Trusted Signing URI, e.g. https://eus.codesigning.azure.net/.'
  )
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.build ??= {}
pkg.build.win ??= {}
pkg.build.win.azureSignOptions = {
  publisherName: AZURE_PUBLISHER_NAME,
  endpoint: AZURE_SIGNING_ENDPOINT,
  certificateProfileName: AZURE_SIGNING_PROFILE,
  codeSigningAccountName: AZURE_SIGNING_ACCOUNT,
  // Signatures without RFC 3161 timestamping expire with the certificate
  // (in practice ~3 days of validity). The Microsoft timestamp server keeps
  // a signed installer verifiable after the cert rotates, so this is not
  // optional even though electron-builder marks it as such.
  fileDigest: 'SHA256',
  timestampDigest: 'SHA256',
  timestampRfc3161: 'http://timestamp.acs.microsoft.com'
}
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
console.log(
  `Azure signing enabled (account ${AZURE_SIGNING_ACCOUNT}, profile ${AZURE_SIGNING_PROFILE}, publisher "${AZURE_PUBLISHER_NAME}").`
)
