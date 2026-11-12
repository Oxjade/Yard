import "server-only"
import { auth0ConnectionLabel, auth0ConnectionOfSubject } from "../../lib/auth/auth0"
import { eq } from "drizzle-orm"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { oauthIdentities } from "../db/schema"
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

/**
 * How a shopper or brand session can re-confirm, for the client's re-auth ask:
 * "demo" (a demo session), "password", or the linked providers ("google", "apple", "apple,google",
 * "auth0:google-oauth2")
 * for an account with no password. Never names an API path: the client turns it into words.
 */
export async function reauthMethodsFor(session: { sessionId: string; userId: string }): Promise<string> {
  const how = await sessionAuthOf(session.sessionId)
  if (!how || how.method === "demo") return "demo"
  const cred = await credentialsOf(session.userId)
  if (cred?.passwordHash) return "password"
  return providersOf(session.userId)
}

async function providersOf(userId: string) {
  const d = await db()
  const rows = await d.select({ provider: oauthIdentities.provider, subject: oauthIdentities.subject }).from(oauthIdentities).where(eq(oauthIdentities.userId, userId))
  // Auth0 identities are named by their connection ("auth0:google-oauth2"), so the client can
  // send the owner straight back through the same social login.
  return [...new Set(rows.map((r) => (r.provider === "auth0" ? `auth0:${auth0ConnectionOfSubject(r.subject)}` : r.provider)))].sort().join(",")
}

const providerWords = (list: string) => {
  const names = [...new Set(list.split(",").filter(Boolean).map((p) => (p === "apple" ? "Apple" : p === "google" ? "Google" : p.startsWith("auth0:") ? auth0ConnectionLabel(p.slice(6)) : p)))]
  return names.length ? names.join(" or ") : "Google or Apple"
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
  if (!cred?.passwordHash) {
    // An OAuth-only account confirms through its provider (POST /api/auth/oauth/{provider}/start,
    // mode "reauth"); `fields.reauthWith` names the providers so the client can offer the button.
    const providers = await providersOf(actor.userId)
    throw new HttpError(422, "rule", `Your account signs in with ${providerWords(providers)}, so it has no password. Confirm it's you with ${providerWords(providers)} instead.`, { reauthWith: providers || "google,apple" })
  }
  if (!input.password) throw badRequest({ password: "Enter your password." })
  if (!(await verifyPassword(input.password, cred.passwordHash))) throw badRequest({ password: "That password isn't right." })
  await withTx(() => markReauth(actor.sessionId, actor.userId))
  return { ok: true as const, method: "password" as const }
}
