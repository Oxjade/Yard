const RETURN_KEY = "yard-auth-return"
const ONBOARDING_PATH = "/studio/onboarding"
/** As long as a verification link lives: an abandoned sign-up mustn't redirect a later, unrelated sign-in. */
const RETURN_TTL_MS = 60 * 60 * 1000

/** Remember that the email/OAuth round trip started on the brand wizard, so its completion page returns there. */
export function setOnboardingAuthReturn() {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify({ path: ONBOARDING_PATH, at: Date.now() }))
  } catch {
    // The account can still continue manually if storage is unavailable.
  }
}

/** Read and remove the return; null when there is none, it is malformed, or it is older than the TTL. */
export function takeOnboardingAuthReturn() {
  try {
    const raw = localStorage.getItem(RETURN_KEY)
    localStorage.removeItem(RETURN_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { path?: unknown; at?: unknown }
    const fresh = typeof saved.at === "number" && Date.now() - saved.at >= 0 && Date.now() - saved.at < RETURN_TTL_MS
    return saved.path === ONBOARDING_PATH && fresh ? ONBOARDING_PATH : null
  } catch {
    return null
  }
}

export function clearOnboardingAuthReturn() {
  try {
    localStorage.removeItem(RETURN_KEY)
  } catch {
    // Storage may be unavailable.
  }
}

/* ---------- OAuth re-auth (Studio money actions) ---------- */

/** BroadcastChannel the completion page posts a reauth result on (besides postMessage to its opener). */
export const OAUTH_REAUTH_CHANNEL = "yard-oauth-reauth"
export type OAuthReauthMessage = { type: "yard:oauth-reauth"; actor: "brand" | "shopper"; ok: boolean; message?: string }

const REAUTH_RETURN_KEY = "yard-reauth-return"
/** A provider round trip takes a minute or two; a stale return must not hijack a later sign-in. */
const REAUTH_RETURN_TTL_MS = 15 * 60 * 1000
const isStudioPath = (p: unknown): p is string => typeof p === "string" && /^\/studio(?:[/?#]|$)/.test(p) && !p.startsWith("//")

/** The reauth window was blocked and the round trip runs in this tab: remember the Studio page to return to. */
export function setReauthReturn(path: string) {
  if (!isStudioPath(path)) return
  try {
    sessionStorage.setItem(REAUTH_RETURN_KEY, JSON.stringify({ path, at: Date.now() }))
  } catch {
    // Without storage the completion page offers Studio's home instead.
  }
}

/** Read and remove the reauth return; null when there is none, it is malformed, or it is stale. */
export function takeReauthReturn() {
  try {
    const raw = sessionStorage.getItem(REAUTH_RETURN_KEY)
    sessionStorage.removeItem(REAUTH_RETURN_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { path?: unknown; at?: unknown }
    const fresh = typeof saved.at === "number" && Date.now() - saved.at >= 0 && Date.now() - saved.at < REAUTH_RETURN_TTL_MS
    return fresh && isStudioPath(saved.path) ? saved.path : null
  } catch {
    return null
  }
}
