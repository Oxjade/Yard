import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { adminRolePermissions, canAdmin, needsRole } from "../../lib/permissions"
import { brandRemovalBody } from "../../lib/api/contracts/brand-removal"
import { brandLocations, locationEvents } from "../db/schema/around"
import { brandMembers, brands } from "../db/schema/brands"
import { brandOnboardings, catalogCategories, catalogCollectionProducts, catalogCollections, catalogImages, catalogOptions, catalogProducts, catalogVariants, productProposals, stockMovements, storefrontDrafts, storefrontVersions } from "../db/schema/catalog"
import { chartEvents, shopperFollows, shopperWishlist } from "../db/schema/charts"
import { backInStockRequests, dropItems, drops, searchBrands, searchProducts } from "../db/schema/engagement"
import { brandInvites } from "../db/schema/identity"
import { catalogImports, catalogSitePieces, catalogWatches } from "../db/schema/imports"
import { conversations, messageAttachments, messages } from "../db/schema/inbox"
import { mediaAssets } from "../db/schema/media"
import { newsletterCampaigns } from "../db/schema/newsletter"
import { orderGroups, orderRefs } from "../db/schema/orders"
import { cartLines, carts } from "../db/schema/payments"
import { sessions, users } from "../db/schema/people"
import { auditLog, notifications } from "../db/schema/platform"
import { reports } from "../db/schema/safety"
import { shippingMethods, shippingZones } from "../db/schema/shipping"
import { socialAccounts, socialPosts } from "../db/schema/social"
import { BRAND_FK_COLUMNS, closeBrandRows, eraseBrandRows, modeOf, planBrandRemoval, recordsLine, unlinkFiles, type Db } from "./brand-removal-db"

/* Admin › Brands › Delete brand (catalog/brand-removal-db.ts) on a real (in-memory) database with
 * every migration applied and foreign keys ON: a brand with no orders is erased with everything
 * that belongs only to it (files included) while another brand and the shoppers stay; a brand with
 * orders is closed, and its orders stay readable. */

const T0 = new Date("2026-11-20T10:00:00Z")
const LATER = new Date("2027-11-20T10:00:00Z")

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db
let uploads: string

async function user(id: string, kind: "shopper" | "brand_staff" | "admin" = "shopper") {
  await d.insert(users).values({ id, kind, name: id, email: `${id}@example.test`, demo: false })
}

