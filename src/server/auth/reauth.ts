import "server-only"
import { writeAudit } from "../audit"
import { withTx } from "../db"
import { getEnv } from "../env"
import { HttpError, badRequest } from "../http/errors"
import type { Actor } from "./dal"
import { credentialsOf, type RequestMeta } from "./identity"
import { limitPerUser } from "./limits"
import { checkSecondFactor } from "./mfa"
import { verifyPassword } from "./passwords"
import { markReauth, sessionAuthOf } from "./session-auth"

/**
 * Re-authentication before sensitive actions (v3). `requireRecentReauth(session, maxAgeSec)` is
 * the contract other areas call (LEDGER payout approval, money actions, account deletion):
 * it passes when this session signed in or re-confirmed within `maxAgeSec`, otherwise it throws
 * 403 `forbidden` with `fields.reauth = "required"`; the client then calls POST /api/auth/reauth
 * and retries.
 *
 * What counts as re-confirming:
 *  - admin (real session): a TOTP code or a recovery code;
 *  - shopper / brand (real session): the password, or an OAuth round trip in mode `reauth`;
 *  - demo sessions: an explicit "demo confirm", in development only. A demo session in
 *    production can never pass, so a demo admin can't approve real money.
 */

export const REAUTH_REQUIRED_FIELD = "reauth"

export function reauthRequired(message = "Confirm it's you to continue.") {
  return new HttpError(403, "forbidden", message, { [REAUTH_REQUIRED_FIELD]: "required" })
}

export async function requireRecentReauth(session: { sessionId: string }, maxAgeSec: number): Promise<void> {
  const row = await sessionAuthOf(session.sessionId)
  const at = row?.reauthAt?.getTime() ?? 0
  if (!at || Date.now() - at > maxAgeSec * 1000) throw reauthRequired()
  if (row?.method === "demo" && !getEnv().dev) throw reauthRequired("Demo sessions can't confirm sensitive actions in production.")
}

/** Seconds since this session last re-confirmed (null when never). For the UI's countdowns. */
export async function reauthAge(sessionId: string) {
  const row = await sessionAuthOf(sessionId)
  return row?.reauthAt ? Math.floor((Date.now() - row.reauthAt.getTime()) / 1000) : null
}

export type ReauthInput = { password?: string; code?: string; recoveryCode?: string; demo?: boolean }

export async function reauthenticate(actor: Actor, input: ReauthInput, meta: RequestMeta) {
  await limitPerUser("reauth", actor.userId, meta.ipHash)
  const how = await sessionAuthOf(actor.sessionId)
  const isDemo = !how || how.method === "demo"
  if (isDemo) {
    if (!input.demo || !getEnv().dev) throw new HttpError(422, "rule", "Demo sessions can only confirm sensitive actions in development.")
    await withTx(() => markReauth(actor.sessionId, actor.userId))
    return { ok: true as const, method: "demo" as const }
  }
  if (actor.kind === "admin") {
    if (!input.code && !input.recoveryCode) throw badRequest({ code: "Enter the 6-digit code from your authenticator app." })
    const kind = await withTx(async () => {
      const k = await checkSecondFactor(actor.userId, { code: input.code, recoveryCode: input.code ? null : input.recoveryCode })
      if (k) {
        await markReauth(actor.sessionId, actor.userId, { mfa: true })
        await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "admin.reauthenticated", target: actor.name, subjectType: "session", subjectId: actor.sessionId, ipHash: meta.ipHash, meta: { factor: k } })
      }
      return k
    })
    if (!kind) throw badRequest(input.code ? { code: "That code didn't match. Try the newest code in your app." } : { recoveryCode: "That recovery code isn't valid or was already used." })
    return { ok: true as const, method: kind }
  }
  const cred = await credentialsOf(actor.userId)
  if (!cred?.passwordHash) throw new HttpError(422, "rule", "Your account signs in with Google or Apple. Confirm it's you with that provider (POST /api/auth/oauth/{provider}/start, mode reauth).")
  if (!input.password) throw badRequest({ password: "Enter your password." })
  if (!(await verifyPassword(input.password, cred.passwordHash))) throw badRequest({ password: "That password isn't right." })
  await withTx(() => markReauth(actor.sessionId, actor.userId))
  return { ok: true as const, method: "password" as const }
}
