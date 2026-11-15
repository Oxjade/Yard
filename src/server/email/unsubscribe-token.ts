import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * The unsubscribe token codec, plain Node (no "server-only", no env) so `tsx --test` covers it;
 * preferences.ts supplies the key (an HKDF subkey of the session secret). A token names an address,
 * a category ('all' = every optional email) and, for a Newsletter campaign, the campaign (`r`), so the
 * campaign's stats can count the unsubscribe. Stateless and non-expiring; the HMAC is the credential.
 */
export type UnsubscribeClaims<C extends string> = { email: string; category: C | "all"; ref?: string }

const mac = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url")

export function encodeUnsubscribeToken(key: Buffer, email: string, category: string, ref?: string | null) {
  const body: Record<string, string> = { e: email.trim().toLowerCase(), c: category }
  if (ref && /^[A-Za-z0-9_-]{1,80}$/.test(ref)) body.r = ref
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url")
  return `${payload}.${mac(key, payload)}`
}

export function decodeUnsubscribeToken<C extends string>(key: Buffer, token: string, categories: readonly C[]): UnsubscribeClaims<C> | null {
  if (typeof token !== "string" || token.length > 600) return null
  const [payload, sig, extra] = token.split(".")
  if (!payload || !sig || extra !== undefined) return null
  const want = Buffer.from(mac(key, payload))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: unknown; c?: unknown; r?: unknown }
    if (typeof p.e !== "string" || typeof p.c !== "string") return null
    if (p.c !== "all" && !categories.includes(p.c as C)) return null
    const ref = typeof p.r === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(p.r) ? p.r : undefined
    return { email: p.e, category: p.c as C | "all", ...(ref ? { ref } : {}) }
  } catch {
    return null
  }
}
