import "server-only"
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm"
import {
  DRAFT_NUDGE_AFTER_MS,
  DRAFT_NUDGE_MAX_AGE_MS,
  DRAFT_NUDGE_NAMED,
  NUDGE_COOLDOWN_MS,
  STOREFRONT_NUDGE_AFTER_MS,
  groupDraftNudges,
  storefrontNudgeEligible,
  type DraftCandidate,
  type StorefrontCandidate,
} from "@/lib/brand-emails"
import { writeAudit } from "../audit"
import { withTx, db } from "../db"
import { brands } from "../db/schema"
import { brandOnboardings, catalogProducts } from "../db/schema/catalog"
import { log } from "../log"
import { emailBrandLeads } from "../orders/brand-email"
import { notSampleBrandSql } from "./sample-guard"

/**
 * Friendly reminder emails to brands (jobs.nudgeBrands, every 30 minutes). Cost scales with time,
 * not traffic: each run is one bounded query per reminder kind on partial indexes, and does more
 * only when a reminder is actually due. The rules live in src/lib/brand-emails.ts (unit-tested);
 * the SQL applies the same rules and the rows are checked against them again before sending.
 *
 *  - Still in drafts: a product that's been a draft for 12 hours since the brand could first publish
 *    it (created, founding brand claimed, application approved: draftClockStart) (never published, not hidden,
 *    brand not restricted or suspended, not under review, not an unclaimed founding brand) is
 *    mentioned once. One email per brand per run covers all its due drafts; every product it
 *    covers is marked (catalog_products.draft_nudged_at), so none is ever mentioned twice.
 *  - Publish your storefront: a claimed founding brand with published products whose storefront was
 *    never published, a day after claiming, once (brands.storefront_nudged_at).
 *
 * A brand hears at most one reminder a day (brands.last_nudged_at), and none once an owner or admin
 * switched them off in Studio settings (brands.nudge_emails). Every reminder is audited.
 */

const BATCH = 200

/** Due drafts, oldest first (one query; catalog_products_draft_nudge_ix). */
async function draftCandidates(now: Date): Promise<DraftCandidate[]> {
  const d = await db()
  const dueBy = new Date(now.getTime() - DRAFT_NUDGE_AFTER_MS)
  // When the brand's application was approved: the first product, saved with the application, couldn't be published before.
  const approvedAt = sql<Date | null>`(select max(${brandOnboardings.reviewedAt}) from ${brandOnboardings} where ${brandOnboardings.brandId} = ${brands.id} and ${brandOnboardings.status} = 'approved')`
  const rows = await d
    .select({
      productId: catalogProducts.id,
      brandId: catalogProducts.brandId,
      title: catalogProducts.title,
      status: catalogProducts.status,
      createdAt: catalogProducts.createdAt,
      publishedAt: catalogProducts.publishedAt,
      draftNudgedAt: catalogProducts.draftNudgedAt,
      moderation: catalogProducts.moderationStatus,
      brandReview: brands.reviewStatus,
      brandNudges: brands.nudgeEmails,
      claimStatus: brands.claimStatus,
      claimedAt: brands.claimedAt,
      approvedAt,
      brandLastNudgedAt: brands.lastNudgedAt,
      storefrontUnpublished: sql<boolean>`(${brands.founding} and ${brands.launchedAt} is null)`,
    })
    .from(catalogProducts)
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(
      and(
        eq(catalogProducts.status, "draft"),
        isNull(catalogProducts.draftNudgedAt),
        isNull(catalogProducts.publishedAt),
        // The clock starts when the brand could first publish it (draftClockStart): created, claimed, application approved.
        lte(catalogProducts.createdAt, dueBy),
        sql`(${brands.claimedAt} is null or ${brands.claimedAt} <= ${dueBy})`,
        sql`not exists (select 1 from ${brandOnboardings} where ${brandOnboardings.brandId} = ${brands.id} and ${brandOnboardings.status} = 'approved' and ${brandOnboardings.reviewedAt} > ${dueBy})`,
        sql`greatest(${catalogProducts.createdAt}, ${brands.claimedAt}, ${approvedAt}) > ${new Date(now.getTime() - DRAFT_NUDGE_MAX_AGE_MS)}`,
        eq(catalogProducts.moderationStatus, "ok"),
        eq(brands.nudgeEmails, true),
        sql`${brands.reviewStatus} not in ('restricted', 'suspended')`,
        sql`${brands.claimStatus} <> 'unclaimed'`,
        sql`(${brands.lastNudgedAt} is null or ${brands.lastNudgedAt} <= ${new Date(now.getTime() - NUDGE_COOLDOWN_MS)})`,
        sql`not exists (select 1 from ${brandOnboardings} where ${brandOnboardings.brandId} = ${brands.id} and ${brandOnboardings.status} in ('draft', 'submitted', 'rejected'))`,
        notSampleBrandSql(brands.id),
      ),
    )
    .orderBy(asc(catalogProducts.createdAt), asc(catalogProducts.id))
    .limit(BATCH)
  return rows.map((r) => ({ ...r, approvedAt: r.approvedAt ? new Date(r.approvedAt) : null, underReview: false, storefrontUnpublished: !!r.storefrontUnpublished }))
}

