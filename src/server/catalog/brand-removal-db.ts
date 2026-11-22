import { and, eq, inArray, like, ne, notInArray, or, sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { brandLocations, locationEvents } from "../db/schema/around"
import { brandMembers, brands } from "../db/schema/brands"
import {
  brandOnboardings,
  catalogCollectionProducts,
  catalogCollections,
  catalogImages,
  catalogOptions,
  catalogProducts,
  catalogVariants,
  productProposals,
  stockHolds,
  stockMovements,
  storefrontDrafts,
  storefrontVersions,
} from "../db/schema/catalog"
import { chartEntries, chartEvents, chartFlags, shopperFollows, shopperReminders, shopperWishlist } from "../db/schema/charts"
import { backInStockRequests, dropClaims, dropEntries, dropItems, drops, productWatchState, searchBrands, searchProducts, studioPushPreferences } from "../db/schema/engagement"
import { authAppHandoffs, authOauthStates, brandInvites } from "../db/schema/identity"
import { catalogImportItems, catalogImports, catalogSitePieces, catalogWatches } from "../db/schema/imports"
import { blocks, conversations, quickReplies } from "../db/schema/inbox"
import { brandPayoutAccounts, ledgerAccounts, ledgerBrandSettings, ledgerEntries, ledgerOrderMoney, ledgerTransactions, payouts } from "../db/schema/ledger"
import { mediaAssets } from "../db/schema/media"
import { newsletterCampaigns } from "../db/schema/newsletter"
import { deliveryComplaints, orderRefs } from "../db/schema/orders"
import { orderDisputes, orderRefunds, orderReturns } from "../db/schema/orders-v3"
import { cartLines, transfers } from "../db/schema/payments"
import { oauthStates, sessions } from "../db/schema/people"
import { notifications } from "../db/schema/platform"
import { abuseAlerts, accountRestrictions, reports } from "../db/schema/safety"
import { shippingClosures, shippingMethods, shippingProfiles, shippingZones } from "../db/schema/shipping"
import { socialAccounts, socialPosts } from "../db/schema/social"

/**
 * Admin › Brands › Delete brand: the database half (docs in README › Deleting a brand). No
 * server-only, so the tests run these exact statements on PGlite with the migrations applied;
 * catalog/brand-removal.ts adds the permission, re-auth, audit and after-commit effects.
 *
 * Two outcomes, decided by planBrandRemoval from what the brand has on record:
 *  - "delete": nothing financial or legal points at the brand (no orders, refunds, returns,
 *    disputes, payouts, transfers, ledger money or payout account). eraseBrandRows removes the brand
 *    and everything that belongs only to it. User accounts stay; members only lose the membership.
 *  - "close": the money trail must survive. closeBrandRows makes the brand terminal (suspended +
 *    closed_at), archives its products, removes its members and its shopper-facing state, and keeps
 *    every row its orders, payouts and ledger reference, including the handle (order emails and
 *    receipts link to /brands/<handle>, so it is never handed to another brand).
 *
 * Both run inside the caller's transaction. Files are never touched here: eraseBrandRows returns
 * the storage paths, and the caller unlinks them after commit (like the media purge).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

export type BrandRemovalMode = "delete" | "close"

/** Financial and legal records: any of these closes the brand instead of erasing it. */
export type BrandRecords = {
  orders: number
  refunds: number
  returns: number
  disputes: number
  complaints: number
  payouts: number
  transfers: number
  ledgerEntries: number
  payoutAccounts: number
}

/** What the brand has that goes (delete) or is taken down (close). */
export type BrandFootprint = {
  products: number
  variants: number
  collections: number
  mediaFiles: number
  members: number
  invites: number
  imports: number
  watches: number
  suggestions: number
  newsletters: number
  notifications: number
  follows: number
  wishlist: number
  conversations: number
  posts: number
  places: number
  drops: number
  socialAccounts: number
  applications: number
}

export type BrandRemovalPlan = {
  brand: { id: string; handle: string; name: string; reviewStatus: string; founding: boolean; claimStatus: string; closedAt: string | null }
  mode: BrandRemovalMode
  /** One sentence for the confirmation: what happens and why ("has 3 orders, so it will be closed, not erased"). */
  why: string
  records: BrandRecords
  footprint: BrandFootprint
}

const n = (v: unknown) => Number(v ?? 0)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any table
const count = async (d: Db, table: any, where: SQL | undefined): Promise<number> => {
  const [row] = await d.select({ n: sql<number>`count(*)::int` }).from(table).where(where)
  return n(row?.n)
}

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** The records that make a brand closable only, in the order the sentence names them. */
const RECORD_WORDS: [keyof BrandRecords, string, string][] = [
  ["orders", "order", "orders"],
  ["refunds", "refund", "refunds"],
  ["returns", "return", "returns"],
  ["disputes", "dispute", "disputes"],
  ["complaints", "delivery complaint", "delivery complaints"],
  ["payouts", "payout", "payouts"],
  ["transfers", "transfer", "transfers"],
  ["ledgerEntries", "ledger entry", "ledger entries"],
  ["payoutAccounts", "payout account", "payout accounts"],
]

export function recordsLine(r: BrandRecords) {
  const parts = RECORD_WORDS.filter(([k]) => r[k] > 0).map(([k, one, many]) => plural(r[k], one, many))
  if (!parts.length) return null
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

export function modeOf(r: BrandRecords): BrandRemovalMode {
  return Object.values(r).some((v) => v > 0) ? "close" : "delete"
}

async function brandAccountIds(d: Db, brandId: string) {
  return (await d.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(and(eq(ledgerAccounts.ownerKind, "brand"), eq(ledgerAccounts.ownerId, brandId)))).map((r) => r.id)
}

export async function brandRecords(d: Db, brandId: string): Promise<BrandRecords> {
  const accounts = await brandAccountIds(d, brandId)
  // Every order has an order_ref (order_states, returns and refunds hang off it).
  const orders = await count(d, orderRefs, eq(orderRefs.brandId, brandId))
  const [ledgerTx, ledgerMoney, ledgerLines] = await Promise.all([
    count(d, ledgerTransactions, eq(ledgerTransactions.brandId, brandId)),
    count(d, ledgerOrderMoney, eq(ledgerOrderMoney.brandId, brandId)),
    accounts.length ? count(d, ledgerEntries, inArray(ledgerEntries.accountId, accounts)) : Promise.resolve(0),
  ])
  return {
    orders,
    refunds: await count(d, orderRefunds, eq(orderRefunds.brandId, brandId)),
    returns: await count(d, orderReturns, eq(orderReturns.brandId, brandId)),
    disputes: await count(d, orderDisputes, sql`${brandId} = any(${orderDisputes.brandIds})`),
    complaints: await count(d, deliveryComplaints, eq(deliveryComplaints.brandId, brandId)),
    payouts: await count(d, payouts, eq(payouts.brandId, brandId)),
    transfers: await count(d, transfers, eq(transfers.brandId, brandId)),
    ledgerEntries: Math.max(ledgerTx, ledgerMoney, ledgerLines),
    payoutAccounts: await count(d, brandPayoutAccounts, eq(brandPayoutAccounts.brandId, brandId)),
  }
}

async function idsOf(d: Db, q: Promise<{ id: string }[]>) {
  return (await q).map((r) => r.id)
}

/** Everything that belongs to the brand alone, by id (read before deleting, so the counts and files are known). */
async function collect(d: Db, brandId: string) {
  const productIds = await idsOf(d, d.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.brandId, brandId)))
  const variantIds = await idsOf(d, d.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.brandId, brandId)))
  const conversationIds = await idsOf(d, d.select({ id: conversations.id }).from(conversations).where(eq(conversations.brandId, brandId)))
  const socialAccountIds = await idsOf(d, d.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.brandId, brandId)))
  const dropIds = await idsOf(d, d.select({ id: drops.id }).from(drops).where(eq(drops.brandId, brandId)))
  const media = await d
    .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
    .from(mediaAssets)
    .where(
      or(
        eq(mediaAssets.brandId, brandId),
        eq(mediaAssets.targetBrandId, brandId),
        and(eq(mediaAssets.ownerKind, "brand"), eq(mediaAssets.ownerId, brandId)),
        conversationIds.length ? inArray(mediaAssets.conversationId, conversationIds) : undefined,
      ),
    )
  return { productIds, variantIds, conversationIds, socialAccountIds, dropIds, media }
}

