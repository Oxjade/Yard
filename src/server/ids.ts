import "server-only"
import { randomBytes } from "node:crypto"

/**
 * Text ids with a prefix that sort by time: `${prefix}_${Date.now() base36}${6 random bytes}`
 * (§1.4). Seeded rows keep their sample ids; clients never choose a row id.
 */
export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString("base64url")}`
}

/** A random token of `bytes` bytes, base64url. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url")
}