/** A brand with a row in (nearly) every area that can hold brand data. */
async function seedBrand(key: string, opts: { file?: boolean } = {}) {
  const id = `b_${key}`
  const owner = `u_${key}_owner`
  const shopper = `u_${key}_shopper`
  await user(owner, "brand_staff")
  await user(shopper)
  await d.insert(brands).values({ id, handle: `${key}-brand`, name: `${key} Brand`, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true, joinedAt: "2026-11-01" })
  await d.insert(brandMembers).values({ id: `bm_${key}`, brandId: id, userId: owner, role: "owner" })
  await d.insert(sessions).values({ id: `s_${key}_brand`, tokenHash: `th_${key}_b`, userId: owner, actor: "brand", activeBrandId: id, idleExpiresAt: LATER, absoluteExpiresAt: LATER })
  await d.insert(sessions).values({ id: `s_${key}_shop`, tokenHash: `th_${key}_s`, userId: shopper, actor: "shopper", idleExpiresAt: LATER, absoluteExpiresAt: LATER })
  // Media: a product photo (a real file when asked), a sample-path row, an inbox attachment.
  const rel = `${key}/photo.png`
  if (opts.file) {
    const abs = path.join(uploads, rel)
    await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(abs), { recursive: true }))
    writeFileSync(abs, "png")
  }
  const media = (mid: string, over: Partial<typeof mediaAssets.$inferInsert> = {}) => ({ id: mid, ownerKind: "brand", ownerId: id, brandId: id, purpose: "storefront_cover", mime: "image/png", ext: "png", bytes: 3, sha256: "0".repeat(64), storagePath: rel, source: "upload", ...over })
  await d.insert(mediaAssets).values(media(`med_${key}_1`))
  await d.insert(mediaAssets).values(media(`med_${key}_2`, { storagePath: "/media/sample.jpg", source: "seed", purpose: "sample" }))
  // Catalogue.
  const p = `p_${key}`
  const v = `pv_${key}`
  await d.insert(catalogProducts).values({ id: p, brandId: id, slug: `${key}-hoodie`, title: "Hoodie", categorySlug: "streetwear", priceMinor: 45000, currency: "NGN", status: "published", publishedAt: T0 })
  await d.insert(catalogOptions).values({ id: `po_${key}`, productId: p, name: "Size", values: [{ value: "M" }] })
  await d.insert(catalogVariants).values({ id: v, productId: p, brandId: id, sku: `${key}-M`, options: { Size: "M" }, onHand: 3 })
  await d.insert(stockMovements).values({ id: `sm_${key}`, variantId: v, brandId: id, delta: 3, onHandAfter: 3, reason: "seed" })
  await d.insert(catalogImages).values({ id: `pi_${key}`, productId: p, brandId: id, mediaId: `med_${key}_1` })
  await d.insert(catalogCollections).values({ id: `col_${key}`, brandId: id, handle: "all", name: "All", imageMediaId: `med_${key}_1` })
  await d.insert(catalogCollectionProducts).values({ collectionId: `col_${key}`, productId: p })
  await d.insert(storefrontDrafts).values({ brandId: id, config: { coverMediaId: `med_${key}_1` } })
  await d.insert(storefrontVersions).values({ id: `sv_${key}`, brandId: id, version: 1, config: {} })
  await d.insert(brandOnboardings).values({ id: `onb_${key}`, userId: owner, status: "approved", brandId: id })
  await d.insert(productProposals).values({ id: `pp_${key}`, brandId: id, productId: p, kind: "edit", payload: {}, createdByAdminId: owner })
  await d.insert(catalogImports).values({ id: `imp_${key}`, brandId: id, sourceUrl: `https://${key}.example`, platform: "shopify", status: "done", consentAt: T0, createdBy: owner })
  await d.insert(catalogWatches).values({ brandId: id, sourceUrl: `https://${key}.example`, platform: "shopify", nextScanAt: T0 })
  await d.insert(catalogSitePieces).values({ id: `sp_${key}`, brandId: id, urlKey: `x/${key}`, sourceUrl: `https://${key}.example/p`, title: "Tee", status: "waiting", origin: "watch", product: {}, firstSeenAt: T0, lastSeenAt: T0, updatedAt: T0, productId: p })
  await d.insert(brandInvites).values({ id: `inv_${key}`, brandId: id, email: `new-${key}@example.test`, role: "designer", tokenHash: `tok_${key}`, invitedBy: owner, expiresAt: LATER })
  // Shoppers' state.
  await d.insert(shopperFollows).values({ userId: shopper, brandId: id })
  await d.insert(shopperWishlist).values({ userId: shopper, productId: p, brandId: id })
  await d.insert(backInStockRequests).values({ id: `bis_${key}`, userId: shopper, productId: p, variantId: v })
  await d.insert(carts).values({ id: `cart_${key}`, customerId: shopper })
  await d.insert(cartLines).values({ id: `cl_${key}`, cartId: `cart_${key}`, variantId: v, qty: 1 })
  await d.insert(notifications).values({ id: `n_${key}_1`, recipientKind: "brand", recipientId: id, eventKey: "k1", category: "orders", title: "t", body: "b" })
  await d.insert(notifications).values({ id: `n_${key}_2`, recipientKind: "shopper", recipientId: shopper, eventKey: "k2", category: "drops", title: "t", body: "b", href: `/brands/${key}-brand` })
  await d.insert(notifications).values({ id: `n_${key}_3`, recipientKind: "shopper", recipientId: shopper, eventKey: "k3", category: "drops", title: "t", body: "b", href: `/products/${key}-hoodie` })
  // Inbox with an attachment.
  await d.insert(conversations).values({ id: `cv_${key}`, brandId: id, customerId: shopper, origin: "storefront" })
  await d.insert(messages).values({ id: `msg_${key}`, conversationId: `cv_${key}`, senderSide: "customer", senderUserId: shopper, kind: "image", clientId: `c_${key}` })
  await d.insert(mediaAssets).values(media(`med_${key}_3`, { ownerKind: "user", ownerId: shopper, brandId: null, conversationId: `cv_${key}`, purpose: "inbox_attachment", storagePath: `${key}/attachment.png` }))
  await d.insert(messageAttachments).values({ id: `ma_${key}`, messageId: `msg_${key}`, mediaId: `med_${key}_3`, position: 0 })
  await d.insert(reports).values({ id: `rep_${key}`, subjectType: "conversation", subjectId: `cv_${key}`, brandId: id, reporterKind: "shopper", reporterId: shopper, reason: "spam", snapshot: {} })
  // Social, Around, shipping, drops, search, charts, newsletter.
  await d.insert(socialAccounts).values({ id: `sa_${key}`, brandId: id, provider: "instagram", mode: "sandbox", externalUserId: `ext_${key}`, handle: key, status: "connected", connectedBy: owner })
  await d.execute(sql`insert into social_tokens (account_id, access_token_enc) values (${`sa_${key}`}, 'sealed')`)
  await d.insert(socialPosts).values({ id: `post_${key}`, brandId: id, accountId: `sa_${key}`, source: "upload", kind: "image", media: [{ mediaId: `med_${key}_1`, src: "/x.png", alt: "", width: 1, height: 1, kind: "image" }], postedAt: T0 })
  await d.insert(brandLocations).values({ id: `loc_${key}`, brandId: id, kind: "store", name: "Shop", addressLine: "1 Road", city: "Lagos", citySlug: "lagos", country: "NG", lat: 6.5, lng: 3.4, timeZone: "Africa/Lagos", createdBy: owner })
  await d.insert(locationEvents).values({ id: `le_${key}`, brandId: id, locationId: `loc_${key}`, kind: "talk", title: "Talk", startsAt: T0, endsAt: LATER, createdBy: owner })
  await d.insert(shippingZones).values({ id: `sz_${key}`, brandId: id, name: "Home", kind: "domestic", countries: ["NG"] })
  await d.insert(shippingMethods).values({ id: `smth_${key}`, zoneId: `sz_${key}`, brandId: id, label: "Standard", service: "standard", transitMin: 1, transitMax: 3 })
  await d.insert(drops).values({ id: `drop_${key}`, brandId: id, slug: `${key}-drop`, name: "Drop", access: "first_come", status: "scheduled", startsAt: T0, endsAt: LATER })
  await d.insert(dropItems).values({ dropId: `drop_${key}`, productId: p, variantId: v })
  await d.insert(searchProducts).values({ productId: p, brandId: id, slug: `${key}-hoodie`, title: "Hoodie", brandHandle: `${key}-brand`, brandName: `${key} Brand`, category: "streetwear", currency: "NGN", priceMinor: 45000, priceUsdMinor: 3000, visible: true })
  await d.insert(searchBrands).values({ brandId: id, handle: `${key}-brand`, name: `${key} Brand`, city: "Lagos", country: "NG", visible: true })
  await d.insert(chartEvents).values({ brandId: id, productId: p, kind: "product_view", actorKind: "shopper", actorId: shopper, day: "2026-11-20" })
  await d.insert(newsletterCampaigns).values({ id: `nl_${key}`, subject: "News", audience: "followers", audienceBrandId: id, createdBy: owner })
  return { id, owner, shopper, product: p, variant: v, file: path.join(uploads, rel) }
}

