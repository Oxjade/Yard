import "server-only"
import { eq } from "drizzle-orm"
import { drops } from "@/lib/data/catalog"
import { productById } from "@/lib/data/products"
import { db } from "../db"
import { messageAttachments } from "../db/schema"
import { badRequest } from "../http/errors"
import type { Actor } from "./dal"
import { refusedSampleDrop, refusedSampleProduct, sampleOff } from "../catalog/sample-guard"

const dropById = (id: string) => drops.find((d) => d.id === id)

/**
 * Foreign ids in write bodies (§2.6). The resource in the URL is checked by the DAL; every OTHER
 * id a body names goes through assertOwned before the write. A failure is 400 `validation` with
 * the field path, which says "not yours" without saying whose.
 */
export type OwnedRef =
  /** A static-catalogue product of `brandId` (default: the actor's active brand). */
  | { kind: "product"; id: string; field: string; brandId?: string }
  | { kind: "drop"; id: string; field: string; brandId?: string }
  /** The actor's own published, approved store or showroom. */
  | { kind: "pickupLocation"; id: string; field: string }
  | { kind: "quickReply"; id: string; field: string }
  /**
   * An inbox attachment uploaded by this actor, unbound or bound to `conversationId` (or, for a
   * shopper's new thread, targeted at `targetBrandId`), not removed and not attached yet.
   */
  | { kind: "attachment"; id: string; field: string; conversationId?: string | null; targetBrandId?: string | null }
  /** A brand upload of the active brand for posts or places. */
  | { kind: "media"; id: string; field: string; purpose: "social_post" | "location_image" | "social_import" }
  /** One of the shopper's orders with `brandId`. */
  | { kind: "orderRef"; id: string; field: string; brandId: string }

const messages: Record<OwnedRef["kind"], string> = {
  product: "That piece isn't in this catalogue.",
  drop: "That drop isn't one of yours.",
  pickupLocation: "Choose one of your published stores or showrooms.",
  quickReply: "That quick reply isn't one of yours.",
  attachment: "That file can't be attached here.",
  media: "That file isn't one of your uploads.",
  orderRef: "That order isn't one of yours with this brand.",
}

const brandOf = (actor: Actor) => (actor.kind === "brand" ? actor.brandId : null)

export async function assertOwned(actor: Actor, refs: OwnedRef[]) {
  const fields: Record<string, string> = {}
  const fail = (r: OwnedRef, message?: string) => {
    fields[r.field] ??= message ?? (r.kind === "product" && actor.kind === "brand" ? "That piece isn't in your catalogue." : messages[r.kind])
  }
  const d = await db()

  for (const r of refs) {
    switch (r.kind) {
      case "product": {
        // Demo and development: a sample piece first. Otherwise (always in production, where a
        // sample id fails) the server catalogue's product, not archived.
        const brand = r.brandId ?? brandOf(actor)
        if (refusedSampleProduct(r.id)) {
          fail(r)
          break
        }
        const sample = sampleOff() ? undefined : productById.get(r.id)
        const owner = sample
          ? sample.brandId
          : (await d.query.catalogProducts.findFirst({ columns: { brandId: true, status: true }, where: (p, { eq }) => eq(p.id, r.id) }).then((p) => (p && p.status !== "archived" ? p.brandId : undefined)))
        if (!owner || !brand || owner !== brand) fail(r)
        break
      }
      case "drop": {
        const brand = r.brandId ?? brandOf(actor)
        if (refusedSampleDrop(r.id)) {
          fail(r)
          break
        }
        const sample = sampleOff() ? undefined : dropById(r.id)
        const owner = sample ? sample.brandId : (await d.query.drops.findFirst({ columns: { brandId: true }, where: (x, { eq }) => eq(x.id, r.id) }))?.brandId
        if (!owner || !brand || owner !== brand) fail(r)
        break
      }
      case "pickupLocation": {
        const brand = brandOf(actor)
        const row = brand
          ? await d.query.brandLocations.findFirst({ where: (l, { and, eq, inArray }) => and(eq(l.id, r.id), eq(l.brandId, brand), inArray(l.kind, ["store", "showroom"]), eq(l.visibility, "published"), eq(l.moderationStatus, "approved")) })
          : null
        if (!row) fail(r)
        break
      }
      case "quickReply": {
        const brand = brandOf(actor)
        const row = brand ? await d.query.quickReplies.findFirst({ where: (q, { and, eq }) => and(eq(q.id, r.id), eq(q.brandId, brand)) }) : null
        if (!row) fail(r)
        break
      }
      case "attachment": {
        const m = await d.query.mediaAssets.findFirst({ where: (x, { eq }) => eq(x.id, r.id) })
        const used = m ? await d.select({ id: messageAttachments.id }).from(messageAttachments).where(eq(messageAttachments.mediaId, m.id)).limit(1) : []
        const mine = !!m && m.createdBy === actor.userId && (actor.kind !== "brand" || m.brandId === actor.brandId)
        const bound = !!m && (m.conversationId === null ? (r.conversationId ? true : !!r.targetBrandId && m.targetBrandId === r.targetBrandId) : m.conversationId === r.conversationId)
        if (!m || !mine || m.purpose !== "inbox_attachment" || m.moderationStatus === "removed" || !bound || used.length) fail(r)
        break
      }
      case "media": {
        const brand = brandOf(actor)
        const m = brand ? await d.query.mediaAssets.findFirst({ where: (x, { eq }) => eq(x.id, r.id) }) : null
        if (!m || m.brandId !== brand || m.purpose !== r.purpose || m.moderationStatus === "removed") fail(r)
        break
      }
      case "orderRef": {
        const row = await d.query.orderRefs.findFirst({ where: (o, { and, eq }) => and(eq(o.id, r.id), eq(o.customerId, actor.userId), eq(o.brandId, r.brandId)) })
        if (!row) fail(r)
        break
      }
    }
  }
  if (Object.keys(fields).length) throw badRequest(fields)
}
