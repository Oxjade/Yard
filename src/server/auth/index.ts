import "server-only"
import { lt, or, isNotNull } from "drizzle-orm"
import { db } from "../db"
import { authOauthStates } from "../db/schema/identity"
import { processDueErasures } from "./erasure"
import { purgeTokens } from "./tokens"

/**
 * AUTH v3 entry point. Callers keep using the F1 session helpers (dal.ts / session.ts) to get
 * the actor; this module adds the contract other areas need and the scheduled jobs.
 *
 * Scheduler wiring (src/server/schedulers.ts is F1's; the orchestrator adds):
 *   features.auth = () => import("./auth")
 *   every(13 * MIN, HOUR, () => runFeatureJob("auth", "processErasures"))
 *   every(17 * MIN, HOUR, () => runFeatureJob("auth", "purgeAuthState"))
 */
export const IMPL = "AUTH-v3-2026-11-08"

export { requireRecentReauth, reauthRequired, REAUTH_REQUIRED_FIELD } from "./reauth"
export { requestAccountDeletion, processDueErasures, type EraseHook } from "./erasure"
export { AUTH_EMAIL_TEMPLATES } from "./identity"

/** Expired or used sign-in OAuth states and single-use tokens older than a day. */
export async function purgeAuthState() {
  const d = await db()
  const states = await d
    .delete(authOauthStates)
    .where(or(isNotNull(authOauthStates.usedAt), lt(authOauthStates.expiresAt, new Date())))
    .returning({ id: authOauthStates.id })
  const tokens = await purgeTokens()
  return { oauthStates: states.length, tokens }
}

export const jobs = {
  processErasures: () => processDueErasures(),
  purgeAuthState: () => purgeAuthState(),
}
