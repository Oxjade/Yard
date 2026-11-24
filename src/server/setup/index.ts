import "server-only"
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"
import type { BrandActor } from "../auth/dal"
import { db } from "../db"
import { brandLocations, brands, quickReplies, shippingProfiles, socialAccounts, socialPosts } from "../db/schema"
import { catalogImages, catalogProducts, catalogVariants, storefrontDrafts, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts } from "../db/schema/ledger"
import type { ListingFacts } from "@/lib/listing-guide"
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
  return { brandId, items, done: items.filter((i) => i.done).length, total: items.length, listing: await listingFacts(brandId) }
}

/**
 * "List your first product in 3 minutes" (src/lib/listing-guide.ts): a handful of bounded reads
 * per Overview visit (counts by status, the latest non-archived product with its photo and stock
 * totals, the brand's founding state and logo, the storefront draft and latest version for the
 * banner, and whether a payout account exists).
 */
export async function listingFacts(brandId: string): Promise<ListingFacts> {
  const d = await db()
  const [counts, latest, brand, payout, draft, version] = await Promise.all([
    d
      .select({ status: catalogProducts.status, n: sql<number>`count(*)::int` })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived")))
      .groupBy(catalogProducts.status),
    d
      .select({ id: catalogProducts.id, title: catalogProducts.title })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived")))
      .orderBy(desc(catalogProducts.updatedAt))
      .limit(1),
    d.select({ founding: brands.founding, launchedAt: brands.launchedAt, logo: brands.logoMediaId }).from(brands).where(eq(brands.id, brandId)).limit(1),
    d.select({ id: brandPayoutAccounts.brandId }).from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, brandId)).limit(1),
    d.select({ config: storefrontDrafts.config }).from(storefrontDrafts).where(eq(storefrontDrafts.brandId, brandId)).limit(1),
    d.select({ config: storefrontVersions.config }).from(storefrontVersions).where(eq(storefrontVersions.brandId, brandId)).orderBy(desc(storefrontVersions.version)).limit(1),
  ])
  const hasBanner = (c: unknown) => !!c && typeof c === "object" && !!((c as { coverMediaId?: unknown }).coverMediaId || (c as { coverPath?: unknown }).coverPath)
  let focus: ListingFacts["focus"] = null
  if (latest[0]) {
    const id = latest[0].id
    const [[images], [stock]] = await Promise.all([
      d.select({ n: sql<number>`count(*)::int` }).from(catalogImages).where(eq(catalogImages.productId, id)),
      d
        .select({ n: sql<number>`coalesce(sum(case when ${catalogVariants.trackStock} then ${catalogVariants.onHand} else 1 end), 0)::int` })
        .from(catalogVariants)
        .where(and(eq(catalogVariants.productId, id), inArray(catalogVariants.status, ["active"]))),
    ])
    focus = { id, title: latest[0].title, images: Number(images?.n ?? 0), stock: Number(stock?.n ?? 0) }
  }
  const by = new Map(counts.map((c) => [c.status, Number(c.n)]))
  return {
    products: counts.reduce((n, c) => n + Number(c.n), 0),
    live: (by.get("published") ?? 0) + (by.get("scheduled") ?? 0),
    focus,
    founding: !!brand[0]?.founding,
    launched: !!brand[0]?.launchedAt,
    payoutAccount: payout.length > 0,
    logo: !!brand[0]?.logo,
    banner: hasBanner(draft[0]?.config) || hasBanner(version[0]?.config),
    shopPublished: version.length > 0,
  }
}
