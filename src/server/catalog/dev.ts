import "server-only"
import { and, eq, inArray, like } from "drizzle-orm"
import type { AdminActor, BrandActor } from "../auth/dal"
import { db, withTx } from "../db"
import { brandOnboardings, catalogProducts, catalogVariants, stockHolds } from "../db/schema/catalog"
import { badRequest, notFound } from "../http/errors"
import { publishScheduled, setProductModeration } from "./jobs"
import { reviewOnboarding } from "./onboarding"
import { commitHold, holdStock, releaseHold, restock, sweepExpiredHolds } from "./stock"

/**
 * DEVELOPMENT-ONLY test hooks for the CATALOG acceptance kit (scripts/checks/v3-catalog.mjs). The
 * routes under src/app/api/studio/catalog/dev answer 404 in production before anything else.
 * They drive the stock contract (holdStock/commitHold/releaseHold/restock and TTL expiry) and the
 * admin-only catalogue functions that have no admin route yet, and only ever touch test data:
 * hold keys must start with "t_v3_", variants must be the caller's brand's, products' titles and
 * onboarding handles must carry the t_v3 / t-v3 tag.
 */

const HOLD_KEY = /^t_v3_[\w-]{1,80}$/

export type DevStockBody =
  | { action: "hold"; holdKey: string; lines: { variantId: string; qty: number }[]; ttlMinutes?: number }
  | { action: "commit" | "release" | "expire" | "holds"; holdKey: string }
  | { action: "restock"; variantId: string; qty: number; reason: string }

async function assertOwnVariants(brandId: string, ids: string[]) {
  const uniq = [...new Set(ids)]
  if (!uniq.length) return
  const d = await db()
  const rows = await d
    .select({ id: catalogVariants.id })
    .from(catalogVariants)
    .where(and(inArray(catalogVariants.id, uniq), eq(catalogVariants.brandId, brandId)))
  if (rows.length !== uniq.length) throw notFound("Test hooks only touch your own variants.")
}

export async function devStock(actor: BrandActor, body: DevStockBody) {
  if (body.action !== "restock" && !HOLD_KEY.test(body.holdKey)) throw badRequest({ holdKey: "Test hold keys start with t_v3_." })
  switch (body.action) {
    case "hold":
      await assertOwnVariants(
        actor.brandId,
        body.lines.map((l) => l.variantId),
      )
      return withTx((tx) => holdStock(tx, { holdKey: body.holdKey, lines: body.lines, ttlMinutes: body.ttlMinutes }))
    case "commit":
      await withTx((tx) => commitHold(tx, body.holdKey))
      return { ok: true }
    case "release":
      await withTx((tx) => releaseHold(tx, body.holdKey))
      return { ok: true }
    case "restock":
      await assertOwnVariants(actor.brandId, [body.variantId])
      await withTx((tx) => restock(tx, { variantId: body.variantId, qty: body.qty, reason: body.reason }))
      return { ok: true }
    case "expire": {
      // Backdate this key's active holds, then run the real sweep job.
      const d = await db()
      await d
        .update(stockHolds)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(and(eq(stockHolds.holdKey, body.holdKey), eq(stockHolds.status, "active")))
      return sweepExpiredHolds()
    }
    case "holds": {
      const d = await db()
      const rows = await d.select().from(stockHolds).where(eq(stockHolds.holdKey, body.holdKey))
      return { holds: rows.map((h) => ({ variantId: h.variantId, qty: h.qty, status: h.status, expiresAt: h.expiresAt.toISOString() })) }
    }
  }
}

export type DevAdminBody =
  | { action: "moderate"; productId: string; hidden: boolean; reason: string }
  | { action: "review"; onboardingId: string; decision: "approve" | "reject"; note?: string }
  | { action: "publishScheduled" }
  | { action: "backdateSchedule"; productId: string }

async function assertTestProduct(productId: string) {
  const d = await db()
  const [p] = await d
    .select({ id: catalogProducts.id })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.id, productId), like(catalogProducts.title, "%t_v3_%")))
    .limit(1)
  if (!p) throw notFound("Test hooks only touch t_v3_ test products.")
}

export async function devAdmin(actor: AdminActor, body: DevAdminBody, ipHash: string | null) {
  switch (body.action) {
    case "moderate":
      await assertTestProduct(body.productId)
      return setProductModeration(actor, { productId: body.productId, hidden: body.hidden, reason: body.reason, ipHash })
    case "review": {
      const d = await db()
      const [o] = await d.select({ id: brandOnboardings.id, data: brandOnboardings.data }).from(brandOnboardings).where(eq(brandOnboardings.id, body.onboardingId)).limit(1)
      const handle = (o?.data as { brand?: { handle?: string } } | undefined)?.brand?.handle ?? ""
      if (!o || !handle.startsWith("t-v3-")) throw notFound("Test hooks only review t-v3- test applications.")
      return reviewOnboarding(actor, { onboardingId: body.onboardingId, decision: body.decision, note: body.note, ipHash })
    }
    case "backdateSchedule": {
      // Moves a scheduled test product's publish time into the past so the job (or public reads) see it as due.
      await assertTestProduct(body.productId)
      const d = await db()
      await d
        .update(catalogProducts)
        .set({ publishAt: new Date(Date.now() - 1000) })
        .where(and(eq(catalogProducts.id, body.productId), eq(catalogProducts.status, "scheduled")))
      return { ok: true }
    }
    case "publishScheduled":
      return publishScheduled()
  }
}
