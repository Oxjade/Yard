import "server-only"
import { and, asc, eq, inArray, lte } from "drizzle-orm"
import { listingState, type ListingState } from "@/lib/brand-emails"
import { writeAudit } from "../audit"
import type { AdminActor } from "../auth/dal"
import { withTx } from "../db"
import { brands } from "../db/schema"
import { catalogProducts } from "../db/schema/catalog"
import { notFound } from "../http/errors"
import { emailBrandLeads } from "../orders/brand-email"
import { catalogChanged } from "./hooks"
import { brandUnderReview } from "./studio"

/**
 * Scheduled publish (every minute): scheduled products whose publish_at has passed go live. A
 * product whose brand is restricted, suspended or still under review, or that moderation hid,
 * stays scheduled and is retried; public reads already treat a due scheduled product as live
 * only through productPublicWhere, which applies the same brand and moderation checks.
 */
export async function publishScheduled(): Promise<{ published: number }> {
  return withTx(async (tx) => {
    const now = new Date()
    const due = await tx
      .select({ id: catalogProducts.id, brandId: catalogProducts.brandId, title: catalogProducts.title, version: catalogProducts.version, publishedAt: catalogProducts.publishedAt, moderation: catalogProducts.moderationStatus, review: brands.reviewStatus })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(and(eq(catalogProducts.status, "scheduled"), lte(catalogProducts.publishAt, now)))
      .limit(500)
    const ids: string[] = []
    for (const p of due) {
      if (p.moderation !== "ok" || p.review === "restricted" || p.review === "suspended") continue
      if (await brandUnderReview(tx, p.brandId)) continue
      await tx
        .update(catalogProducts)
        .set({ status: "published", publishAt: null, publishedAt: p.publishedAt ?? now, version: p.version + 1, updatedAt: now })
        .where(and(eq(catalogProducts.id, p.id), eq(catalogProducts.version, p.version)))
      await writeAudit({ actor: { kind: "system" }, action: "catalog.product_published", target: p.title, subjectType: "catalog_product", subjectId: p.id, brandId: p.brandId, meta: { scheduled: true } })
      ids.push(p.id)
    }
    if (ids.length) catalogChanged({ products: ids })
    return { published: ids.length }
  })
}

/** Listings one moderation decision can cover (Admin › Products bulk Restrict / Lift sends them in one request). */
export const MODERATION_BATCH_MAX = 100

/**
 * Admin moderation: hides (or un-hides) one or more products. Hidden products drop out of every
 * public read and of getSellableVariants at once. For an admin route (content.moderate) or the
 * moderation module to call; each product's audit row is written in the same transaction.
 *
 * The brand's owners and admins hear about it from the outbox after commit, ONE email per brand per
 * decision however many of its listings it covers (listing_held with the reason; listing_back when
 * the hold is lifted). The copy follows where each listing stands with shoppers (listingState):
 * listing_held says "paused" only for a listing shoppers could see, and listing_back says "back on
 * Yard" only for one that's live again; a draft, a scheduled product, a restricted brand or an
 * unlaunched founding storefront gets "the hold is lifted" and what's left before it shows. A brand
 * whose listings fall into different states gets one email per state.
 */
export async function setProductsModeration(actor: AdminActor, input: { productIds: string[]; hidden: boolean; reason: string; ipHash?: string | null }) {
  const ids = [...new Set(input.productIds)]
  if (!ids.length) throw notFound("That product doesn't exist.")
  return withTx(async (tx) => {
    const rows = await tx
      .select({ p: catalogProducts, brandReview: brands.reviewStatus, founding: brands.founding, launchedAt: brands.launchedAt })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(inArray(catalogProducts.id, ids))
      .orderBy(asc(catalogProducts.title), asc(catalogProducts.id))
      .for("update", { of: catalogProducts })
    if (rows.length !== ids.length) throw notFound(ids.length === 1 ? "That product doesn't exist." : "One of those products doesn't exist anymore. Refresh and try again.")
    const now = new Date()
    const reason = input.reason.slice(0, 500)
    const template = input.hidden ? "listing_held" : "listing_back"

    // One email per brand (and per state): the products a real change touched (hiding a hidden product again sends nothing).
    const groups = new Map<string, { brandId: string; state: ListingState; products: { id: string; title: string; version: number }[] }>()
    for (const { p, brandReview, founding, launchedAt } of rows) {
      await tx
        .update(catalogProducts)
        .set({ moderationStatus: input.hidden ? "hidden" : "ok", moderationReason: input.hidden ? reason : null, moderatedAt: now, moderatedBy: actor.userId, version: p.version + 1, updatedAt: now })
        .where(eq(catalogProducts.id, p.id))
      if ((p.moderationStatus === "hidden") === input.hidden) continue
      const state = listingState({ status: p.status, publishAt: p.publishAt, brandReview, founding, launchedAt }, now)
      const key = `${p.brandId}:${state}`
      const g = groups.get(key) ?? { brandId: p.brandId, state, products: [] }
      g.products.push({ id: p.id, title: p.title, version: p.version + 1 })
      groups.set(key, g)
    }

    // Which email (if any) each product went out in, for its audit row and the brand's sent history.
    const emailedBy = new Map<string, { emailed: number; first: string; state: ListingState; products: number }>()
    for (const g of groups.values()) {
      const [first, ...rest] = g.products
      const vars: Record<string, string | number> = { product: first.title, productId: first.id, more: rest.length, state: g.state }
      if (rest.length) vars.others = rest.slice(0, 2).map((x) => x.title).join(" | ")
      if (input.hidden) vars.reason = reason
      const emailed = await emailBrandLeads(tx, g.brandId, template, vars, `${template}:${first.id}:${first.version}:${g.products.length}`)
      for (const x of g.products) emailedBy.set(x.id, { emailed: x.id === first.id ? emailed : 0, first: first.id, state: g.state, products: g.products.length })
    }

    for (const { p } of rows) {
      const e = emailedBy.get(p.id)
      await writeAudit({
        actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
        action: input.hidden ? "catalog.product_hidden" : "catalog.product_unhidden",
        target: p.title,
        subjectType: "catalog_product",
        subjectId: p.id,
        brandId: p.brandId,
        reason: input.reason,
        ipHash: input.ipHash ?? null,
        // emailed counts on the first product of each email, so the brand's sent history shows it once.
        meta: e ? { template, state: e.state, emailed: e.emailed, ...(e.first !== p.id ? { emailedWith: e.first } : {}), ...(e.products > 1 ? { products: e.products } : {}) } : { template, emailed: 0, unchanged: true },
      })
    }
    catalogChanged({ products: rows.map((r) => r.p.id) })
    const status = input.hidden ? ("hidden" as const) : ("ok" as const)
    return { products: rows.map((r) => ({ productId: r.p.id, moderationStatus: status })), emails: [...groups.values()].length }
  })
}

/** One product's moderation (the single-listing route and the dev hooks): setProductsModeration for one id. */
export async function setProductModeration(actor: AdminActor, input: { productId: string; hidden: boolean; reason: string; ipHash?: string | null }) {
  const r = await setProductsModeration(actor, { productIds: [input.productId], hidden: input.hidden, reason: input.reason, ipHash: input.ipHash })
  return r.products[0]
}
