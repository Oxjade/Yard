/**
 * App attestation settings (docs/APP.md "App attestation", docs/DEPLOY.md). Pure and import-free so
 * `tsx --test` and the boot log read the same rules.
 *
 *  - YARD_APP_ATTEST=off|monitor|enforce (default monitor). Anything else reads as monitor.
 *  - Android (Google Play Integrity, standard requests): PLAY_INTEGRITY_PACKAGE_NAME,
 *    GOOGLE_APPLICATION_CREDENTIALS_PLAY (path of the service account's JSON key file on the
 *    server, never the key itself), PLAY_INTEGRITY_CERT_SHA256 (the app signing certificate's
 *    SHA-256, comma separated when there are several) and PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER
 *    (public; the app needs it to ask Play for a token).
 *  - iOS (Apple App Attest): APP_ATTEST_TEAM_ID, APP_ATTEST_BUNDLE_ID and
 *    APP_ATTEST_ENV=production|development (default production).
 *
 * A platform whose settings are incomplete is off: its requests are never verified or blocked.
 */

export const ATTEST_MODES = ["off", "monitor", "enforce"] as const
export type AttestMode = (typeof ATTEST_MODES)[number]
export type Platform = "android" | "ios"

export type AndroidConfig = { packageName: string; credentialsPath: string; certDigests: string[]; cloudProjectNumber: string }
export type IosConfig = { teamId: string; bundleId: string; appId: string; environment: "production" | "development" }

export type AttestConfig = {
  mode: AttestMode
  android: AndroidConfig | null
  ios: IosConfig | null
  /** The env names each platform still needs (empty when configured). */
  missing: { android: string[]; ios: string[] }
}

type EnvLike = Record<string, string | undefined>

const val = (env: EnvLike, name: string) => env[name]?.trim() || ""

export function attestMode(env: EnvLike = process.env): AttestMode {
  const v = val(env, "YARD_APP_ATTEST").toLowerCase()
  return (ATTEST_MODES as readonly string[]).includes(v) ? (v as AttestMode) : "monitor"
}

/**
 * A certificate SHA-256 in the form Play Integrity reports it: unpadded base64url of the 32 bytes.
 * Accepts that form, standard base64, or hex with or without colons (as the Play Console and
 * keytool print it). Null when it isn't a SHA-256.
 */
export function normaliseCertDigest(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const hex = s.replace(/:/g, "")
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex").toString("base64url")
  const b = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  return b.length === 32 ? b.toString("base64url") : null
}

export function androidConfig(env: EnvLike = process.env): { config: AndroidConfig | null; missing: string[] } {
  const packageName = val(env, "PLAY_INTEGRITY_PACKAGE_NAME")
  const credentialsPath = val(env, "GOOGLE_APPLICATION_CREDENTIALS_PLAY")
  const digests = val(env, "PLAY_INTEGRITY_CERT_SHA256")
    .split(",")
    .map(normaliseCertDigest)
    .filter((d): d is string => !!d)
  const cloudProjectNumber = val(env, "PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER")
  const missing: string[] = []
  if (!packageName) missing.push("PLAY_INTEGRITY_PACKAGE_NAME")
  if (!credentialsPath) missing.push("GOOGLE_APPLICATION_CREDENTIALS_PLAY")
  if (!digests.length) missing.push("PLAY_INTEGRITY_CERT_SHA256")
  if (!/^\d{1,20}$/.test(cloudProjectNumber)) missing.push("PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER")
  return { config: missing.length ? null : { packageName, credentialsPath, certDigests: digests, cloudProjectNumber }, missing }
}

export function iosConfig(env: EnvLike = process.env): { config: IosConfig | null; missing: string[] } {
  const teamId = val(env, "APP_ATTEST_TEAM_ID")
  const bundleId = val(env, "APP_ATTEST_BUNDLE_ID")
  const environment = val(env, "APP_ATTEST_ENV").toLowerCase() === "development" ? "development" : "production"
  const missing: string[] = []
  if (!teamId) missing.push("APP_ATTEST_TEAM_ID")
  if (!bundleId) missing.push("APP_ATTEST_BUNDLE_ID")
  return { config: missing.length ? null : { teamId, bundleId, appId: `${teamId}.${bundleId}`, environment }, missing }
}

export function attestConfig(env: EnvLike = process.env): AttestConfig {
  const a = androidConfig(env)
  const i = iosConfig(env)
  return { mode: attestMode(env), android: a.config, ios: i.config, missing: { android: a.missing, ios: i.missing } }
}

/** One line for the boot log. */
export function attestStartupLine(c: AttestConfig): string {
  if (c.mode === "off") return "[yard] App attestation: off (YARD_APP_ATTEST=off)."
  const part = (name: string, on: boolean, missing: string[]) => (on ? `${name} on` : `${name} off (set ${missing.join(", ")})`)
  return `[yard] App attestation: ${c.mode}; ${part("Android Play Integrity", !!c.android, c.missing.android)}; ${part("iOS App Attest", !!c.ios, c.missing.ios)}.`
}
