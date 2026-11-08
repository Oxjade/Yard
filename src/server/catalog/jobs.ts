import "server-only"
import { and, eq, lte } from "drizzle-orm"
import { writeAudit } from "../audit"
import type { AdminActor } from "../auth/dal"
import { withTx } from "../db"
import { brands } from "../db/schema"
import { catalogProducts } from "../db/schema/catalog"
import { notFound } from "../http/errors"
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

/**
 * Admin moderation: hides (or un-hides) a product. Hidden products drop out of every public read
 * and of getSellableVariants at once. For an admin route (content.moderate) or the moderation
 * module to call; writes the audit row in the same transaction.
 */
export async function setProductModeration(actor: AdminActor, input: { productId: string; hidden: boolean; reason: string; ipHash?: string | null }) {
  return withTx(async (tx) => {
    const [p] = await tx.select().from(catalogProducts).where(eq(catalogProducts.id, input.productId)).limit(1)
    if (!p) throw notFound("That product doesn't exist.")
    const now = new Date()
    await tx
      .update(catalogProducts)
      .set({ moderationStatus: input.hidden ? "hidden" : "ok", moderationReason: input.hidden ? input.reason.slice(0, 500) : null, moderatedAt: now, moderatedBy: actor.userId, version: p.version + 1, updatedAt: now })
      .where(eq(catalogProducts.id, p.id))
    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: input.hidden ? "catalog.product_hidden" : "catalog.product_unhidden",
      target: p.title,
      subjectType: "catalog_product",
      subjectId: p.id,
      brandId: p.brandId,
      reason: input.reason,
      ipHash: input.ipHash ?? null,
    })
    catalogChanged({ products: [p.id] })
    return { productId: p.id, moderationStatus: input.hidden ? "hidden" : "ok" }
  })
}
