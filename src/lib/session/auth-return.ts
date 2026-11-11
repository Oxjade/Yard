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
