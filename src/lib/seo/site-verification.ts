/**
 * Search-engine site verification and the IndexNow key, from environment variables (docs/SEO-AI.md).
 * Pure: no imports, safe under `tsx --test`. src/server/env.ts parses the same variables for the
 * server; the root layout reads the meta tokens through siteVerification().
 *
 * - GOOGLE_SITE_VERIFICATION: Search Console's meta-tag token(s), comma separated for several.
 * - BING_SITE_VERIFICATION: Bing Webmaster Tools' msvalidate.01 token(s), comma separated.
 * - GOOGLE_SITE_VERIFICATION_FILE: the HTML-file method's file name (googleXXXX.html).
 * - INDEXNOW_KEY: 8 to 128 hex characters (openssl rand -hex 16). Unset = IndexNow off.
 */
type EnvLike = Record<string, string | undefined>

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

/** A verification token is printable, no quotes, angle brackets or spaces. Anything else is dropped. */
const TOKEN = /^[A-Za-z0-9_\-.:=+/]{1,200}$/

/** Comma-separated tokens, trimmed, deduplicated, invalid ones dropped. */
export function verificationTokens(v: string | undefined): string[] {
  const out: string[] = []
  for (const t of (v ?? "").split(",")) {
    const s = t.trim()
    if (s && TOKEN.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}

/** Google's HTML-file method: google<hex or letters>.html, nothing else. */
export const GOOGLE_FILE = /^google[A-Za-z0-9_-]{1,100}\.html$/

export function googleVerificationFile(env: EnvLike = process.env): string | null {
  const f = blank(env.GOOGLE_SITE_VERIFICATION_FILE)
  return f && GOOGLE_FILE.test(f) ? f : null
}

/** The body Google expects in the file: "google-site-verification: googleXXXX.html". */
export const googleVerificationFileBody = (file: string) => `google-site-verification: ${file}`

/** The IndexNow key: 8 to 128 hex characters, or null (IndexNow off). */
export const INDEXNOW_KEY = /^[0-9a-fA-F]{8,128}$/

export function indexNowKey(env: EnvLike = process.env): string | null {
  const k = blank(env.INDEXNOW_KEY)
  return k && INDEXNOW_KEY.test(k) ? k : null
}

/**
 * The Next metadata `verification` field: google-site-verification and msvalidate.01 meta tags.
 * Undefined when neither variable is set, so no empty tags are rendered.
 */
export function siteVerification(env: EnvLike = process.env): { google?: string | string[]; other?: Record<string, string | string[]> } | undefined {
  const google = verificationTokens(env.GOOGLE_SITE_VERIFICATION)
  const bing = verificationTokens(env.BING_SITE_VERIFICATION)
  if (!google.length && !bing.length) return undefined
  return {
    ...(google.length ? { google: google.length === 1 ? google[0] : google } : {}),
    ...(bing.length ? { other: { "msvalidate.01": bing.length === 1 ? bing[0] : bing } } : {}),
  }
}

/** Problems worth a warning at boot (a set variable that is ignored). Never fatal: SEO keys never stop the site. */
export function siteVerificationWarnings(env: EnvLike = process.env): string[] {
  const out: string[] = []
  for (const name of ["GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION"] as const) {
    const listed = (env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    const bad = listed.filter((s) => !TOKEN.test(s))
    if (bad.length) out.push(`${name} has ${bad.length} token(s) with characters a meta tag can't carry; they are ignored`)
  }
  if (blank(env.GOOGLE_SITE_VERIFICATION_FILE) && !googleVerificationFile(env)) out.push("GOOGLE_SITE_VERIFICATION_FILE must be the file name Google gives you, like google1234abcd.html; it is ignored")
  if (blank(env.INDEXNOW_KEY) && !indexNowKey(env)) out.push("INDEXNOW_KEY must be 8 to 128 hex characters (openssl rand -hex 16); IndexNow stays off")
  return out
}

/**
 * The body of a site file (the rewrites in next.config.ts send /googleXXXX.html and /<hex>.txt
 * here), or null for any other name: only the exact configured file answers.
 */
export function siteFileBody(kind: "google" | "indexnow", name: string, env: EnvLike = process.env): string | null {
  if (kind === "google") {
    const file = googleVerificationFile(env)
    return file && name === file ? googleVerificationFileBody(file) : null
  }
  const key = indexNowKey(env)
  return key && name === `${key}.txt` ? key : null
}
