import "server-only"
import { and, eq, ne } from "drizzle-orm"
import type { BrandRemovalBody, BrandRemovalPreviewDto, BrandRemovalResultDto } from "@/lib/api/contracts/brand-removal"
import type { Candidate } from "@/lib/seo/indexnow"
import type { AdminActor } from "../auth/dal"
import { requireRecentReauth } from "../auth/reauth"
import { endBrandSessions } from "../auth/session"
import { writeAudit } from "../audit"
import { invalidateMemo } from "../cache"
import { afterCommit, db, withTx } from "../db"
import { brandLocations, drops, locationEvents, socialAccounts, socialPosts } from "../db/schema"
import { badRequest, conflict, forbidden, notFound, rule } from "../http/errors"
import { log } from "../log"
import { resolveStored } from "../media/store"
import { publishCountsAfterCommit, tryFeature } from "../moderation/shared"
import { refreshMedia } from "../moderation/content"
import { indexNowCandidates, indexNowOn, queueIndexNowCandidates } from "../seo/indexnow"
import { canAdmin, needsRole } from "@/lib/permissions"
import { closeBrandRows, eraseBrandRows, planBrandRemoval, unlinkFiles, type Db } from "./brand-removal-db"
import { catalogChanged } from "./hooks"

/**
 * Admin › Brands › Delete brand (README › Deleting a brand). Owner admins only (brands.delete),
 * with a re-auth in the last 5 minutes like the other destructive admin actions (adding admins,
 * claim links). The database work is brand-removal-db.ts; this adds the checks, the audit row and
 * the after-commit effects: files unlinked, the brand's sessions told they ended, the public
 * memos (catalogue, home grid, storefront, sitemap, feeds, llms.txt), charts and Around dropped,
 * search re-indexed and the removed URLs queued for IndexNow.
 */

const REAUTH_MAX_AGE = 300

function assertMayRemove(actor: AdminActor) {
  if (!canAdmin(actor.role, "brands.delete")) throw forbidden(`${needsRole("brands.delete")}.`)
}

export async function previewBrandRemoval(actor: AdminActor, brandId: string): Promise<BrandRemovalPreviewDto> {
  assertMayRemove(actor)
  const plan = await planBrandRemoval((await db()) as unknown as Db, brandId)
  if (!plan) throw notFound("That brand doesn't exist any more.")
  return plan
}

const sameHandle = (a: string, b: string) => a.trim().replace(/^@/, "").toLowerCase() === b.toLowerCase()

export async function removeBrand(actor: AdminActor, brandId: string, body: BrandRemovalBody, meta: { ipHash: string | null }): Promise<BrandRemovalResultDto> {
  assertMayRemove(actor)
  await requireRecentReauth(actor, REAUTH_MAX_AGE)
  let files: string[] = []
  const out = await withTx(async () => {
    const d = (await db()) as unknown as Db
    const plan = await planBrandRemoval(d, brandId)
    if (!plan) throw notFound("That brand doesn't exist any more.")
    const b = plan.brand
    if (b.closedAt) throw rule(`${b.name} is already closed.`)
    if (!sameHandle(body.confirmHandle, b.handle)) throw badRequest({ confirmHandle: `Type ${b.handle} to confirm.` })
    // What the admin saw must still hold: an order placed since the preview turns a delete into a close.
    if (plan.mode !== body.mode) throw conflict(plan.mode === "close" ? `${b.name} now has orders or money on record, so it can only be closed. Reload to see what changes.` : `${b.name} can now be erased instead of closed. Reload to see what changes.`)

    // The public pages that go, read now: after an erase there's nothing left to read them from.
    const dropRows = await d.select({ id: drops.id }).from(drops).where(eq(drops.brandId, b.id))
    const gonePages: Candidate[] = indexNowOn() ? (await indexNowCandidates({ brands: [b.id], brandProducts: [b.id], drops: dropRows.map((r) => r.id) })).map((c) => ({ ...c, visibility: "none" as const })) : []
    // Brand sessions end through AUTH (session.ended goes out after commit).
    const sessionsEnded = await endBrandSessions(b.id, plan.mode === "delete" ? "brand_deleted" : "brand_closed")
    // Social accounts disconnect through SOCIAL: tokens deleted now, the provider told after commit.
    const linked = await d.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.brandId, b.id), ne(socialAccounts.status, "disconnected")))
    if (linked.length) {
      const social = await import("../social")
      for (const a of linked) await tryFeature("social.forceDisconnect", () => social.forceDisconnect(a.id, plan.mode === "delete" ? "Brand deleted by Yard" : "Brand closed by Yard"))
    }

    let removed: Record<string, number>
    if (plan.mode === "delete") {
      const r = await eraseBrandRows(d, b.id)
      removed = r.removed
      files = r.files
    } else {
      const r = await closeBrandRows(d, b.id, { userId: actor.userId })
      removed = r.removed
      // Its posts, places and events stop being public (the brand isn't listed any more).
      const [posts, places, events] = await Promise.all([
        d.select({ media: socialPosts.media }).from(socialPosts).where(eq(socialPosts.brandId, b.id)),
        d.select({ images: brandLocations.images }).from(brandLocations).where(eq(brandLocations.brandId, b.id)),
        d.select({ image: locationEvents.image }).from(locationEvents).where(eq(locationEvents.brandId, b.id)),
      ])
      await refreshMedia([...posts.flatMap((p) => p.media.flatMap((m) => [m.mediaId, m.posterMediaId])), ...places.flatMap((p) => p.images.map((i) => i.mediaId)), ...events.map((e) => e.image?.mediaId)])
    }

    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: plan.mode === "delete" ? "brand.deleted" : "brand.closed",
      target: `${b.name} (@${b.handle}): ${plan.mode === "delete" ? "deleted" : "closed"}`,
      subjectType: "brand",
      subjectId: b.id,
      brandId: b.id,
      reason: body.reason,
      ipHash: meta.ipHash,
      meta: { mode: plan.mode, brand: { id: b.id, handle: b.handle, name: b.name }, records: plan.records, removed, files: files.length, sessionsEnded },
    })

    afterCommit(async () => {
      const chartsMod = await import("../charts")
      await tryFeature("charts.invalidate", () => chartsMod.invalidate(b.id))
      const aroundMod = await import("../around")
      await tryFeature("around.invalidate", () => aroundMod.invalidate())
      // Sitemap, feeds and llms.txt are memoised for 30–60 minutes: drop them now.
      invalidateMemo("seo:")
      invalidateMemo(`shipping:brand:${b.id}`)
      if (gonePages.length) await queueIndexNowCandidates(gonePages).catch((e: unknown) => log.error("[yard] brand removal: indexnow queueing failed", e))
    })
    // The catalogue memos (home grid, storefront, product pages), media visibility and search.
    catalogChanged({ brands: [b.id], reindexBrands: [b.id] })
    publishCountsAfterCommit()
    return { mode: plan.mode, brand: { id: b.id, handle: b.handle, name: b.name }, removed, sessionsEnded }
  })
  // Files go once the rows are gone for good (a rolled-back erase never reaches this line).
  const filesRemoved = await unlinkFiles(files, resolveStored, (p, e) => log.error(`[yard] brand removal: couldn't delete ${p}`, e))
  return { ...out, filesRemoved }
}
