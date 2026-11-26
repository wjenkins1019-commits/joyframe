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

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.build ??= {}
pkg.build.win ??= {}
pkg.build.win.azureSignOptions = {
  publisherName: AZURE_PUBLISHER_NAME,
  endpoint: AZURE_SIGNING_ENDPOINT,
  certificateProfileName: AZURE_SIGNING_PROFILE,
  codeSigningAccountName: AZURE_SIGNING_ACCOUNT
}
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
console.log(
  `Azure signing enabled (account ${AZURE_SIGNING_ACCOUNT}, profile ${AZURE_SIGNING_PROFILE}, publisher "${AZURE_PUBLISHER_NAME}").`
)
