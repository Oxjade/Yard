import "server-only"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { users } from "../db/schema"
import { canonicalEmail, emailDomainProblem } from "./email-policy"
import { badRequest } from "../http/errors"

/**
 * The account whose address is the same mailbox as `email` (email-policy.ts canonicalEmail: the
 * +tag dropped, Gmail dots ignored), or null. The exact address is looked up first by the caller;
 * this catches a.b+x@gmail.com signing up again as ab@gmail.com. A scan of users.email in SQL
 * (no stored column): fine at Yard's size; add an expression index if sign-ups ever get slow.
 */
export async function findUserByCanonicalEmail(email: string) {
  const canonical = canonicalEmail(email)
  const at = canonical.lastIndexOf("@")
  if (at < 1) return null
  const local = canonical.slice(0, at)
  const domain = canonical.slice(at + 1)
  const d = await db()
  const e = sql`lower(trim(${users.email}))`
  const name = sql`split_part(split_part(${e}, '@', 1), '+', 1)`
  const host = sql`split_part(${e}, '@', 2)`
  const where =
    domain === "gmail.com"
      ? sql`${host} in ('gmail.com', 'googlemail.com') and replace(${name}, '.', '') = ${local}`
      : sql`${host} = ${domain} and ${name} = ${local}`
  const [u] = await d.select().from(users).where(where).limit(1)
  return u ?? null
}

/** Refuses a throwaway or reserved address with a friendly 400 on `field`. */
export function assertUsableEmail(email: string, field = "email") {
  const problem = emailDomainProblem(email)
  if (problem) throw badRequest({ [field]: problem }, problem)
}
