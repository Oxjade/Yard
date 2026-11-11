const RETURN_KEY = "yard-auth-return"
const ONBOARDING_PATH = "/studio/onboarding"

export function setOnboardingAuthReturn() {
  try {
    localStorage.setItem(RETURN_KEY, ONBOARDING_PATH)
  } catch {
    // The account can still continue manually if storage is unavailable.
  }
}

export function takeOnboardingAuthReturn() {
  try {
    const path = localStorage.getItem(RETURN_KEY)
    localStorage.removeItem(RETURN_KEY)
    return path === ONBOARDING_PATH ? path : null
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