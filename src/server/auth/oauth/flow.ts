import "server-only"
import { randomBytes } from "node:crypto"
import { and, eq, gt, isNull } from "drizzle-orm"
import { cookies } from "next/headers"
import { writeAudit } from "../../audit"
import { db, withTx } from "../../db"
import { users } from "../../db/schema"
import { authOauthStates, oauthIdentities } from "../../db/schema/identity"
import { getEnv } from "../../env"
import { HttpError, badRequest, notConfigured } from "../../http/errors"
import { newId } from "../../ids"
import { log } from "../../log"
import { hmacB64url, open, safeEqual, seal, sha256b64url, sha256hex } from "../../security/crypto"
import { AUTH_COMPLETE_PATH, authKeys } from "../auth-env"
import { getBrandActor, getShopper } from "../dal"
import { assertEligible, credentialsOf, deletionPending, findUserByEmail, openSession, upsertCredentials, userById, type RequestMeta, type UserRow } from "../identity"
import { limitOauthStart } from "../limits"
import { markReauth } from "../session-auth"
import { auth0ConnectionOfSubject } from "../../../lib/auth/auth0"
import { auth0Connections, getProvider, ProviderNotConfigured, providerLabel, type ProviderId, type ProviderProfile } from "./providers"

/**
 * Google / Apple sign-in, linking and re-auth (v3).
 *
 * Start is a POST (CSRF-checked) that returns `{ url }`; the client navigates there. It inserts an
 * `auth_oauth_states` row (10 min) with a nonce and, for Google, a sealed PKCE verifier, and sets
 * a browser-binding cookie whose hash is on the row, so a callback only completes in the browser
 * that started it (no login CSRF). `state = id.HMAC(id|provider)` is verified with timingSafeEqual.
 *
 * The callback claims the row once, checks the binding, exchanges the code and verifies the ID
 * token (outside any transaction), then resolves the user in one short transaction and always
 * redirects to /auth/complete?provider=&mode=&result= (no return_to, nothing to open-redirect).
 *
 * Linking rules: an existing identity signs in its user. A new identity whose provider-verified
 * email matches an account with a VERIFIED email is linked to it; an unverified local account is
 * never auto-linked (result `link_required`: sign in with the password, then link in settings).
 */

export type OAuthMode = "signin" | "link" | "reauth"
export type OAuthActor = "shopper" | "brand"

export const OAUTH_RESULTS = [
  "signed_in",
  "linked",
  "reauthed",
  "cancelled",
  "invalid_state",
  "error",
  "not_configured",
  "identity_in_use",
  "already_linked",
  "link_required",
  "email_required",
  "email_unverified",
  "no_brand",
  "suspended",
  "reauth_mismatch",
] as const
export type OAuthResult = (typeof OAUTH_RESULTS)[number]

const STATE_TTL_MS = 10 * 60_000
const bindingCookie = () => (getEnv().cookieSecure ? "__Host-" : "") + "yard_oauth"
const stateMac = (id: string, provider: string) => hmacB64url(authKeys().oauthState, `${id}|${provider}`)
const vaultAad = (id: string) => `auth-oauth-state:${id}`

function pkce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = [...randomBytes(64)].map((b) => alphabet[b % alphabet.length]).join("")
  return { verifier, challenge: sha256b64url(verifier) }
}