before(async () => {
  uploads = mkdtempSync(path.join(tmpdir(), "yard-brand-removal-"))
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })
})
after(async () => {
  await pg?.close()
  rmSync(uploads, { recursive: true, force: true })
})

/** social_tokens is SOCIAL's own table (no import outside src/server/social): counted with plain SQL. */
async function tokens(accountId: string) {
  const r = (await d.execute(sql`select count(*)::int as n from social_tokens where account_id = ${accountId}`)) as unknown as { rows: { n: number }[] }
  return r.rows[0].n
}

/** Rows in every brand-keyed column for this brand id. */
async function brandRows(id: string) {
  const out: Record<string, number> = {}
  for (const col of BRAND_FK_COLUMNS) {
    const [table, column] = col.split(".")
    const r = (await d.execute(sql.raw(`select count(*)::int as n from "${table}" where "${column}" = '${id.replace(/'/g, "''")}'`))) as unknown as { rows: { n: number }[] }
    if (r.rows[0].n) out[col] = r.rows[0].n
  }
  return out
}

describe("the eraser covers the schema", () => {
  it("handles every foreign key that points at brands", async () => {
    const r = (await d.execute(
      sql`select tc.table_name || '.' || kcu.column_name as col from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
          join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
          where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'brands' and ccu.column_name = 'id'`,
    )) as unknown as { rows: { col: string }[] }
    const live = [...new Set(r.rows.map((x) => x.col))].sort()
    // A new table with a brand_id must be added to brand-removal-db.ts (erase and close) and to this list.
    assert.deepEqual(live, BRAND_FK_COLUMNS.filter((c) => c !== "brands.id").sort())
  })
})

