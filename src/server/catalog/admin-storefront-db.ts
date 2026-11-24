import { randomBytes } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { payoutAccountStatus, storefrontActionPlan, type AdminStorefrontFacts, type PayoutAccountStatus } from "../../lib/admin-storefront"
import { brands } from "../db/schema/brands"
import { brandOnboardings, catalogProducts, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts } from "../db/schema/ledger"
import { auditLog } from "../db/schema/platform"

/**
 * Admin › Brands › Publish / Unpublish storefront: the database half. No server-only, so the tests
 * run these exact statements on PGlite with the migrations applied; catalog/admin-storefront.ts adds
 * the permission, the first publish (the brand's own publish, publish-for-brand.ts), the email and
 * the after-commit effects (memo flush, search re-index, media visibility).
 *
 * Unpublish sets brands.unpublished_at, which every public read honours (sellable.ts
 * brandLaunchedSql, page-visibility.ts): the shop, its products and its listing leave the
 * marketplace without restricting the brand. Publish on a shop that already has a storefront
 * version clears it again, and for a founding brand sets launched_at if it was never set, so the
 * founding launch rule (hidden until launched_at) is met and the shop is really live.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

export type BrandRow = typeof brands.$inferSelect

export type StorefrontPayout = { status: PayoutAccountStatus; bankName: string; accountName: string; last4: string; currency: string; changedAt: string } | null

export type AdminActorRef = { userId: string; name: string; role: string }

/** A refusal the route turns into 422 (or 423 for a restricted brand). */
export class StorefrontRuleError extends Error {
  constructor(
    message: string,
    readonly restricted = false,
  ) {
    super(message)
  }
}

/** Products shoppers see the moment the shop is live: published (or due scheduled), passing moderation. */
export async function liveProductCountDb(d: Db, brandId: string) {
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.brandId, brandId),
        eq(catalogProducts.moderationStatus, "ok"),
        sql`(${catalogProducts.status} = 'published' or (${catalogProducts.status} = 'scheduled' and ${catalogProducts.publishAt} <= now()))`,
      ),
    )
  return Number(r?.n) || 0
}

/** The brand's payout account, masked (never the number or the recipient code). */
export async function storefrontPayoutDb(d: Db, brandId: string): Promise<StorefrontPayout> {
  const [a] = await d
    .select({ bankName: brandPayoutAccounts.bankName, accountName: brandPayoutAccounts.accountName, last4: brandPayoutAccounts.accountLast4, currency: brandPayoutAccounts.currency, changedAt: brandPayoutAccounts.changedAt, recipientCode: brandPayoutAccounts.recipientCode, recipientProvider: brandPayoutAccounts.recipientProvider })
    .from(brandPayoutAccounts)
    .where(eq(brandPayoutAccounts.brandId, brandId))
    .limit(1)
  if (!a) return null
  return { status: payoutAccountStatus(a), bankName: a.bankName, accountName: a.accountName, last4: a.last4, currency: a.currency, changedAt: new Date(a.changedAt).toISOString() }
}

export async function loadBrandDb(d: Db, brandId: string, lock = false): Promise<BrandRow | null> {
  const q = d.select().from(brands).where(eq(brands.id, brandId))
  const [b] = lock ? await q.for("update").limit(1) : await q.limit(1)
  return b ?? null
}

/** Everything the Publish / Unpublish confirmation shows and the server checks again. */
export async function adminStorefrontFactsDb(d: Db, b: BrandRow): Promise<{ facts: AdminStorefrontFacts; payout: StorefrontPayout }> {
  const [[version], [review], liveProducts, payout] = await Promise.all([
    d.select({ v: storefrontVersions.version }).from(storefrontVersions).where(eq(storefrontVersions.brandId, b.id)).limit(1),
    d.select({ id: brandOnboardings.id }).from(brandOnboardings).where(and(eq(brandOnboardings.brandId, b.id), inArray(brandOnboardings.status, ["draft", "submitted", "rejected"]))).limit(1),
    liveProductCountDb(d, b.id),
    storefrontPayoutDb(d, b.id),
  ])
  return {
    facts: {
      name: b.name,
      founding: b.founding,
      claimStatus: b.claimStatus,
      reviewStatus: b.reviewStatus,
      closed: !!b.closedAt,
      underReview: !!review,
      hasVersion: !!version,
      launched: !!b.launchedAt,
      unpublished: !!b.unpublishedAt,
      liveProducts,
      payoutAccount: !!payout,
    },
    payout,
  }
}

function auditId() {
  return `au_${Date.now().toString(36)}${randomBytes(6).toString("base64url")}`
}

/**
 * Takes the brand's shop off the marketplace (unpublish) or puts a shop that already has a
 * storefront version back on it (relist), in the caller's transaction. The brand row is locked
 * first, so a double press waits and then finds nothing to do. Returns changed: false for a no-op;
 * throws StorefrontRuleError when the brand's state forbids it. Writes one audit row per change.
 */
export async function setStorefrontListedDb(
  tx: Db,
  input: { brandId: string; action: "unpublish" | "relist"; admin: AdminActorRef; ipHash: string | null; now?: Date },
): Promise<{ changed: boolean; launched: boolean; facts: AdminStorefrontFacts }> {
  const now = input.now ?? new Date()
  const b = await loadBrandDb(tx, input.brandId, true)
  if (!b) throw new StorefrontRuleError("That brand doesn't exist.")
  const { facts } = await adminStorefrontFactsDb(tx, b)
  const plan = storefrontActionPlan(facts, input.action === "unpublish" ? "unpublish" : "publish")
  if (plan.kind === "blocked") throw new StorefrontRuleError(plan.message, b.reviewStatus === "restricted")
  if (plan.kind === "already") return { changed: false, launched: false, facts }
  if (input.action === "relist" && !facts.hasVersion) throw new StorefrontRuleError(`${b.name}'s storefront has never been published: publish its draft first.`)

  let launched = false
  if (input.action === "unpublish") {
    await tx.update(brands).set({ unpublishedAt: now, unpublishedBy: input.admin.userId }).where(eq(brands.id, b.id))
  } else {
    launched = b.founding && !b.launchedAt
    await tx
      .update(brands)
      .set({ unpublishedAt: null, unpublishedBy: null, ...(launched ? { launchedAt: now } : {}) })
      .where(eq(brands.id, b.id))
  }
  await tx.insert(auditLog).values({
    id: auditId(),
    at: now,
    actorKind: "admin",
    actorId: input.admin.userId,
    actorName: input.admin.name,
    role: input.admin.role,
    action: input.action === "unpublish" ? "brand.storefront_unpublished_by_yard" : "brand.storefront_republished_by_yard",
    target: `${b.name} storefront`,
    subjectType: "storefront",
    subjectId: b.id,
    brandId: b.id,
    ipHash: input.ipHash,
    meta: { liveProducts: facts.liveProducts, payoutAccount: facts.payoutAccount, founding: b.founding, claimStatus: b.claimStatus, launched },
  })
  const after = { ...facts, unpublished: input.action === "unpublish", launched: facts.launched || launched }
  return { changed: true, launched, facts: after }
}