/** Notifications that point at the brand: its own inbox, and anyone's that links to its pages. */
function notificationsOf(brandId: string, handle: string, productSlugs: string[], dropSlugs: string[]) {
  const base = `/brands/${handle}`
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
  return or(
    and(eq(notifications.recipientKind, "brand"), eq(notifications.recipientId, brandId)),
    eq(notifications.href, base),
    like(notifications.href, `${esc(base)}/%`),
    like(notifications.href, `${esc(base)}?%`),
    productSlugs.length ? inArray(notifications.href, productSlugs.map((s) => `/products/${s}`)) : undefined,
    dropSlugs.length ? inArray(notifications.href, dropSlugs.map((s) => `/drops/${s}`)) : undefined,
  )!
}

async function slugs(d: Db, brandId: string) {
  const productSlugs = (await d.select({ slug: catalogProducts.slug }).from(catalogProducts).where(eq(catalogProducts.brandId, brandId))).map((r) => r.slug)
  const dropSlugs = (await d.select({ slug: drops.slug }).from(drops).where(eq(drops.brandId, brandId))).map((r) => r.slug)
  return { productSlugs, dropSlugs }
}

export async function brandFootprint(d: Db, brandId: string, handle: string): Promise<BrandFootprint> {
  const c = await collect(d, brandId)
  const { productSlugs, dropSlugs } = await slugs(d, brandId)
  return {
    products: c.productIds.length,
    variants: c.variantIds.length,
    collections: await count(d, catalogCollections, eq(catalogCollections.brandId, brandId)),
    mediaFiles: c.media.length,
    members: await count(d, brandMembers, eq(brandMembers.brandId, brandId)),
    invites: await count(d, brandInvites, eq(brandInvites.brandId, brandId)),
    imports: await count(d, catalogImports, eq(catalogImports.brandId, brandId)),
    watches: await count(d, catalogWatches, eq(catalogWatches.brandId, brandId)),
    suggestions: await count(d, productProposals, eq(productProposals.brandId, brandId)),
    newsletters: await count(d, newsletterCampaigns, eq(newsletterCampaigns.audienceBrandId, brandId)),
    notifications: await count(d, notifications, notificationsOf(brandId, handle, productSlugs, dropSlugs)),
    follows: await count(d, shopperFollows, eq(shopperFollows.brandId, brandId)),
    wishlist: await count(d, shopperWishlist, eq(shopperWishlist.brandId, brandId)),
    conversations: c.conversationIds.length,
    posts: await count(d, socialPosts, eq(socialPosts.brandId, brandId)),
    places: await count(d, brandLocations, eq(brandLocations.brandId, brandId)),
    drops: c.dropIds.length,
    socialAccounts: c.socialAccountIds.length,
    applications: await count(d, brandOnboardings, eq(brandOnboardings.brandId, brandId)),
  }
}

