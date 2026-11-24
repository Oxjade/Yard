import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { WELCOME_MAX_BRANDS, WELCOME_TEMPLATE, welcomeDedupeKey, welcomeSkipReason, type WelcomeBrand } from "../../lib/welcome-email"
import { brands } from "../db/schema/brands"
import { users } from "../db/schema/people"

/**
 * The shopper welcome email's database steps, with the outbox and the brand-visibility rule passed
 * in, so `tsx --test` runs them on a real in-memory database (src/server/email/welcome.test.ts).
 * The app wires them in src/server/email/welcome.ts. No "server-only" here on purpose.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>
export type Enqueue = (input: { template: string; to: string; vars: Record<string, string | number>; dedupeKey: string }) => Promise<void>
export type WelcomeOutcome = { queued: true } | { queued: false; reason: string }

/**
 * Queues the welcome for `userId` when the account should get one. Runs inside the caller's
 * transaction: the marker (users.welcome_email_at) and the outbox row commit together or not at
 * all, the marker is claimed with a conditional update (a concurrent or repeated call finds it set
 * and queues nothing), and the outbox dedupe key backs that up.
 */
export async function queueWelcome(d: Db, userId: string, enqueue: Enqueue): Promise<WelcomeOutcome> {
  const [u] = await d
    .select({
      id: users.id,
      kind: users.kind,
      name: users.name,
      email: users.email,
      status: users.status,
      demo: users.demo,
      welcomeEmailAt: users.welcomeEmailAt,
      // Qualified by hand: drizzle prints a lone column unqualified, which would bind to the subquery's table.
      brandMember: sql<boolean>`exists (select 1 from brand_members bm where bm.user_id = "users"."id")`,
      admin: sql<boolean>`exists (select 1 from admin_members am where am.user_id = "users"."id")`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u) return { queued: false, reason: "no_user" }
  const skip = welcomeSkipReason({ ...u, brandMember: !!u.brandMember, admin: !!u.admin })
  if (skip) return { queued: false, reason: skip }
  const claimed = await d
    .update(users)
    .set({ welcomeEmailAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.welcomeEmailAt)))
    .returning({ id: users.id })
  if (!claimed.length) return { queued: false, reason: "already_sent" }
  // Brands to follow are picked when the email is sent (the delivery worker fills `brands`).
  await enqueue({ template: WELCOME_TEMPLATE, to: u.email, vars: { name: u.name }, dedupeKey: welcomeDedupeKey(userId) })
  return { queued: true }
}

/**
 * Up to four live, public brands to suggest: `listed` is the /brands rule (sellable.ts
 * brandListedSql: not restricted, suspended or closed, founding brands once launched, never a
 * sample brand in production). Verified brands first, then the most recently listed.
 */
export async function pickWelcomeBrands(d: Db, listed: SQL, limit = WELCOME_MAX_BRANDS): Promise<WelcomeBrand[]> {
  const rows = await d
    .select({ name: brands.name, handle: brands.handle })
    .from(brands)
    .where(listed)
    .orderBy(desc(brands.verified), sql`coalesce(${brands.launchedAt}, ${brands.joinedAt}::timestamptz) desc nulls last`, asc(brands.id))
    .limit(Math.max(0, Math.min(WELCOME_MAX_BRANDS, limit)))
  return rows.filter((r) => r.name && r.handle)
}
