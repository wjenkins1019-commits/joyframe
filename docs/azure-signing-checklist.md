# JOYFRAME — Azure signing setup checklist

Goal: 7 repo secrets set → signed beta (`1.0.3-beta.0`) → `verify:signature --require-signed` green → download-to-restart proven. Nothing in the repo buys or provisions anything; this checklist is the only manual part.

## Costs (verify current pricing before buying)

- **Basic: ~$9.99/month** — up to 5,000 signatures/month, then ~$0.005 per extra signature. Enough for JOYFRAME (a few signed files per build).
- **Premium: ~$99.99/month** — up to 100,000 signatures. Not needed unless volume grows.
- Billing is **not prorated**: the full month is invoiced from account creation. Service is now sold as **Azure Artifact Signing** (new name for Trusted Signing); docs/roles may show either name.

## Eligibility

- **Certificate profile type must be Public Trust** (what public users install). Requires identity validation of the publisher.
- **Organizations:** USA, Canada, EU, UK. **Individuals:** USA and Canada only. Outside that, use a CA-issued OV/EV code-signing certificate instead (~$129+/yr) — the repo's signing step would need a different backend.
- Publisher name on the certificate must exactly match `AZURE_PUBLISHER_NAME`.

## Azure setup (portal)

1. Subscription → register the `Microsoft.CodeSigning` resource provider.
2. Create a **Trusted/Artifact Signing account**: resource group + region (e.g. East US). **Remember the region — the endpoint depends on it.** SKU: Basic.
3. **Identity validation** (portal only): account → Identity validations → New Organization → **Public**. Submit legal-entity details; wait for approval.
4. **Certificate profile**: create a **Public Trust** profile in the account. Note its exact name → `AZURE_SIGNING_PROFILE`. Note the account name → `AZURE_SIGNING_ACCOUNT`.
5. **Endpoint**: the account's regional endpoint, form `https://<region>.codesigning.azure.net/` → `AZURE_SIGNING_ENDPOINT`.
6. **Entra ID**: App registration → client secret → `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`; tenant → `AZURE_TENANT_ID`.
7. **Role assignment** on the account (IAM → Add role assignment): grant the app registration **"Trusted Signing Certificate Profile Signer"** (may appear as "Artifact Signing Certificate Profile Signer"). Without this, builds fail at signing time.

## The 7 repo secrets (`Settings → Secrets → Actions`)

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_CLIENT_ID` | App registration client ID |
| `AZURE_CLIENT_SECRET` | App registration client secret |
| `AZURE_SIGNING_ENDPOINT` | Regional URI, e.g. `https://eus.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT` | Signing account name |
| `AZURE_SIGNING_PROFILE` | Public Trust certificate profile name |
| `AZURE_PUBLISHER_NAME` | Exactly the certificate's CN |

Partial setup always fails loudly (build refuses half-configured signing rather than shipping fake-signed bytes).

## Verify before cutting the beta

- `npm run verify:signing` → names which secrets exist; no values ever printed.
- `npm run verify:signing -- --require-signed` → must print **PASS fully ready — all 7 Azure secrets present**. Today it fails with 0/7, which is the correct red.
- The enabler already pins timestamping (`fileDigest` + `timestampDigest` SHA256, `timestampRfc3161: http://timestamp.acs.microsoft.com`) so signatures outlive cert rotation.

## SmartScreen expectations

- A **valid signature ≠ no warnings**. New publishers have no reputation: expect "Unknown publisher" / "Windows protected your PC" SmartScreen prompts on first releases **despite** correct signing.
- Reputation builds with install volume + time. Keep the **same publisher name and certificate profile** across releases; renaming resets trust.
- Timestamping (already configured) keeps old installers verifiable after cert renewal.
- Tell beta testers to use More info → Run anyway on the first signed build. Optionally submit the installer to Microsoft for malware-analysis review to speed reputation.

## After the secrets are set (runbook)

1. Bump to `1.0.3-beta.0`, commit, tag `v1.0.3-beta.0`, push.
2. Dispatch `release.yml` → draft staged as prerelease with `beta.yml` + `latest.yml`.
3. `verify-published` must show `--require-signed` green on the downloaded installer **and** the installed exe (`Status: Valid`).
4. Promote to prerelease; confirm `releases/latest` still points at stable `v1.0.2` (stable users unaffected).
5. Install the signed beta, run full suite (guard self-test, workflow self-test, installer matrix) green, confirm the updater gate opens on the signed exe.