describe("delete: a brand with no orders", () => {
  it("is planned as a delete, with what goes", async () => {
    const a = await seedBrand("del", { file: true })
    const plan = await planBrandRemoval(db(), a.id)
    assert.ok(plan)
    assert.equal(plan.mode, "delete")
    assert.match(plan.why, /no orders, payouts or other money on record/)
    assert.equal(plan.footprint.products, 1)
    assert.equal(plan.footprint.members, 1)
    assert.equal(plan.footprint.mediaFiles, 3)
    assert.equal(plan.footprint.notifications, 3)
  })

  it("is fully gone, files included, while the other brand, the accounts and Yard's records stay", async () => {
    const a = { id: "b_del", file: path.join(uploads, "del/photo.png") }
    const other = await seedBrand("keep", { file: true })
    const before = await brandRows(other.id)
    assert.ok(existsSync(a.file))
    const r = await d.transaction(async (tx) => eraseBrandRows(tx as unknown as Db, a.id))
    assert.deepEqual(await brandRows(a.id), {})
    assert.equal(r.removed.products, 1)
    assert.equal(r.removed.members, 1)
    assert.equal(r.removed.mediaFiles, 3)
    assert.equal(r.removed.notifications, 3)
    assert.deepEqual(r.endedSessions, ["s_del_brand"])
    // Only uploads go to disk cleanup, never a sample /media/ path; files go after commit.
    assert.deepEqual([...r.files].sort(), ["del/attachment.png", "del/photo.png"])
    assert.ok(existsSync(a.file))
    // A file that's already gone (the attachment never reached disk here) counts as removed, like the media purge.
    assert.equal(await unlinkFiles(r.files, (p) => path.join(uploads, p)), 2)
    assert.equal(existsSync(a.file), false)
    // Nothing that referenced the brand's products or conversations is left behind.
    assert.equal((await d.select().from(mediaAssets).where(eq(mediaAssets.id, "med_del_3"))).length, 0)
    assert.equal((await d.select().from(messages).where(eq(messages.id, "msg_del"))).length, 0)
    assert.equal((await d.select().from(cartLines).where(eq(cartLines.variantId, "pv_del"))).length, 0)
    assert.equal(await tokens("sa_del"), 0)
    assert.equal((await d.select().from(notifications).where(eq(notifications.recipientId, "u_del_shopper"))).length, 0)
    // Accounts stay (the member only lost the membership; the shopper keeps their session).
    assert.equal((await d.select().from(users).where(eq(users.id, "u_del_owner"))).length, 1)
    assert.equal((await d.select().from(sessions).where(eq(sessions.id, "s_del_shop"))).length, 1)
    // The moderation report stays as Yard's record, unlinked from the erased brand.
    const [rep] = await d.select().from(reports).where(eq(reports.id, "rep_del"))
    assert.equal(rep.brandId, null)
    // The other brand is untouched.
    assert.deepEqual(await brandRows(other.id), before)
    assert.ok(existsSync(other.file))
  })

  it("frees the handle for a new brand", async () => {
    await d.insert(brands).values({ id: "b_new", handle: "del-brand", name: "New", city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: [], followersBase: 0, timeZone: "Africa/Lagos" })
    await d.delete(brands).where(eq(brands.id, "b_new"))
  })

  it("refuses to erase a brand that has an order (the transaction rolls back)", async () => {
    const c = await seedBrand("race")
    await d.insert(orderGroups).values({ id: "og_race", customerId: c.shopper, reference: "YRD-RACE" })
    await d.insert(orderRefs).values({ id: "or_race", groupId: "og_race", reference: "YRD-RACE-1", brandId: c.id, customerId: c.shopper, placedAt: T0, status: "processing", currency: "NGN", subtotalMinor: 45000, shippingMinor: 0, totalMinor: 45000, items: [], shipToCountry: "NG", source: "browser" })
    await assert.rejects(d.transaction(async (tx) => eraseBrandRows(tx as unknown as Db, c.id)), /financial records/)
    assert.equal((await d.select().from(brands).where(eq(brands.id, c.id))).length, 1)
    assert.equal((await d.select().from(catalogProducts).where(eq(catalogProducts.brandId, c.id))).length, 1)
  })
})

