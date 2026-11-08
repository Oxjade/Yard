import "server-only"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the profile every authenticator app supports. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export const TOTP_PERIOD = 30
const DIGITS = 6

export function base32Encode(buf: Buffer) {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new 160-bit secret, base32. */
export const newTotpSecret = () => base32Encode(randomBytes(20))

export const currentStep = (at = Date.now()) => Math.floor(at / 1000 / TOTP_PERIOD)

export function hotp(secret: Buffer, counter: number) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac("sha1", secret).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0")
}

/**
 * Checks `code` against steps now-1 … now+1 and returns the matched step, or null. The caller
 * rejects a step ≤ the last accepted one (replay protection).
 */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): number | null {
  const digits = code.replace(/\s+/g, "")
  if (!/^\d{6}$/.test(digits)) return null
  const secret = base32Decode(secretB32)
  const now = currentStep(at)
  let matched: number | null = null
  for (const step of [now - 1, now, now + 1]) {
    const a = Buffer.from(hotp(secret, step))
    const b = Buffer.from(digits)
    if (timingSafeEqual(a, b) && matched === null) matched = step
  }
  return matched
}

export function otpauthUrl(secretB32: string, account: string, issuer = "Yard") {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`
}

/** Ten recovery codes like `k7qp-2mzx-9wfa`: 60 bits each, shown once. */
export function newRecoveryCodes(n = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(12)
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("")
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
  })
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "")
