import "server-only"
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"

/**
 * Password hashing with node:crypto scrypt (no native dependency). Format:
 * `scrypt$<log2N>$<r>$<p>$<salt b64url>$<hash b64url>`, so parameters can be raised later and
 * old hashes still verify (needsRehash says when to upgrade on the next successful sign-in).
 */
const LOG_N = 15
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 128 * 1024 * 1024

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))))
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEYLEN, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAXMEM })
  return ["scrypt", LOG_N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$")
}

/** A fixed hash of a random password, verified against when the account doesn't exist (equal timing). */
let dummy: Promise<string> | null = null
const dummyHash = () => (dummy ??= hashPassword(randomBytes(18).toString("base64url")))

/** Constant-time verify. A null/malformed stored hash still costs one scrypt, so timing never says whether an account exists. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$")
  const valid = parts.length === 6 && parts[0] === "scrypt"
  const [, logN, r, p, saltB64, hashB64] = valid ? parts : (await dummyHash()).split("$")
  const N = 2 ** Number(logN)
  if (!Number.isInteger(Number(logN)) || Number(logN) < 10 || Number(logN) > 20) return false
  const expected = Buffer.from(hashB64, "base64url")
  const key = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, { N, r: Number(r), p: Number(p), maxmem: MAXMEM })
  const ok = key.length === expected.length && timingSafeEqual(key, expected)
  return valid && ok
}

export function needsRehash(stored: string) {
  const [, logN, r, p] = stored.split("$")
  return Number(logN) < LOG_N || Number(r) !== R || Number(p) !== P
}

/** Plain-language policy, shared by sign-up, reset, change and invite acceptance. Null when fine. */
export function passwordProblem(password: string, email?: string | null): string | null {
  if (password.length < 10) return "Use at least 10 characters."
  if (password.length > 200) return "Keep it to 200 characters."
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character."
  const lower = password.toLowerCase()
  if (email && lower === email.toLowerCase()) return "Don't use your email address as your password."
  if (["password12", "1234567890", "qwertyuiop", "password123", "letmein123"].includes(lower)) return "That password is too easy to guess."
  return null
}
