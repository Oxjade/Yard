/**
 * Android App Links (Digital Asset Links): the body of /.well-known/assetlinks.json, which lets the
 * Yard Android app open https links to this site. Pure (no "server-only"), so `tsx --test` checks
 * it (app-links.test.ts). ANDROID_CERT_SHA256 lists the signing certificates' SHA-256 fingerprints,
 * comma-separated, in the uppercase colon form (AA:BB:…:FF, 32 bytes); unset or none valid → [].
 */
export const ANDROID_PACKAGE = "space.yardstore.app"

const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/

export function certFingerprints(raw: string | undefined | null) {
  const out: string[] = []
  for (const part of (raw ?? "").split(",")) {
    const f = part.trim().toUpperCase()
    if (FINGERPRINT.test(f) && !out.includes(f)) out.push(f)
  }
  return out
}

export function assetLinks(raw: string | undefined | null) {
  const fingerprints = certFingerprints(raw)
  if (!fingerprints.length) return []
  return [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints } }]
}
