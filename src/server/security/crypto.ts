import "server-only"
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { keys } from "./keys"

export const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex")
export const sha256b64url = (data: string | Buffer) => createHash("sha256").update(data).digest("base64url")
export const hmac = (key: Buffer, data: string | Buffer) => createHmac("sha256", key).update(data).digest()
export const hmacB64url = (key: Buffer, data: string | Buffer) => hmac(key, data).toString("base64url")
export const hmacHex = (key: Buffer, data: string | Buffer) => hmac(key, data).toString("hex")

/** Constant-time comparison of two strings (false on any length mismatch). */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Token vault (§5.5): AES-256-GCM under keys.vault, as `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * The AAD binds a token to its tenant, e.g. `${brandId}:${provider}:${accountId}`.
 */
export function seal(plaintext: string, aad: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keys().vault, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".")
}

/** Opens a sealed value with the current key, then YARD_ENCRYPTION_KEY_PREVIOUS. Throws when neither fits. */
export function open(sealed: string, aad: string) {
  const [v, iv, tag, ct] = sealed.split(".")
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("vault: unknown format")
  const k = keys()
  for (const key of [k.vault, k.vaultPrevious]) {
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
  throw new Error("vault: cannot open")
}

/** True when `sealed` was sealed with the previous key (the next refresh re-seals it). */
export function sealedWithPrevious(sealed: string, aad: string) {
  try {
    const [, iv, tag, ct] = sealed.split(".")
    const d = createDecipheriv("aes-256-gcm", keys().vault, Buffer.from(iv, "base64url"))
    d.setAAD(Buffer.from(aad))
    d.setAuthTag(Buffer.from(tag, "base64url"))
    d.update(Buffer.from(ct, "base64url"))
    d.final()
    return false
  } catch {
    return true
  }
}
