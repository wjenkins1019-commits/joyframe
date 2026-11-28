import type { AppSettings, SettingsPatch } from '../../shared/types.ts'
import type { Db } from './db.ts'
import type { MetadataDeps } from './metadata.ts'
import { verifyIgdbCredentials, verifyRawgKey } from './metadata.ts'
import { getSettings, updateSettings } from './settings.ts'

export type SettingsPatchResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; problem: string }

/**
 * Store a settings patch, checking provider credentials against their service
 * first, so wrong credentials are rejected here instead of failing on the next
 * metadata refresh.
 *
 * - A RAWG key is trimmed once here, so a whitespace-only value clears the
 *   stored key instead of being sent to RAWG as a bad one.
 * - IGDB is a pair: a patch touching either half is checked as the pair it
 *   would become, filling the untouched half from what is already stored. Half
 *   a pair (an ID with no secret, or a cleared secret) cannot be checked, so it
 *   is stored as typed and the pair is checked when the other half arrives.
 *
 * A refused patch writes nothing at all, so working credentials survive a
 * failed replacement. The messages never contain a credential, and nothing here
 * is logged.
 *
 * This lives outside ipc.ts so the smoke test can exercise the real guard
 * without Electron; ipc.ts only throws the problem as the IPC error.
 */
export async function applySettingsPatch(
  db: Db,
  deps: MetadataDeps,
  patch: SettingsPatch
): Promise<SettingsPatchResult> {
  const current = getSettings(db)
  const next: SettingsPatch = { ...patch }

  const rawgKey = patch.rawgApiKey?.trim()
  if (rawgKey !== undefined) next.rawgApiKey = rawgKey
  if (rawgKey) {
    const problem = await verifyRawgKey(deps, rawgKey)
    if (problem) return { ok: false, problem }
  }

  if (patch.igdbClientId !== undefined || patch.igdbClientSecret !== undefined) {
    const clientId = (patch.igdbClientId ?? current.igdbClientId).trim()
    const clientSecret = (patch.igdbClientSecret ?? current.igdbClientSecret).trim()
    if (patch.igdbClientId !== undefined) next.igdbClientId = clientId
    if (patch.igdbClientSecret !== undefined) next.igdbClientSecret = clientSecret
    if (clientId && clientSecret) {
      const problem = await verifyIgdbCredentials(deps, clientId, clientSecret)
      if (problem) return { ok: false, problem }
    }
  }

  return { ok: true, settings: updateSettings(db, next) }
}
