import "server-only"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { getEnv } from "../env"

/**
 * Bank-account sealing for payouts. Same format and HKDF pattern as the social token vault
 * (security/crypto.ts, §5.5: `v1.<iv>.<tag>.<ct>`, AES-256-GCM), but its own subkey derived from
 * YARD_ENCRYPTION_KEY with info "yard/payout-accounts/v1", so no key does two jobs. The AAD binds
 * the value to its brand. Decrypts with YARD_ENCRYPTION_KEY_PREVIOUS during a rotation.
 */
const derive = (ikm: Buffer) => Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), "yard/payout-accounts/v1", 32))

let cached: { current: Buffer; previous: Buffer | null } | null = null
function payoutKeys() {
  if (!cached) {
    const env = getEnv()
    cached = { current: derive(env.encryptionKey), previous: env.encryptionKeyPrevious ? derive(env.encryptionKeyPrevious) : null }
  }
  return cached
}

export const payoutAad = (brandId: string) => `${brandId}:payout-account`

export function sealPayout(plaintext: string, aad: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", payoutKeys().current, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".")
}

export function openPayout(sealed: string, aad: string) {
  const [v, iv, tag, ct] = sealed.split(".")
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("payout vault: unknown format")
  const k = payoutKeys()
  for (const key of [k.current, k.previous]) {
    if (!key) continue
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
      d.setAAD(Buffer.from(aad))
      d.setAuthTag(Buffer.from(tag, "base64url"))
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8")
    } catch {
      /* try the previous key */
    }
  }
  throw new Error("payout vault: cannot open")
}