/** Claimed founding brands whose storefront was never published (one query; brands_founding_ix). */
async function storefrontCandidates(now: Date): Promise<StorefrontCandidate[]> {
  const d = await db()
  const ready = sql<number>`(select count(*)::int from ${catalogProducts} where ${catalogProducts.brandId} = ${brands.id} and ${catalogProducts.status} in ('published', 'scheduled') and ${catalogProducts.moderationStatus} = 'ok')`
  const rows = await d
    .select({
      brandId: brands.id,
      founding: brands.founding,
      claimStatus: brands.claimStatus,
      claimedAt: brands.claimedAt,
      launchedAt: brands.launchedAt,
      storefrontNudgedAt: brands.storefrontNudgedAt,
      brandReview: brands.reviewStatus,
      brandNudges: brands.nudgeEmails,
      brandLastNudgedAt: brands.lastNudgedAt,
      readyProducts: ready,
    })
    .from(brands)
    .where(
      and(
        eq(brands.founding, true),
        eq(brands.claimStatus, "claimed"),
        isNull(brands.launchedAt),
        isNull(brands.storefrontNudgedAt),
        eq(brands.nudgeEmails, true),
        lte(brands.claimedAt, new Date(now.getTime() - STOREFRONT_NUDGE_AFTER_MS)),
        sql`${brands.reviewStatus} not in ('restricted', 'suspended')`,
        sql`(${brands.lastNudgedAt} is null or ${brands.lastNudgedAt} <= ${new Date(now.getTime() - NUDGE_COOLDOWN_MS)})`,
        sql`${ready} > 0`,
        notSampleBrandSql(brands.id),
      ),
    )
    .orderBy(asc(brands.claimedAt), asc(brands.id))
    .limit(BATCH)
  return rows.map((r) => ({ ...r, readyProducts: Number(r.readyProducts) || 0 }))
}

/** Sends the due reminders. Each brand's reminder is its own transaction: marks, outbox rows and the audit row commit together. */
export async function nudgeBrands(now = new Date()): Promise<{ drafts: number; storefronts: number; emails: number }> {
  const out = { drafts: 0, storefronts: 0, emails: 0 }

  // Storefront first: a brand due both gets the storefront reminder today (its draft reminder mentions the storefront tomorrow).
  for (const c of await storefrontCandidates(now)) {
    if (!storefrontNudgeEligible(c, now)) continue
    await withTx(async (tx) => {
      const [locked] = await tx
        .update(brands)
        .set({ storefrontNudgedAt: now, lastNudgedAt: now })
        .where(and(eq(brands.id, c.brandId), isNull(brands.storefrontNudgedAt), isNull(brands.launchedAt), eq(brands.nudgeEmails, true)))
        .returning({ name: brands.name })
      if (!locked) return
      const sent = await emailBrandLeads(tx, c.brandId, "brand_storefront_nudge", { products: c.readyProducts }, `brand_storefront_nudge:${c.brandId}`)
      await writeAudit({ actor: { kind: "system" }, action: "brand_email.storefront_nudge", target: locked.name, subjectType: "brand", subjectId: c.brandId, brandId: c.brandId, meta: { template: "brand_storefront_nudge", emailed: sent, readyProducts: c.readyProducts } })
      out.storefronts++
      out.emails += sent
    })
  }

  const nudged = new Set<string>()
  for (const g of groupDraftNudges(await draftCandidates(now), now)) {
    await withTx(async (tx) => {
      // The brand's cooldown is taken first (row lock): a reminder sent meanwhile by another run wins.
      const [b] = await tx
        .update(brands)
        .set({ lastNudgedAt: now })
        .where(and(eq(brands.id, g.brandId), eq(brands.nudgeEmails, true), sql`(${brands.lastNudgedAt} is null or ${brands.lastNudgedAt} <= ${new Date(now.getTime() - NUDGE_COOLDOWN_MS)})`))
        .returning({ name: brands.name })
      if (!b) return
      const ids = g.products.map((p) => p.id)
      // Only products still a never-published, un-reminded draft are claimed (and so mentioned).
      const claimed = await tx
        .update(catalogProducts)
        .set({ draftNudgedAt: now })
        .where(and(sql`${catalogProducts.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`, eq(catalogProducts.status, "draft"), isNull(catalogProducts.draftNudgedAt), isNull(catalogProducts.publishedAt)))
        .returning({ id: catalogProducts.id })
      const kept = g.products.filter((p) => claimed.some((c) => c.id === p.id))
      if (!kept.length) {
        // Nothing left to mention: give the cooldown back.
        await tx.update(brands).set({ lastNudgedAt: null }).where(eq(brands.id, g.brandId))
        return
      }
      const [first, ...rest] = kept
      const vars: Record<string, string | number> = { product: first.title, productId: first.id, more: rest.length }
      if (rest.length) vars.others = rest.slice(0, DRAFT_NUDGE_NAMED - 1).map((p) => p.title).join(" | ")
      if (g.storefrontUnpublished) vars.storefront = "unpublished"
      const sent = await emailBrandLeads(tx, g.brandId, "brand_draft_nudge", vars, `brand_draft_nudge:${first.id}`)
      await writeAudit({ actor: { kind: "system" }, action: "brand_email.draft_nudge", target: b.name, subjectType: "brand", subjectId: g.brandId, brandId: g.brandId, meta: { template: "brand_draft_nudge", emailed: sent, products: kept.map((p) => p.id) } })
      out.drafts += kept.length
      out.emails += sent
      nudged.add(g.brandId)
    })
  }
  if (out.drafts + out.storefronts) log.info(`[yard] brand reminders: ${out.drafts} drafts across ${nudged.size} brands, ${out.storefronts} storefronts, ${out.emails} emails queued`)
  return out
}
