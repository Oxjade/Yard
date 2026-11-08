import "server-only"
import { and, eq, isNotNull, ne } from "drizzle-orm"
import type { BrandActor } from "../auth/dal"
import { db } from "../db"
import { brandLocations, quickReplies, shippingProfiles, socialAccounts, socialPosts } from "../db/schema"
import { SETUP_ITEMS, type SetupItemKey, type SetupStatusDto } from "@/components/studio/setup/contract"

/**
 * The Studio Overview's "Set up the new features" card (§7.4): an item is ticked only when the
 * server says it's done, for the session's active brand.
 * - shipping: a member has saved the shipping profile (`shipping_profiles.updated_by` is set;
 *   seeded profiles have none);
 * - social: an Instagram or TikTok account whose status is `connected` (one that needs
 *   reconnecting or is in error doesn't count: the sidebar's Social badge asks the brand to
 *   reconnect it), or any post uploaded to Yard that Yard hasn't removed;
 * - locations: any place, draft or published;
 * - quick_replies: any saved quick reply.
 */
export async function setupStatus(actor: BrandActor): Promise<SetupStatusDto> {
  const d = await db()
  const brandId = actor.brandId
  const [shipping, account, upload, place, reply] = await Promise.all([
    d.select({ id: shippingProfiles.brandId }).from(shippingProfiles).where(and(eq(shippingProfiles.brandId, brandId), isNotNull(shippingProfiles.updatedBy))).limit(1),
    d.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.status, "connected"))).limit(1),
    d.select({ id: socialPosts.id }).from(socialPosts).where(and(eq(socialPosts.brandId, brandId), eq(socialPosts.source, "upload"), ne(socialPosts.moderationStatus, "removed"))).limit(1),
    d.select({ id: brandLocations.id }).from(brandLocations).where(eq(brandLocations.brandId, brandId)).limit(1),
    d.select({ id: quickReplies.id }).from(quickReplies).where(eq(quickReplies.brandId, brandId)).limit(1),
  ])
  const done: Record<SetupItemKey, boolean> = {
    shipping: shipping.length > 0,
    social: account.length > 0 || upload.length > 0,
    locations: place.length > 0,
    quick_replies: reply.length > 0,
  }
  const items = SETUP_ITEMS.map((key) => ({ key, done: done[key] }))
  return { brandId, items, done: items.filter((i) => i.done).length, total: items.length }
}