export async function startOAuth(input: { provider: ProviderId; mode: OAuthMode; actor: OAuthActor; brandId?: string | null; connection?: string | null }, meta: RequestMeta) {
  await limitOauthStart(meta.ipHash)
  // Auth0: the button names the social connection; only the configured ones are accepted.
  let connection: string | null = null
  if (input.provider === "auth0" && input.connection) {
    if (!auth0Connections().some((c) => c.name === input.connection)) throw badRequest({ connection: "That sign-in option isn't available on this Yard." })
    connection = input.connection
  }
  let userId: string | null = null
  let sessionId: string | null = null
  if (input.mode !== "signin") {
    const current = input.actor === "shopper" ? await getShopper() : await getBrandActor()
    if (!current) throw new HttpError(401, "unauthenticated", "Sign in first.")
    // Yard setup sessions (founding brands) are not a sign-in of their own: no linking or re-auth through them.
    if (current.kind === "brand" && current.role === "yard_setup") throw new HttpError(403, "forbidden", "Yard setup can't link or confirm sign-in methods.")
    // Demo accounts never get Google/Apple identities: a linked identity would open them through a
    // real (non-demo) session that outlives the demo flags and passes re-auth in production.
    if (current.demo) throw new HttpError(422, "rule", "Demo accounts can't use Google or Apple sign-in.")
    userId = current.userId
    sessionId = current.sessionId
  }
  const provider = getProvider(input.provider)
  if (!provider.configured) throw notConfigured(`${providerLabel(input.provider)} sign-in isn't set up on this Yard yet.`)
  const id = randomBytes(16).toString("base64url")
  const nonce = randomBytes(16).toString("base64url")
  const binding = randomBytes(32).toString("base64url")
  const p = provider.usesPkce ? pkce() : null
  await withTx(async () => {
    const d = await db()
    await d.insert(authOauthStates).values({
      id,
      provider: input.provider,
      mode: input.mode,
      actor: input.actor,
      brandId: input.actor === "brand" ? (input.brandId ?? null) : null,
      userId,
      sessionId,
      codeVerifierEnc: p ? seal(p.verifier, vaultAad(id)) : null,
      nonce,
      bindingHash: sha256hex(binding),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    })
  })
  const jar = await cookies()
  jar.set(bindingCookie(), binding, { httpOnly: true, sameSite: "lax", secure: getEnv().cookieSecure, path: "/", maxAge: STATE_TTL_MS / 1000 })
  const url = provider.authorizeUrl({ state: `${id}.${stateMac(id, input.provider)}`, nonce, codeChallenge: p?.challenge ?? null, connection })
  return { url }
}

export function completeUrl(provider: ProviderId, result: OAuthResult, extra: { mode?: OAuthMode; actor?: OAuthActor } = {}) {
  const u = new URL(AUTH_COMPLETE_PATH, getEnv().publicUrl)
  u.searchParams.set("provider", provider)
  u.searchParams.set("result", result)
  if (extra.mode) u.searchParams.set("mode", extra.mode)
  if (extra.actor) u.searchParams.set("actor", extra.actor)
  return u.toString()
}

type CallbackInput = { code: string | null; state: string | null; error: string | null; appleUser: string | null }

/** Claims the state row once: verifies the MAC, the expiry, the provider and the browser binding. */
async function claimState(provider: ProviderId, state: string | null) {
  if (!state) return null
  const dot = state.indexOf(".")
  if (dot < 10) return null
  const id = state.slice(0, dot)
  if (!/^[\w-]{16,40}$/.test(id) || !safeEqual(state.slice(dot + 1), stateMac(id, provider))) return null
  const d = await db()
  const [row] = await d
    .update(authOauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(authOauthStates.id, id), eq(authOauthStates.provider, provider), isNull(authOauthStates.usedAt), gt(authOauthStates.expiresAt, new Date())))
    .returning()
  if (!row) return null
  const jar = await cookies()
  const binding = jar.get(bindingCookie())?.value
  jar.set(bindingCookie(), "", { httpOnly: true, sameSite: "lax", secure: getEnv().cookieSecure, path: "/", maxAge: 0 })
  if (!binding || !safeEqual(sha256hex(binding), row.bindingHash)) return null
  return row
}

const nameFrom = (p: ProviderProfile) => (p.name?.trim() || p.email?.split("@")[0] || "Yard shopper").slice(0, 80)

/**
 * One identity per provider per user, except Auth0, which fronts several social connections:
 * there it's one identity per connection (the `sub` prefix, e.g. "google-oauth2|…").
 */