describe("close: a brand with orders", () => {
  it("is planned as a close, and says why", async () => {
    const plan = await planBrandRemoval(db(), "b_race")
    assert.ok(plan)
    assert.equal(plan.mode, "close")
    assert.equal(plan.records.orders, 1)
    assert.equal(plan.why, "race Brand has 1 order, so it will be closed, not erased: its order history, payouts and ledger stay on record.")
  })

  it("is closed: terminal status, nothing public, no team, and the orders still readable", async () => {
    const r = await d.transaction(async (tx) => closeBrandRows(tx as unknown as Db, "b_race", { userId: "u_race_owner", now: T0 }))
    const [b] = await d.select().from(brands).where(eq(brands.id, "b_race"))
    assert.equal(b.reviewStatus, "suspended")
    assert.equal(b.verified, false)
    assert.equal(b.closedAt?.toISOString(), T0.toISOString())
    assert.equal(b.handle, "race-brand", "the handle stays with the closed brand (order emails link to it)")
    // Every product unpublished (archived), never deleted: order lines and stock movements point at them.
    const products = await d.select().from(catalogProducts).where(eq(catalogProducts.brandId, "b_race"))
    assert.deepEqual(products.map((p) => p.status), ["archived"])
    assert.equal((await d.select().from(catalogVariants).where(eq(catalogVariants.brandId, "b_race"))).length, 1)
    assert.equal(r.removed.productsUnpublished, 1)
    assert.equal(r.removed.members, 1)
    assert.deepEqual(r.endedSessions, ["s_race_brand"])
    assert.equal((await d.select().from(brandMembers).where(eq(brandMembers.brandId, "b_race"))).length, 0)
    assert.equal((await d.select().from(users).where(eq(users.id, "u_race_owner"))).length, 1)
    const [invite] = await d.select().from(brandInvites).where(eq(brandInvites.brandId, "b_race"))
    assert.equal(invite.status, "revoked")
    // Hidden from search; drops cancelled; follows, wishlist and carts cleared; social tokens gone.
    assert.deepEqual((await d.select({ v: searchProducts.visible }).from(searchProducts).where(eq(searchProducts.brandId, "b_race"))).map((x) => x.v), [false])
    assert.deepEqual((await d.select({ v: searchBrands.visible }).from(searchBrands).where(eq(searchBrands.brandId, "b_race"))).map((x) => x.v), [false])
    assert.deepEqual((await d.select({ s: drops.status }).from(drops).where(eq(drops.brandId, "b_race"))).map((x) => x.s), ["cancelled"])
    assert.equal((await d.select().from(shopperFollows).where(eq(shopperFollows.brandId, "b_race"))).length, 0)
    assert.equal((await d.select().from(shopperWishlist).where(eq(shopperWishlist.brandId, "b_race"))).length, 0)
    assert.equal((await d.select().from(cartLines).where(eq(cartLines.variantId, "pv_race"))).length, 0)
    assert.deepEqual((await d.select({ s: socialAccounts.status }).from(socialAccounts).where(eq(socialAccounts.brandId, "b_race"))).map((x) => x.s), ["disconnected"])
    assert.equal((await d.select().from(productProposals).where(and(eq(productProposals.brandId, "b_race"), eq(productProposals.status, "pending")))).length, 0)
    assert.equal((await d.select().from(catalogWatches).where(eq(catalogWatches.brandId, "b_race")))[0].enabled, false)
    // The order, with its brand, is still there for the shopper's and Yard's order pages.
    const [order] = await d.select({ id: orderRefs.id, brand: brands.name, customer: orderRefs.customerId }).from(orderRefs).innerJoin(brands, eq(brands.id, orderRefs.brandId)).where(eq(orderRefs.id, "or_race"))
    assert.deepEqual(order, { id: "or_race", brand: "race Brand", customer: "u_race_shopper" })
    // Its conversation with the shopper stays too (it can hold order messages).
    assert.equal((await d.select().from(conversations).where(eq(conversations.brandId, "b_race"))).length, 1)
  })

  it("is reported as closed by the plan afterwards", async () => {
    const plan = await planBrandRemoval(db(), "b_race")
    assert.ok(plan?.brand.closedAt)
  })
})

