import "server-only"
import { randomBytes } from "node:crypto"
import { and, eq, gt, isNull } from "drizzle-orm"
import { db } from "../db"
import { oauthStates } from "../db/schema"
import { keys } from "../security/keys"
import { hmacB64url, open, safeEqual, seal, sha256b64url } from "../security/crypto"
import type { ProviderId, ProviderMode } from "./providers"

/**
 * OAuth state and PKCE (§5.5). Start is a POST that inserts an oauth_states row and returns the
 * authorize URL; `state = id + "." + HMAC(keys.oauthState, id + provider)`. The callback checks the
 * HMAC in constant time before any DB read, then the row (unused, unexpired, same provider), then
 * that the CURRENT brand session is the same member and active brand, and marks it used.
 */
const TTL_MS = 10 * 60_000
const PKCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

const sign = (id: string, provider: string) => hmacB64url(keys().oauthState, id + provider)
const verifierAad = (id: string) => `oauth:${id}`

/** 64 characters from the PKCE alphabet ([A-Za-z0-9-._~]). */
function codeVerifier() {
  const bytes = randomBytes(64)
  let out = ""
  for (const b of bytes) out += PKCE_CHARS[b % PKCE_CHARS.length]
  return out
}

export async function createState(i: { brandId: string; userId: string; provider: ProviderId; mode: ProviderMode; pkce: boolean }) {
  const id = randomBytes(16).toString("base64url")
  const verifier = i.pkce ? codeVerifier() : null
  const d = await db()
  await d.insert(oauthStates).values({
    id,
    brandId: i.brandId,
    userId: i.userId,
    provider: i.provider,
    mode: i.mode,
    codeVerifierEnc: verifier ? seal(verifier, verifierAad(id)) : null,
    expiresAt: new Date(Date.now() + TTL_MS),
  })
  return { state: `${id}.${sign(id, i.provider)}`, codeChallenge: verifier ? sha256b64url(verifier) : undefined }
}

export type StateCheck = { ok: true; brandId: string; userId: string; mode: ProviderMode; codeVerifier?: string } | { ok: false }

/**
 * Verifies a returned state and consumes it (one use). `session` is the current brand session:
 * a state started by another member or for another brand never completes.
 */
export async function consumeState(state: string, provider: ProviderId, session: { userId: string; brandId: string } | null): Promise<StateCheck> {
  const [id, mac, ...rest] = String(state ?? "").split(".")
  if (!id || !mac || rest.length || id.length > 40 || mac.length > 64) return { ok: false }
  if (!safeEqual(mac, sign(id, provider))) return { ok: false }
  if (!session) return { ok: false }
  const d = await db()
  // Mark used in one statement: a replayed callback finds nothing to update.
  const [row] = await d
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.id, id), eq(oauthStates.provider, provider), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date()), eq(oauthStates.userId, session.userId), eq(oauthStates.brandId, session.brandId)))
    .returning()
  if (!row) return { ok: false }
  let verifier: string | undefined
  if (row.codeVerifierEnc) {
    try {
      verifier = open(row.codeVerifierEnc, verifierAad(id))
    } catch {
      return { ok: false }
    }
  }
  return { ok: true, brandId: row.brandId, userId: row.userId, mode: row.mode as ProviderMode, codeVerifier: verifier }
}