async function sameProviderIdentity(provider: ProviderId, userId: string, subject: string) {
  const d = await db()
  const rows = await d
    .select({ id: oauthIdentities.id, subject: oauthIdentities.subject })
    .from(oauthIdentities)
    .where(and(eq(oauthIdentities.userId, userId), eq(oauthIdentities.provider, provider)))
  if (provider !== "auth0") return rows[0] ?? null
  const conn = auth0ConnectionOfSubject(subject)
  return rows.find((r) => auth0ConnectionOfSubject(r.subject) === conn) ?? null
}

async function identityBySubject(provider: ProviderId, subject: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(oauthIdentities)
    .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, subject)))
    .limit(1)
  return row ?? null
}

async function linkIdentity(provider: ProviderId, userId: string, p: ProviderProfile) {
  const d = await db()
  await d.insert(oauthIdentities).values({ id: newId("oid"), userId, provider, subject: p.subject, email: p.email, emailVerified: p.emailVerified ? 1 : 0, lastUsedAt: new Date() })
}

/** Resolves (or creates) the user for a sign-in. Returns the user or a result explaining why not. */
async function resolveSignInUser(provider: ProviderId, p: ProviderProfile): Promise<UserRow | OAuthResult> {
  const d = await db()
  const known = await identityBySubject(provider, p.subject)
  if (known) {
    await d.update(oauthIdentities).set({ lastUsedAt: new Date(), email: p.email ?? known.email }).where(eq(oauthIdentities.id, known.id))
    const u = await userById(known.userId)
    if (!u || (await deletionPending(u.id))) return "error"
    // Demo sign-in only ever opens DEMO accounts, and only through the demo route: an identity that
    // got linked to a demo account must not open a real session on it.
    if (u.demo) return "link_required"
    return u
  }
  if (!p.email) return "email_required"
  const existing = await findUserByEmail(p.email)
  if (existing) {
    if (existing.demo || (await deletionPending(existing.id))) return "link_required"
    const cred = await credentialsOf(existing.id)
    if (!p.emailVerified || !cred?.emailVerifiedAt) return "link_required"
    const already = await sameProviderIdentity(provider, existing.id, p.subject)
    if (already) return "link_required" // a different account of the same provider is linked already
    await linkIdentity(provider, existing.id, p)
    return existing
  }
  const id = newId("u")
  await d.insert(users).values({ id, kind: "shopper", name: nameFrom(p), email: p.email, status: "active", demo: false })
  await upsertCredentials(id, { emailVerifiedAt: p.emailVerified ? new Date() : null })
  await linkIdentity(provider, id, p)
  const u = await userById(id)
  return u ?? "error"
}

