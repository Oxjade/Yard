/**
 * Google / Apple / Auth0 sign-in outcomes: the `result` values the callback reports (on
 * /auth/complete for the website, yard://auth/complete for the apps) and the words each one shows.
 * Plain module (no server-only): the server, the website's completion page and `tsx --test` all
 * load it, so the website and the apps (which also get `message` on a failure) say the same thing.
 */

export const OAUTH_RESULTS = [
  "signed_in",
  "linked",
  "reauthed",
  "cancelled",
  "invalid_state",
  "error",
  "not_configured",
  "rate_limited",
  "identity_in_use",
  "already_linked",
  "link_required",
  "email_required",
  "email_unverified",
  "no_brand",
  "suspended",
  "team_account",
  "account_unavailable",
  "reauth_mismatch",
] as const
export type OAuthResult = (typeof OAUTH_RESULTS)[number]

export const OAUTH_SUCCESS_RESULTS: readonly OAuthResult[] = ["signed_in", "linked", "reauthed"]

export const isOAuthResult = (v: unknown): v is OAuthResult => typeof v === "string" && (OAUTH_RESULTS as readonly string[]).includes(v)

/** The words for each failure (successes are worded by the page that shows them). */
export const OAUTH_RESULT_MESSAGES: Partial<Record<OAuthResult, string>> = {
  cancelled: "Sign-in was cancelled.",
  invalid_state: "This sign-in link expired or could not be verified. Start again.",
  error: "The provider couldn’t complete sign-in. Try again.",
  not_configured: "This sign-in provider isn’t configured on Yard yet.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes, then try again.",
  identity_in_use: "That provider account is connected to another Yard account.",
  already_linked: "That provider is already connected to this account.",
  link_required: "Sign in with your password before connecting this provider.",
  email_required: "The provider didn’t share an email address. Try another sign-in method.",
  email_unverified: "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way.",
  no_brand: "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses.",
  suspended: "This account is currently unavailable.",
  team_account: "This is a Yard team account, so it can’t shop. Sign in with a different account.",
  account_unavailable: "This Yard account is being deleted or is no longer available. Sign in with a different account.",
  reauth_mismatch: "The provider account didn’t match the account being confirmed.",
}

export const OAUTH_FALLBACK_MESSAGE = "Sign-in could not be completed."

export const oauthResultMessage = (result: string) => (isOAuthResult(result) ? OAUTH_RESULT_MESSAGES[result] : undefined) ?? OAUTH_FALLBACK_MESSAGE

/**
 * The result for a sign-in whose account may not hold a session of `actor` (assertEligible threw
 * an HttpError with `code`). A brand sign-in keeps its own results (no_brand / suspended).
 */
export function eligibilityResult(actor: "shopper" | "brand", code: string): OAuthResult {
  if (code === "suspended") return "suspended"
  if (actor === "brand") return "no_brand"
  if (code === "forbidden") return "team_account"
  return "error"
}

/** The one log line for a refused sign-in. `reason` is short and holds no emails or tokens. */
export function refusalLine(provider: string, mode: string | null, actor: string | null, result: string, reason?: string | null) {
  return `[yard] auth: ${provider} ${mode ?? "?"}/${actor ?? "?"} refused: ${result}${reason ? ` (${reason})` : ""}`
}
