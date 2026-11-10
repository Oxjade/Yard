import "server-only"
import { activeRestriction, assertBrandMayPublish, type BrandActor, type ShopperActor } from "../auth/dal"
import { db } from "../db"
import { badRequest, forbidden, notFound, restricted } from "../http/errors"
import { brandCanInteract, shopperCanInteract } from "../inbox/interact"
import { canBrand } from "@/lib/permissions"
import type { UploadPurpose } from "@/lib/api/contracts/uploads"
import { brandOnboardings } from "../db/schema/catalog"
import { desc, eq } from "drizzle-orm"

/**
 * Upload authorisation from the query string alone (§5.4 step 1), so nothing is read from the
 * body until the actor may upload this file here:
 *  - a shopper uploads only inbox attachments: to a conversation that loads through their own
 *    scope, or (first message of a new thread) for a listed brand they may message;
 *  - a brand member: inbox attachments need a conversation of the ACTIVE brand and inbox.reply
 *    (so a brand can't name another brand's conversation and make a file readable by its
 *    shopper); social_post needs content.publish; location_image needs locations.manage.
 * Inbox uploads also pass the inbox's own interaction check (§4.4, cluster I's interact.ts):
 * blocks in either direction, a locked conversation, messaging restrictions and the brand's status.
 */
export type UploadTarget = {
  purpose: UploadPurpose
  ownerKind: "brand" | "user"
  ownerId: string
  brandId: string | null
  conversationId: string | null
  targetBrandId: string | null
}

type Query = { purpose: UploadPurpose; conversationId?: string; brandId?: string }

const untilText = (until: Date | null) => (until ? ` until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "")

async function assertNotRestricted(subjectKind: "user" | "brand", id: string, kind: "uploads" | "messaging", who: "you" | "brand") {
  const r = await activeRestriction(subjectKind, id, kind)
  if (!r) return
  const what = kind === "uploads" ? "Uploading" : "Messaging"
  throw restricted(who === "you" ? `${what} is paused on your account${untilText(r.until)}.` : `${what} is paused for this brand${untilText(r.until)}.`)
}

export async function authorizeShopperUpload(actor: ShopperActor, q: Query): Promise<UploadTarget> {
  await assertNotRestricted("user", actor.userId, "uploads", "you")
  if (q.purpose === "onboarding_image") {
    const d = await db()
    const [application] = await d
      .select({ status: brandOnboardings.status })
      .from(brandOnboardings)
      .where(eq(brandOnboardings.userId, actor.userId))
      .orderBy(desc(brandOnboardings.createdAt))
      .limit(1)
    if (!application || !["draft", "rejected"].includes(application.status)) throw forbidden("Onboarding photos are available only while your application can be edited.")
    return { purpose: q.purpose, ownerKind: "user", ownerId: actor.userId, brandId: null, conversationId: null, targetBrandId: null }
  }
  if (q.purpose !== "inbox_attachment") throw forbidden("Shoppers can only attach photos to messages or upload onboarding images.")
  if (!!q.conversationId === !!q.brandId) throw badRequest({ conversationId: "Name the conversation, or the brand for a new conversation." })
  const d = await db()
  let brandId: string
  let conversationId: string | null = null
  let locked = false
  if (q.conversationId) {
    // The shopper's scope: their own conversations only; anything else doesn't exist for them.
    const c = await d.query.conversations.findFirst({ where: (cv, { and, eq }) => and(eq(cv.id, q.conversationId!), eq(cv.customerId, actor.userId)) })
    if (!c) throw notFound()
    brandId = c.brandId
    conversationId = c.id
    locked = c.locked
  } else {
    const brand = await d.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, q.brandId!) })
    if (!brand) throw notFound()
    brandId = brand.id
  }
  const verdict = await shopperCanInteract(actor, { brandId, locked })
  if (!verdict.ok) throw verdict.error
  return { purpose: "inbox_attachment", ownerKind: "user", ownerId: actor.userId, brandId: null, conversationId, targetBrandId: conversationId ? null : brandId }
}

export async function authorizeBrandUpload(actor: BrandActor, q: Query): Promise<UploadTarget> {
  if (q.brandId) throw badRequest({ brandId: "Brand uploads always go to your active brand." })
  await assertNotRestricted("user", actor.userId, "uploads", "you")
  await assertNotRestricted("brand", actor.brandId, "uploads", "brand")
  const base = { ownerKind: "brand" as const, ownerId: actor.brandId, brandId: actor.brandId, targetBrandId: null }
  if (q.purpose === "inbox_attachment") {
    if (!q.conversationId) throw badRequest({ conversationId: "Brands attach photos to an existing conversation." })
    const d = await db()
    // Scoped to the ACTIVE brand: another brand's conversation is 404, whatever the user's other memberships.
    const c = await d.query.conversations.findFirst({ where: (cv, { and, eq }) => and(eq(cv.id, q.conversationId!), eq(cv.brandId, actor.brandId)) })
    if (!c) throw notFound()
    if (!canBrand(actor.role, "inbox.reply")) throw forbidden()
    const verdict = await brandCanInteract(actor, c)
    if (!verdict.ok) throw verdict.error
    return { ...base, purpose: "inbox_attachment", conversationId: c.id }
  }
  if (q.conversationId) throw badRequest({ conversationId: "Only inbox attachments belong to a conversation." })
  // Onboarding photos belong to the applicant (shopper scope); the brand gets them through the
  // ownership transfer at approval, never by uploading them itself.
  if (q.purpose === "onboarding_image") throw forbidden("Onboarding photos are uploaded by the applicant, not by a brand.")
  if (q.purpose === "social_post" && !canBrand(actor.role, "content.publish")) throw forbidden()
  if (q.purpose === "location_image" && !canBrand(actor.role, "locations.manage")) throw forbidden()
  assertBrandMayPublish(actor)
  return { ...base, purpose: q.purpose, conversationId: null }
}
