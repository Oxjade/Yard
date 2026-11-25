/**
 * Telling an account-level refusal from the payment provider (the account isn't activated, is
 * suspended, or the key is wrong) apart from a network failure or a problem with one order.
 * Pure, no "server-only", so `tsx --test` covers it (refusal.test.ts).
 */

/** Stored in front of payments.init_error so the checkout view knows to say "paused", not "couldn't reach". */
export const PAUSED_PREFIX = "[paused] "

type Refusal = { definitive: boolean; httpStatus?: number; code?: string; message: string }

const ACCOUNT_CODE = /^(ACCOUNT_|MERCHANT_|BUSINESS_)|NOT_ACTIVATED|SUSPENDED|DEACTIVATED|DISABLED|UNAUTHORI[SZ]ED|INVALID_API_KEY|INVALID_KEY|FORBIDDEN/i

/**
 * A short, admin-readable reason when the provider refused because of the account, else null.
 * Only definitive answers count (the provider read the request and said no); a timeout or 5xx is
 * never an account problem.
 */
export function accountRefusalReason(e: Refusal): string | null {
  if (!e.definitive) return null
  const code = e.code ?? ""
  if (ACCOUNT_CODE.test(code)) return humanise(code, e.message)
  if (e.httpStatus === 401) return "the API key was rejected (401). Check the secret key in /etc/yard.env"
  if (e.httpStatus === 403) return humanise("FORBIDDEN", e.message)
  return null
}

function humanise(code: string, message: string) {
  if (/NOT_ACTIVATED/i.test(code)) return "the account is not yet approved for live payments. Finish onboarding in the provider's dashboard"
  if (/SUSPENDED|DEACTIVATED|DISABLED/i.test(code)) return "the account is suspended or disabled. Contact the provider"
  if (/UNAUTHORI|KEY/i.test(code)) return "the API key was rejected. Check the secret key in /etc/yard.env"
  const tail = message.split(": ").slice(-1)[0] ?? ""
  return `${code}${tail ? ` (${tail.slice(0, 120)})` : ""}`
}