describe("rules", () => {
  it("decides the mode from any financial record and names them", () => {
    const none = { orders: 0, refunds: 0, returns: 0, disputes: 0, complaints: 0, payouts: 0, transfers: 0, ledgerEntries: 0, payoutAccounts: 0 }
    assert.equal(modeOf(none), "delete")
    assert.equal(recordsLine(none), null)
    assert.equal(modeOf({ ...none, payoutAccounts: 1 }), "close")
    assert.equal(recordsLine({ ...none, orders: 3, payouts: 1, refunds: 2 }), "3 orders, 2 refunds and 1 payout")
  })

  it("lets only owner admins delete brands", () => {
    assert.equal(canAdmin("owner", "brands.delete"), true)
    for (const role of ["trust_safety", "support", "ads_ops", "engineering", "finance"] as const) {
      assert.equal(canAdmin(role, "brands.delete"), false, role)
      assert.equal(adminRolePermissions[role].includes("brands.delete"), false)
    }
    assert.equal(needsRole("brands.delete"), "Needs the Owner role")
  })

  it("needs the mode, the typed handle and a reason", () => {
    assert.equal(brandRemovalBody.safeParse({ mode: "delete", confirmHandle: "x", reason: "test brand" }).success, true)
    assert.equal(brandRemovalBody.safeParse({ mode: "delete", confirmHandle: "x", reason: "short" }).success, false)
    assert.equal(brandRemovalBody.safeParse({ mode: "erase", confirmHandle: "x", reason: "test brand" }).success, false)
    assert.equal(brandRemovalBody.safeParse({ mode: "close", confirmHandle: "", reason: "test brand" }).success, false)
    assert.equal(brandRemovalBody.safeParse({ mode: "close", confirmHandle: "x", reason: "test brand", extra: 1 }).success, false)
  })
})

// The audit row is written by catalog/brand-removal.ts (server-only); its shape is checked live by scripts/checks/v3-brand-removal.mjs.
void auditLog
