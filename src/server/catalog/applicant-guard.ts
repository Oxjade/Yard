import "server-only"
import { and, count, eq, ne } from "drizzle-orm"
import { brandMembers, users } from "../db/schema"
import { brandOnboardings } from "../db/schema/catalog"
import { oauthIdentities, userCredentials } from "../db/schema/identity"
import type { Executor } from "../db"
import { HttpError, rule } from "../http/errors"
import { emailDomainProblem } from "../auth/email-policy"

/**
 * Who may submit a brand application (the website wizard, catalog/onboarding.ts submitOnboarding,
 * and the app's short application, studio-app applyFromApp). Checked on the server at submission,
 * whatever the client shows:
 *
 *  - the account's email is verified: a password account confirmed its link; Google, Apple and
 *    Auth0 sign-ins count (the provider verified it, oauth/flow.ts), as do magic links;
 *  - the address isn't a throwaway or test one (auth/email-policy.ts), for accounts older than that rule;
 *  - at most one application waiting for review per account;
 *  - at most YARD_MAX_BRANDS_PER_ACCOUNT brands owned per account (default 3), counted only when
 *    the application would create a new brand (a resubmission after a rejection reuses its brand).
 *
 * Nothing an applicant creates is public until an admin approves it (page-visibility.ts), so these
 * rules are about spam volume and review load, not about what shoppers see.
 */

export const DEFAULT_MAX_BRANDS_PER_ACCOUNT = 3

export function maxBrandsPerAccount(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.YARD_MAX_BRANDS_PER_ACCOUNT)
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_MAX_BRANDS_PER_ACCOUNT
}

export const UNVERIFIED_MESSAGE = "Confirm your email address before you apply. Open the link we sent you, or ask for a new one from your account settings."

/** Refuses the application with a friendly message, or returns. `exceptOnboardingId`: the application being submitted. */
export async function assertMayApply(d: Executor, userId: string, opts: { newBrand: boolean; exceptOnboardingId?: string | null }) {
  const [u] = await d.select({ email: users.email, demo: users.demo }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u) throw rule("Sign in again to apply.")
  if (u.demo) return
  const domain = emailDomainProblem(u.email)
  if (domain) throw rule(`${domain} Change your account's email in settings, confirm it, then apply.`)

  const [cred] = await d.select({ verifiedAt: userCredentials.emailVerifiedAt }).from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1)
  if (!cred?.verifiedAt) {
    const [linked] = await d.select({ id: oauthIdentities.id }).from(oauthIdentities).where(eq(oauthIdentities.userId, userId)).limit(1)
    if (!linked) throw new HttpError(403, "forbidden", UNVERIFIED_MESSAGE, { email: "unverified" })
  }

  const waiting = await d
    .select({ n: count() })
    .from(brandOnboardings)
    .where(and(eq(brandOnboardings.userId, userId), eq(brandOnboardings.status, "submitted"), opts.exceptOnboardingId ? ne(brandOnboardings.id, opts.exceptOnboardingId) : undefined))
  if ((waiting[0]?.n ?? 0) >= 1) throw rule("You already have an application waiting for Yard's review. We'll email you when it's decided.")

  if (opts.newBrand) {
    const max = maxBrandsPerAccount()
    const owned = await d
      .select({ n: count() })
      .from(brandMembers)
      .where(and(eq(brandMembers.userId, userId), eq(brandMembers.role, "owner"), eq(brandMembers.status, "active")))
    if ((owned[0]?.n ?? 0) >= max) throw rule(`An account can run up to ${max} brands on Yard. Contact Yard Support if you need another.`)
  }
}
