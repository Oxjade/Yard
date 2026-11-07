import "server-only"
import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { getEnv } from "../env"
import { hmacB64url, hmacHex, safeEqual } from "../security/crypto"
import { keys } from "../security/keys"

/**
 * Anonymous visitors for chart signals (§6.3). The id is issued by the server, never chosen by
 * the client: `yard_anon = <16 random bytes>.<issuedAt>.<HMAC(keys.anon, id.issuedAt)>`,
 * httpOnly, SameSite=Lax, a year long. The actor id stored with an event is
 * `anon_` + HMAC(keys.anon, id).slice(0, 20), so the raw cookie is never stored. A signal
 * without a cookie, or with one issued less than 60 s earlier, is `excluded_anon`: a script that
 * drops cookies never counts, and one that keeps them is a single actor.
 */
export const ANON_COOKIE = "yard_anon"
export const ANON_ESTABLISHED_MS = 60_000
const YEAR_S = 365 * 24 * 3600

export const anonCookieName = () => (getEnv().cookieSecure ? "__Host-" : "") + ANON_COOKIE

const sign = (id: string, issuedAt: string) => hmacB64url(keys().anon, `${id}.${issuedAt}`)

/** The anonymous actor behind a cookie value, or null when it's missing or forged. */
export function anonActorId(cookieValue: string | undefined): { actorId: string; establishedMs: number; issuedAt: number } | null {
  if (!cookieValue) return null
  const m = /^([\w-]{22})\.([0-9a-z]{6,12})\.([\w-]{43})$/.exec(cookieValue)
  if (!m) return null
  const [, id, issued, mac] = m
  if (!safeEqual(mac, sign(id, issued))) return null
  const issuedAt = parseInt(issued, 36)
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000) return null
  return { actorId: `anon_${hmacHex(keys().anon, id).slice(0, 20)}`, establishedMs: Date.now() - issuedAt, issuedAt }
}

/** Issues a fresh yard_anon cookie on this response (Route Handlers only) and returns its value. */
export async function issueAnonCookie(): Promise<string> {
  const id = randomBytes(16).toString("base64url")
  const issued = Date.now().toString(36)
  const value = `${id}.${issued}.${sign(id, issued)}`
  const jar = await cookies()
  jar.set(anonCookieName(), value, { httpOnly: true, sameSite: "lax", path: "/", secure: getEnv().cookieSecure, maxAge: YEAR_S })
  return value
}

/** This request's anonymous actor (verified), or null. */
export async function currentAnon() {
  const jar = await cookies()
  return anonActorId(jar.get(anonCookieName())?.value)
}
