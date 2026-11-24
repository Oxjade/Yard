import { emailLooksThrowaway } from "../auth/email-policy"

/**
 * Risk signals for the Admin › Brands review queue: an application gets the "Risky" flag (risk
 * high) when any of these holds, with the reasons in its notes. Signals only: the reviewer decides.
 *  - the applicant's email looks throwaway (a disposable-looking domain that slipped past the list);
 *  - the account was less than a day old when it applied;
 *  - three or more applications were submitted from the same network (IP) in the past week.
 */
export type ApplicationRisk = { level: "low" | "high"; reasons: string[] }

export const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000
export const SAME_IP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const SAME_IP_ATTEMPTS = 3

/** Pure: the flag from the facts. */
export function riskFrom(f: { email: string | null; accountCreatedAt: Date | null; submittedAt: Date | null; sameIpAttempts: number }): ApplicationRisk {
  const reasons: string[] = []
  if (f.email && emailLooksThrowaway(f.email)) reasons.push("Email address looks disposable.")
  if (f.accountCreatedAt && f.submittedAt && f.submittedAt.getTime() - f.accountCreatedAt.getTime() < NEW_ACCOUNT_MS) reasons.push("Account was less than a day old when it applied.")
  if (f.sameIpAttempts >= SAME_IP_ATTEMPTS) reasons.push(`${f.sameIpAttempts} applications from the same network this week.`)
  return { level: reasons.length ? "high" : "low", reasons }
}