/** The callback. Never throws: every outcome is a redirect URL. */
export async function handleOAuthCallback(provider: ProviderId, input: CallbackInput, meta: RequestMeta): Promise<string> {
  let row: Awaited<ReturnType<typeof claimState>> = null
  try {
    row = await claimState(provider, input.state)
  } catch (e) {
    log.error(`[yard] auth: ${provider} state check failed`, e)
  }
  if (!row) return completeUrl(provider, "invalid_state")
  const mode = row.mode as OAuthMode
  const actor = row.actor as OAuthActor
  const done = (result: OAuthResult) => completeUrl(provider, result, { mode, actor })
  if (input.error) return done("cancelled")
  if (!input.code) return done("invalid_state")

  let profile: ProviderProfile
  try {
    const verifier = row.codeVerifierEnc ? open(row.codeVerifierEnc, vaultAad(row.id)) : null
    profile = await getProvider(provider).exchange({ code: input.code, codeVerifier: verifier, nonce: row.nonce, appleUser: input.appleUser })
  } catch (e) {
    if (e instanceof ProviderNotConfigured) return done("not_configured")
    log.error(`[yard] auth: ${provider} exchange failed`, e)
    return done("error")
  }
  // Auth0 fronts many social connections; only a provider-verified email is trusted (no
  // account is created or linked, and no session opened, on an unverified or missing one).
  if (provider === "auth0") {
    if (!profile.email) return done("email_required")
    if (!profile.emailVerified) return done("email_unverified")
  }

  try {
    // link / reauth must land in the same session that started it.
    if (mode !== "signin") {
      const current = actor === "shopper" ? await getShopper() : await getBrandActor()
      if (!current || current.userId !== row.userId || current.sessionId !== row.sessionId) return done("invalid_state")
      if (current.demo) return done("error") // defence in depth: start refuses demo sessions; never link or re-auth a demo account
      return await withTx(async () => {
        const known = await identityBySubject(provider, profile.subject)
        if (mode === "reauth") {
          if (!known || known.userId !== current.userId) return done("reauth_mismatch")
          await markReauth(current.sessionId, current.userId)
          return done("reauthed")
        }
        if (known) return done(known.userId === current.userId ? "linked" : "identity_in_use")
        const same = await sameProviderIdentity(provider, current.userId, profile.subject)
        if (same) return done("already_linked")
        await linkIdentity(provider, current.userId, profile)
        await writeAudit({ actor: { kind: actor === "brand" ? "brand" : "shopper", id: current.userId, name: current.name }, action: "auth.identity_linked", target: providerLabel(provider), subjectType: "user", subjectId: current.userId, ipHash: meta.ipHash, meta: { provider } })
        return done("linked")
      })
    }
    return await withTx(async () => {
      const resolved = await resolveSignInUser(provider, profile)
      if (typeof resolved === "string") return done(resolved)
      let brandId: string | null
      try {
        brandId = await assertEligible(actor, resolved, row!.brandId)
      } catch (e) {
        if (e instanceof HttpError && e.code === "suspended") return done("suspended")
        if (e instanceof HttpError) return done(actor === "brand" ? "no_brand" : "error")
        throw e
      }
      await openSession({ actor, user: resolved, brandId, method: provider, meta })
      return done("signed_in")
    })
  } catch (e) {
    log.error(`[yard] auth: ${provider} callback failed`, e)
    return done("error")
  }
}

/** Linked identities for the settings page. */
export async function listIdentities(userId: string) {
  const d = await db()
  const rows = await d.select().from(oauthIdentities).where(eq(oauthIdentities.userId, userId))
  return rows.map((r) => ({ id: r.id, provider: r.provider as ProviderId, email: r.email, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }))
}

/** Unlinks one identity, as long as another way to sign in remains (a password or another identity). */
export async function unlinkIdentity(actor: { userId: string; name: string; kind: "shopper" | "brand" }, identityId: string, meta: RequestMeta) {
  return withTx(async () => {
    const d = await db()
    const all = await d.select().from(oauthIdentities).where(eq(oauthIdentities.userId, actor.userId))
    const target = all.find((r) => r.id === identityId)
    if (!target) throw new HttpError(404, "not_found", "We couldn't find that sign-in method.")
    const cred = await credentialsOf(actor.userId)
    if (!cred?.passwordHash && all.length <= 1) throw new HttpError(422, "rule", "Set a password before removing your only sign-in method.")
    await d.delete(oauthIdentities).where(and(eq(oauthIdentities.id, identityId), eq(oauthIdentities.userId, actor.userId)))
    await writeAudit({ actor: { kind: actor.kind, id: actor.userId, name: actor.name }, action: "auth.identity_unlinked", target: providerLabel(target.provider as ProviderId), subjectType: "user", subjectId: actor.userId, ipHash: meta.ipHash, meta: { provider: target.provider } })
    return { ok: true as const }
  })
}

export const parseProvider = (v: string | undefined): ProviderId => {
  if (v === "google" || v === "apple" || v === "auth0") return v
  throw badRequest({ provider: "Use google, apple or auth0." })
}
