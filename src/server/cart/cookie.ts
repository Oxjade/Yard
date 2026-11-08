import "server-only"
import { cookies } from "next/headers"
import { getEnv } from "../env"
import { randomToken } from "../ids"
import { hmac, hmacB64url, safeEqual, sha256hex } from "../security/crypto"
import { keys } from "../security/keys"

/**
 * The anonymous cart cookie: `yard_cart = <32-byte token>.<HMAC(cartKey, token)>`, httpOnly,
 * SameSite=Lax, 60 days. The database stores only sha256(token) (carts.anon_key), so a leaked
 * database row can't be turned back into a cookie. The HMAC is checked before any DB read.
 */
const COOKIE = "yard_cart"
const MAX_AGE_S = 60 * 24 * 3600

/** A purpose-bound subkey derived from the session key (keys.ts is shared; this stays local). */
const cartKey = () => hmac(keys().session, "yard/cart/v1")

export const cartCookieName = () => (getEnv().cookieSecure ? "__Host-" : "") + COOKIE

const sign = (token: string) => hmacB64url(cartKey(), token)

function tokenFrom(value: string | undefined): string | null {
  if (!value) return null
  const m = /^([\w-]{43})\.([\w-]{43})$/.exec(value)
  if (!m) return null
  return safeEqual(m[2], sign(m[1])) ? m[1] : null
}

/** The anon cart key (sha256 of the verified cookie token) for this request, or null. */
export async function readAnonCartKey(): Promise<string | null> {
  const jar = await cookies()
  const token = tokenFrom(jar.get(cartCookieName())?.value)
  return token ? sha256hex(token) : null
}

/** Issues a new anonymous cart cookie (Route Handlers only) and returns its anon key. */
export async function issueAnonCartCookie(): Promise<string> {
  const token = randomToken(32)
  const jar = await cookies()
  jar.set(cartCookieName(), `${token}.${sign(token)}`, { httpOnly: true, sameSite: "lax", path: "/", secure: getEnv().cookieSecure, maxAge: MAX_AGE_S })
  return sha256hex(token)
}

export async function clearAnonCartCookie() {
  const jar = await cookies()
  jar.set(cartCookieName(), "", { httpOnly: true, sameSite: "lax", path: "/", secure: getEnv().cookieSecure, maxAge: 0 })
}