export async function planBrandRemoval(d: Db, brandId: string): Promise<BrandRemovalPlan | null> {
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b) return null
  const records = await brandRecords(d, b.id)
  const footprint = await brandFootprint(d, b.id, b.handle)
  const mode = modeOf(records)
  const line = recordsLine(records)
  const why =
    mode === "close"
      ? `${b.name} has ${line}, so it will be closed, not erased: its order history, payouts and ledger stay on record.`
      : `${b.name} has no orders, payouts or other money on record, so it will be erased completely.`
  return {
    brand: { id: b.id, handle: b.handle, name: b.name, reviewStatus: b.reviewStatus, founding: b.founding, claimStatus: b.claimStatus, closedAt: b.closedAt?.toISOString() ?? null },
    mode,
    why,
    records,
    footprint,
  }
}

/** The FK columns that point at brands(id), as "table.column": the eraser handles every one of them (a test compares this to the live schema). */
export const BRAND_FK_COLUMNS = [
  "auth_app_handoffs.brand_id",
  "auth_oauth_states.brand_id",
  "brand_invites.brand_id",
  "brand_locations.brand_id",
  "brand_members.brand_id",
  "brand_payout_accounts.brand_id",
  "brands.id",
  "catalog_brand_onboardings.brand_id",
  "catalog_collections.brand_id",
  "catalog_import_items.brand_id",
  "catalog_imports.brand_id",
  "catalog_product_images.brand_id",
  "catalog_products.brand_id",
  "catalog_site_pieces.brand_id",
  "catalog_stock_movements.brand_id",
  "catalog_storefront_drafts.brand_id",
  "catalog_storefront_versions.brand_id",
  "catalog_variants.brand_id",
  "catalog_watches.brand_id",
  "chart_entries.brand_id",
  "chart_events.brand_id",
  "chart_flags.brand_id",
  "conversations.brand_id",
  "delivery_complaints.brand_id",
  "drops.brand_id",
  "ledger_brand_settings.brand_id",
  "ledger_order_money.brand_id",
  "location_events.brand_id",
  "media_assets.brand_id",
  "media_assets.target_brand_id",
  "newsletter_campaigns.audience_brand_id",
  "oauth_states.brand_id",
  "order_refs.brand_id",
  "order_refunds.brand_id",
  "order_returns.brand_id",
  "order_states.brand_id",
  "payouts.brand_id",
  "product_proposals.brand_id",
  "quick_replies.brand_id",
  "reports.brand_id",
  "search_brands.brand_id",
  "search_products.brand_id",
  "sessions.active_brand_id",
  "shipping_closures.brand_id",
  "shipping_methods.brand_id",
  "shipping_profiles.brand_id",
  "shipping_zones.brand_id",
  "shopper_follows.brand_id",
  "shopper_reminders.brand_id",
  "shopper_wishlist.brand_id",
  "social_accounts.brand_id",
  "social_posts.brand_id",
  "studio_push_preferences.brand_id",
  "transfers.brand_id",
] as const

export type EraseResult = {
  /** Rows removed per area (the audit meta). */
  removed: Record<string, number>
  /** Uploaded files to unlink once the transaction commits (sample /media/ paths are never included). */
  files: string[]
  /** Brand sessions removed (the caller announces session.ended after commit). */
  endedSessions: string[]
}

const gone = async (q: Promise<unknown[]>) => (await q).length

/**
 * Erases a brand that planBrandRemoval said may be deleted. Re-checks the records inside the
 * transaction (an order placed since the preview turns it into a close: the caller passes the mode
 * it showed and gets a 409). Every statement is scoped to the brand's own rows.
 */
export async function eraseBrandRows(d: Db, brandId: string): Promise<EraseResult> {
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId)).for("update").limit(1)
  if (!b) throw new Error("brand not found")
  if (modeOf(await brandRecords(d, brandId)) !== "delete") throw new Error("brand has financial records")
  const c = await collect(d, brandId)
  const { productSlugs, dropSlugs } = await slugs(d, brandId)
  const removed: Record<string, number> = {}
  const r = (k: string, v: number) => {
    if (v) removed[k] = (removed[k] ?? 0) + v
  }
  const P = c.productIds
  const V = c.variantIds

  // Shoppers' state about the brand and its pieces (their accounts stay).
  r("notifications", await gone(d.delete(notifications).where(notificationsOf(brandId, b.handle, productSlugs, dropSlugs)).returning({ id: notifications.id })))
  r("follows", await gone(d.delete(shopperFollows).where(eq(shopperFollows.brandId, brandId)).returning({ u: shopperFollows.userId })))
  r("wishlist", await gone(d.delete(shopperWishlist).where(eq(shopperWishlist.brandId, brandId)).returning({ u: shopperWishlist.userId })))
  r("reminders", await gone(d.delete(shopperReminders).where(eq(shopperReminders.brandId, brandId)).returning({ u: shopperReminders.userId })))
  if (V.length) r("cartLines", await gone(d.delete(cartLines).where(inArray(cartLines.variantId, V)).returning({ id: cartLines.id })))
  if (P.length) {
    r("backInStock", await gone(d.delete(backInStockRequests).where(inArray(backInStockRequests.productId, P)).returning({ id: backInStockRequests.id })))
    await d.delete(productWatchState).where(inArray(productWatchState.productId, P))
  }

  // Search, charts, Studio push.
  r("search", await gone(d.delete(searchProducts).where(eq(searchProducts.brandId, brandId)).returning({ id: searchProducts.productId })))
  await d.delete(searchBrands).where(eq(searchBrands.brandId, brandId))
  await d.delete(chartEntries).where(eq(chartEntries.brandId, brandId))
  await d.delete(chartEvents).where(eq(chartEvents.brandId, brandId))
  await d.delete(chartFlags).where(eq(chartFlags.brandId, brandId))
  await d.delete(studioPushPreferences).where(eq(studioPushPreferences.brandId, brandId))

  // Inbox: the brand's conversations (customer and Yard Support) with their messages and attachments.
  r("conversations", await gone(d.delete(conversations).where(eq(conversations.brandId, brandId)).returning({ id: conversations.id })))
  await d.delete(quickReplies).where(eq(quickReplies.brandId, brandId))
  await d.delete(blocks).where(or(and(eq(blocks.blockerKind, "brand"), eq(blocks.blockerId, brandId)), and(eq(blocks.blockedKind, "brand"), eq(blocks.blockedId, brandId))))
  // Moderation reports stay (Yard's own record, with their frozen evidence); they no longer link the brand.
  await d.update(reports).set({ brandId: null }).where(eq(reports.brandId, brandId))
  await d.delete(abuseAlerts).where(and(eq(abuseAlerts.subjectKind, "brand"), eq(abuseAlerts.subjectId, brandId)))
  await d.delete(accountRestrictions).where(and(eq(accountRestrictions.subjectKind, "brand"), eq(accountRestrictions.subjectId, brandId)))

  // Social: posts, then accounts (their tokens cascade; the caller disconnects through SOCIAL first so providers are told).
  r("posts", await gone(d.delete(socialPosts).where(eq(socialPosts.brandId, brandId)).returning({ id: socialPosts.id })))
  r("socialAccounts", await gone(d.delete(socialAccounts).where(eq(socialAccounts.brandId, brandId)).returning({ id: socialAccounts.id })))
  await d.delete(oauthStates).where(eq(oauthStates.brandId, brandId))

  // Shipping (the pickup location points at a place), then places and their events.
  await d.delete(shippingProfiles).where(eq(shippingProfiles.brandId, brandId))
  await d.delete(shippingMethods).where(eq(shippingMethods.brandId, brandId))
  await d.delete(shippingZones).where(eq(shippingZones.brandId, brandId))
  await d.delete(shippingClosures).where(eq(shippingClosures.brandId, brandId))
  await d.delete(locationEvents).where(eq(locationEvents.brandId, brandId))
  r("places", await gone(d.delete(brandLocations).where(eq(brandLocations.brandId, brandId)).returning({ id: brandLocations.id })))

  // Drops (items, entries and claims go with them).
  if (c.dropIds.length) {
    await d.delete(dropItems).where(inArray(dropItems.dropId, c.dropIds))
    await d.delete(dropEntries).where(inArray(dropEntries.dropId, c.dropIds))
    await d.delete(dropClaims).where(inArray(dropClaims.dropId, c.dropIds))
  }
  r("drops", await gone(d.delete(drops).where(eq(drops.brandId, brandId)).returning({ id: drops.id })))

  // Imports, website watch and Yard's suggestions (pieces and items point at suggestions and products).
  await d.delete(catalogSitePieces).where(eq(catalogSitePieces.brandId, brandId))
  await d.delete(catalogImportItems).where(eq(catalogImportItems.brandId, brandId))
  r("imports", await gone(d.delete(catalogImports).where(eq(catalogImports.brandId, brandId)).returning({ id: catalogImports.id })))
  r("watches", await gone(d.delete(catalogWatches).where(eq(catalogWatches.brandId, brandId)).returning({ id: catalogWatches.brandId })))
  r("suggestions", await gone(d.delete(productProposals).where(eq(productProposals.brandId, brandId)).returning({ id: productProposals.id })))

  // Catalogue: collections, then products (options, variants, stock, holds and photos cascade; spelled out for clarity).
  await d.delete(catalogCollectionProducts).where(inArray(catalogCollectionProducts.collectionId, d.select({ id: catalogCollections.id }).from(catalogCollections).where(eq(catalogCollections.brandId, brandId))))
  r("collections", await gone(d.delete(catalogCollections).where(eq(catalogCollections.brandId, brandId)).returning({ id: catalogCollections.id })))
  if (V.length) {
    await d.delete(stockHolds).where(inArray(stockHolds.variantId, V))
    await d.delete(stockMovements).where(inArray(stockMovements.variantId, V))
  }
  if (P.length) {
    await d.delete(catalogImages).where(inArray(catalogImages.productId, P))
    await d.delete(catalogOptions).where(inArray(catalogOptions.productId, P))
  }
  r("variants", await gone(d.delete(catalogVariants).where(eq(catalogVariants.brandId, brandId)).returning({ id: catalogVariants.id })))
  r("products", await gone(d.delete(catalogProducts).where(eq(catalogProducts.brandId, brandId)).returning({ id: catalogProducts.id })))
  await d.delete(storefrontDrafts).where(eq(storefrontDrafts.brandId, brandId))
  r("storefrontVersions", await gone(d.delete(storefrontVersions).where(eq(storefrontVersions.brandId, brandId)).returning({ id: storefrontVersions.id })))

  // The application, newsletters to its followers, team and access.
  r("applications", await gone(d.delete(brandOnboardings).where(eq(brandOnboardings.brandId, brandId)).returning({ id: brandOnboardings.id })))
  r("newsletters", await gone(d.delete(newsletterCampaigns).where(eq(newsletterCampaigns.audienceBrandId, brandId)).returning({ id: newsletterCampaigns.id })))
  r("invites", await gone(d.delete(brandInvites).where(eq(brandInvites.brandId, brandId)).returning({ id: brandInvites.id })))
  await d.delete(authOauthStates).where(eq(authOauthStates.brandId, brandId))
  await d.delete(authAppHandoffs).where(eq(authAppHandoffs.brandId, brandId))
  const ended = await d.delete(sessions).where(and(eq(sessions.activeBrandId, brandId), eq(sessions.actor, "brand"))).returning({ id: sessions.id })
  await d.update(sessions).set({ activeBrandId: null }).where(eq(sessions.activeBrandId, brandId))
  r("members", await gone(d.delete(brandMembers).where(eq(brandMembers.brandId, brandId)).returning({ id: brandMembers.id })))
  await d.delete(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, brandId))
  // Brand ledger accounts with no entries (modeOf already refused any with entries).
  await d.delete(ledgerAccounts).where(and(eq(ledgerAccounts.ownerKind, "brand"), eq(ledgerAccounts.ownerId, brandId)))

  // Media rows last (photos, posts, places, covers, attachments all released above), then the brand.
  if (c.media.length) {
    r(
      "mediaFiles",
      await gone(
        d
          .delete(mediaAssets)
          .where(inArray(mediaAssets.id, c.media.map((m) => m.id)))
          .returning({ id: mediaAssets.id }),
      ),
    )
  }
  await d.delete(brands).where(eq(brands.id, brandId))
  // Uploaded files only (never a sample /media/ path), and only those no remaining row still points at.
  const paths = [...new Set(c.media.map((m) => m.storagePath).filter((p) => !p.startsWith("/media/")))]
  const shared = paths.length ? new Set((await d.select({ p: mediaAssets.storagePath }).from(mediaAssets).where(inArray(mediaAssets.storagePath, paths))).map((x) => x.p)) : new Set<string>()
  return { removed, files: paths.filter((p) => !shared.has(p)), endedSessions: ended.map((s) => s.id) }
}

export type CloseResult = { removed: Record<string, number>; endedSessions: string[]; productIds: string[] }

/**
 * Closes a brand with financial records: terminal status, nothing public, no team, and every row
 * an order, payout, refund or ledger entry references kept (the products and variants too, as
 * archived rows: order lines and stock movements point at them).
 */
export async function closeBrandRows(d: Db, brandId: string, by: { userId: string; now?: Date }): Promise<CloseResult> {
  const now = by.now ?? new Date()
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId)).for("update").limit(1)
  if (!b) throw new Error("brand not found")
  const c = await collect(d, brandId)
  const { productSlugs, dropSlugs } = await slugs(d, brandId)
  const removed: Record<string, number> = {}
  const r = (k: string, v: number) => {
    if (v) removed[k] = (removed[k] ?? 0) + v
  }
  // Suspended keeps it out of every public read, search, chart and sign-in that already checks status; closed_at makes it final.
  await d.update(brands).set({ reviewStatus: "suspended", verified: false, closedAt: now, closedBy: by.userId, nudgeEmails: false }).where(eq(brands.id, brandId))
  r("productsUnpublished", await gone(d.update(catalogProducts).set({ status: "archived", publishAt: null, updatedAt: now, version: sql`${catalogProducts.version} + 1` }).where(and(eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived"))).returning({ id: catalogProducts.id })))
  await d.update(catalogCollections).set({ status: "draft", updatedAt: now }).where(eq(catalogCollections.brandId, brandId))
  r("dropsCancelled", await gone(d.update(drops).set({ status: "cancelled" }).where(and(eq(drops.brandId, brandId), notInArray(drops.status, ["ended", "cancelled"]))).returning({ id: drops.id })))
  await d.update(searchProducts).set({ visible: false }).where(eq(searchProducts.brandId, brandId))
  await d.update(searchBrands).set({ visible: false }).where(eq(searchBrands.brandId, brandId))

  // Shoppers' state that only made sense while the brand sold (orders and their messages stay).
  r("notifications", await gone(d.delete(notifications).where(and(notificationsOf(brandId, b.handle, productSlugs, dropSlugs), ne(notifications.recipientKind, "brand"))).returning({ id: notifications.id })))
  r("follows", await gone(d.delete(shopperFollows).where(eq(shopperFollows.brandId, brandId)).returning({ u: shopperFollows.userId })))
  r("wishlist", await gone(d.delete(shopperWishlist).where(eq(shopperWishlist.brandId, brandId)).returning({ u: shopperWishlist.userId })))
  r("reminders", await gone(d.delete(shopperReminders).where(eq(shopperReminders.brandId, brandId)).returning({ u: shopperReminders.userId })))
  if (c.variantIds.length) r("cartLines", await gone(d.delete(cartLines).where(inArray(cartLines.variantId, c.variantIds)).returning({ id: cartLines.id })))
  if (c.productIds.length) r("backInStock", await gone(d.delete(backInStockRequests).where(inArray(backInStockRequests.productId, c.productIds)).returning({ id: backInStockRequests.id })))

  // Team and access: members go, their brand sessions end, pending invites and claim links stop working.
  const ended = await d.delete(sessions).where(and(eq(sessions.activeBrandId, brandId), eq(sessions.actor, "brand"))).returning({ id: sessions.id })
  r("members", await gone(d.delete(brandMembers).where(eq(brandMembers.brandId, brandId)).returning({ id: brandMembers.id })))
  r("invitesRevoked", await gone(d.update(brandInvites).set({ status: "revoked", revokedAt: now, revokedBy: by.userId }).where(and(eq(brandInvites.brandId, brandId), eq(brandInvites.status, "pending"))).returning({ id: brandInvites.id })))
  await d.delete(studioPushPreferences).where(eq(studioPushPreferences.brandId, brandId))
  await d.delete(authAppHandoffs).where(eq(authAppHandoffs.brandId, brandId))
  // Social access ends: the caller disconnects through SOCIAL first (tokens deleted, providers told
  // after commit); this marks any account left. Website watch and Yard's open suggestions stop.
  await d.update(socialAccounts).set({ status: "disconnected" }).where(eq(socialAccounts.brandId, brandId))
  r("watchesPaused", await gone(d.update(catalogWatches).set({ status: "paused", enabled: false }).where(eq(catalogWatches.brandId, brandId)).returning({ id: catalogWatches.brandId })))
  r("suggestionsWithdrawn", await gone(d.update(productProposals).set({ status: "withdrawn", updatedAt: now }).where(and(eq(productProposals.brandId, brandId), eq(productProposals.status, "pending"))).returning({ id: productProposals.id })))
  return { removed, endedSessions: ended.map((s) => s.id), productIds: c.productIds }
}

/** True once a brand is closed (terminal): status changes, founding actions and reinstatement refuse it. */
export const isClosed = (b: { closedAt: Date | null } | null | undefined) => !!b?.closedAt

/**
 * Unlinks erased files once the erase committed (the media purge's rule: a file that's already
 * gone counts as removed). `resolve` maps a storage path under the uploads root to a file (null
 * refuses a path that escapes it). Returns how many files were removed.
 */
export async function unlinkFiles(paths: string[], resolve: (storagePath: string) => string | null, onError?: (path: string, e: unknown) => void) {
  const { unlink } = await import("node:fs/promises")
  let removed = 0
  for (const p of paths) {
    const file = resolve(p)
    if (!file) continue
    try {
      await unlink(file)
      removed++
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") removed++
      else onError?.(p, e)
    }
  }
  return removed
}
