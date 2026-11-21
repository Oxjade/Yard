import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { instagramHandleOf, studioApplyBody } from "../../lib/api/contracts/studio-app"
import { brandMembers, brands, orderRefs, users } from "../db/schema/index"
import { brandOnboardings, catalogCategories, catalogProducts, catalogVariants } from "../db/schema/catalog"
import { chartEvents } from "../db/schema/charts"
import { orderStates } from "../db/schema/orders-v3"
import { ApplyRefused, dashboardNumbers, membershipStatus, membershipsOf, pushPrefsOf, savePushPrefs, switchTarget, wantingPush, writeShortApplication, type Db } from "./core"

/* Studio in the apps (docs/APP.md › Studio in the app): the session's brand list, who may switch
 * into a brand session, the short application and the dashboard aggregates, on a real (in-memory)
 * database with the migrations. */

const newId = (p: string) => `${p}_${randomBytes(6).toString("hex")}`
let pg: PGlite
let d: Db

const brand = (id: string, over: Partial<typeof brands.$inferInsert> = {}) => ({
  id,
  handle: id.replace(/_/g, "-"),
  name: `Brand ${id}`,
  city: "Lagos",
  citySlug: "lagos",
  country: "NG",
  currency: "NGN",
  categories: ["home"],
  followersBase: 0,
  timeZone: "Africa/Lagos",
  reviewStatus: "verified",
  ...over,
})

before(async () => {
  pg = new PGlite()
  const db = drizzle(pg)
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  d = db as unknown as Db
  await d.insert(catalogCategories).values([{ slug: "home", name: "Home" }, { slug: "beauty", name: "Beauty" }]).onConflictDoNothing()
  await d.insert(users).values([
    { id: "u_ada", kind: "shopper", name: "Ada Nwosu", email: "ada@example.com", demo: false },
    { id: "u_bo", kind: "shopper", name: "Bo", email: "bo@example.com", demo: false },
    { id: "u_cy", kind: "shopper", name: "Cy", email: "cy@example.com", demo: false },
  ])
  await d.insert(brands).values([
    brand("b_live", { name: "Kachi Studio", logoMediaId: null }),
    brand("b_wait", { reviewStatus: "pending_review" }),
    brand("b_gone", { reviewStatus: "suspended" }),
    brand("b_found", { founding: true, claimStatus: "claimed" }),
    brand("b_setup", { founding: true, claimStatus: "unclaimed" }),
    brand("b_invite"),
  ])
  await d.insert(brandMembers).values([
    { id: "tm1", brandId: "b_live", userId: "u_ada", role: "owner", status: "active", createdAt: new Date("2026-01-01") },
    { id: "tm2", brandId: "b_wait", userId: "u_ada", role: "fulfilment", status: "active", createdAt: new Date("2026-02-01") },
    { id: "tm3", brandId: "b_gone", userId: "u_ada", role: "viewer", status: "active", createdAt: new Date("2026-03-01") },
    { id: "tm4", brandId: "b_found", userId: "u_ada", role: "owner", status: "active", createdAt: new Date("2026-04-01") },
    { id: "tm5", brandId: "b_setup", userId: "u_ada", role: "yard_setup", status: "active" },
    { id: "tm6", brandId: "b_invite", userId: "u_ada", role: "viewer", status: "invited" },
  ])
})
after(async () => {
  await pg.close()
})

describe("GET /api/session: the shopper's brands", () => {
  it("lists active memberships oldest first, with the app's status words, never Yard setup or invites", async () => {
    const list = await membershipsOf(d, "u_ada")
    assert.deepEqual(
      list.map((b) => [b.id, b.role, b.status, b.canOpenStudio]),
      [
        ["b_live", "owner", "approved", true],
        ["b_wait", "fulfilment", "pending_review", true],
        ["b_gone", "viewer", "suspended", false],
        ["b_found", "owner", "claimed", true],
      ],
    )
    assert.equal(list[0].name, "Kachi Studio")
    assert.equal(list[0].initials, "KS")
    assert.equal(list[0].logoSrc, null)
    assert.deepEqual(await membershipsOf(d, "u_bo"), [])
  })
  it("maps review and claim states", () => {
    assert.equal(membershipStatus({ reviewStatus: "restricted", founding: false, claimStatus: "none" }), "restricted")
    assert.equal(membershipStatus({ reviewStatus: "verified", founding: true, claimStatus: "unclaimed" }), "approved")
  })
})

describe("POST /api/studio/session/switch: who may open a brand session", () => {
  it("lets an active member in", async () => {
    assert.deepEqual(await switchTarget(d, "u_ada", "b_live"), { ok: true, brandId: "b_live" })
    assert.deepEqual(await switchTarget(d, "u_ada", "b_wait"), { ok: true, brandId: "b_wait" })
  })
  it("refuses a non-member, an invite not yet accepted and Yard setup access", async () => {
    assert.deepEqual(await switchTarget(d, "u_bo", "b_live"), { ok: false, reason: "not_member" })
    assert.deepEqual(await switchTarget(d, "u_ada", "b_invite"), { ok: false, reason: "not_member" })
    assert.deepEqual(await switchTarget(d, "u_ada", "b_setup"), { ok: false, reason: "not_member" })
    assert.deepEqual(await switchTarget(d, "u_ada", "b_nope"), { ok: false, reason: "not_member" })
  })
  it("refuses a suspended brand", async () => {
    assert.deepEqual(await switchTarget(d, "u_ada", "b_gone"), { ok: false, reason: "suspended" })
  })
})

describe("POST /api/studio/apply: the short application", () => {
  const taken = new Set(["kachi-studio", "admin"])
  const deps = { newId, handleFree: async (h: string) => !taken.has(h), defaultStorefront: { template: "editorial" } }
  const body = (over: Record<string, unknown> = {}) => studioApplyBody.parse({ brandName: "Kachi Studio", instagram: "https://instagram.com/kachi.studio", category: "home", city: "Accra", country: "GH", ...over })

  it("validates the body: Instagram or website, a known country, a real handle", () => {
    assert.equal(studioApplyBody.safeParse({ brandName: "Kachi", category: "home", city: "Accra", country: "GH" }).success, false)
    assert.equal(studioApplyBody.safeParse({ brandName: "Kachi", website: "kachi.com", category: "home", city: "Accra", country: "ZZ" }).success, false)
    assert.equal(studioApplyBody.safeParse({ brandName: "Kachi", website: "kachi.com", category: "home", city: "Accra", country: "GH" }).success, true)
    assert.equal(instagramHandleOf("@kachi.studio"), "kachi.studio")
    assert.equal(instagramHandleOf("kachi studio"), null)
  })
  it("creates a pending brand with the applicant as owner and a submitted application", async () => {
    const { row, created } = await writeShortApplication(d, { id: "u_bo", name: "Bo", email: "bo@example.com" }, body({ website: "kachi.example" }), deps)
    assert.equal(created, true)
    assert.equal(row.status, "submitted")
    const [b] = await d.select().from(brands).where(eq(brands.id, row.brandId!))
    assert.equal(b.reviewStatus, "pending_review")
    assert.equal(b.handle, "kachi-studio-studio") // "kachi-studio" is taken
    assert.equal(b.currency, "GHS")
    assert.equal(b.timeZone, "Africa/Accra")
    assert.equal(b.instagram, "kachi.studio")
    assert.deepEqual(b.categories, ["home"])
    const [m] = await d.select().from(brandMembers).where(eq(brandMembers.brandId, b.id))
    assert.deepEqual([m.userId, m.role, m.status], ["u_bo", "owner", "active"])
    const data = row.data as { short: { website: string; instagram: string }; business: { country: string } }
    assert.equal(data.short.website, "https://kachi.example")
    assert.equal(data.business.country, "GH")
    // The new brand is in the session's list as pending review.
    assert.deepEqual((await membershipsOf(d, "u_bo")).map((x) => x.status), ["pending_review"])
  })
  it("is idempotent while it waits", async () => {
    const again = await writeShortApplication(d, { id: "u_bo", name: "Bo", email: "bo@example.com" }, body({ brandName: "Something Else" }), deps)
    assert.equal(again.created, false)
    const rows = await d.select().from(brandOnboardings).where(eq(brandOnboardings.userId, "u_bo"))
    assert.equal(rows.length, 1)
  })
  it("resubmits a rejected application on the same brand", async () => {
    await d.update(brandOnboardings).set({ status: "rejected", reviewNote: "Add your website." }).where(eq(brandOnboardings.userId, "u_bo"))
    const out = await writeShortApplication(d, { id: "u_bo", name: "Bo", email: "bo@example.com" }, body({ brandName: "Kachi Home" }), deps)
    assert.equal(out.created, true)
    assert.equal(out.row.status, "submitted")
    const [b] = await d.select().from(brands).where(eq(brands.id, out.row.brandId!))
    assert.equal(b.name, "Kachi Home")
    assert.equal(b.handle, "kachi-studio-studio")
    assert.equal((await d.select().from(brandMembers).where(eq(brandMembers.userId, "u_bo"))).length, 1)
  })
  it("refuses an unknown category and an unfinished website draft", async () => {
    await assert.rejects(writeShortApplication(d, { id: "u_cy", name: "Cy", email: "cy@example.com" }, body({ category: "nope" }), deps), (e) => e instanceof ApplyRefused && e.kind === "category")
    await d.insert(brandOnboardings).values({ id: "onb_cy", userId: "u_cy", status: "draft", data: {} })
    await assert.rejects(writeShortApplication(d, { id: "u_cy", name: "Cy", email: "cy@example.com" }, body(), deps), (e) => e instanceof ApplyRefused && e.kind === "open_draft")
  })
})

describe("GET /api/studio/dashboard: the aggregates", () => {
  // 2026-11-21 10:00 in Lagos (UTC+1).
  const now = new Date("2026-11-21T09:00:00Z")
  let n = 0
  const order = async (at: string, totalMinor: number, opts: { status?: string; payment?: string; refunded?: number } = {}) => {
    const id = `mo_${++n}`
    await d.execute(sql`set session_replication_role = replica`)
    await d.insert(orderRefs).values({ id, groupId: "grp", reference: `YD-${n}`, brandId: "b_live", customerId: "u_bo", placedAt: new Date(at), status: opts.status ?? "paid", paid: true, currency: "NGN", subtotalMinor: totalMinor, shippingMinor: 0, totalMinor, items: [], shipToCountry: "NG", source: "browser" })
    await d.insert(orderStates).values({ orderRefId: id, brandId: "b_live", customerId: "u_bo", currency: "NGN", totalMinor, paymentStatus: opts.payment ?? "paid", refundedMinor: opts.refunded ?? 0 })
    await d.execute(sql`set session_replication_role = origin`)
  }
  before(async () => {
    await order("2026-11-21T08:30:00Z", 10_000) // today (09:30 Lagos)
    await order("2026-11-20T23:30:00Z", 5_000, { status: "processing" }) // today in Lagos (00:30), yesterday in UTC
    await order("2026-11-20T12:00:00Z", 2_000, { status: "shipped", refunded: 500 }) // yesterday
    await order("2026-11-15T12:00:00Z", 3_000, { status: "delivered" }) // 6 days ago: in the week
    await order("2026-11-14T12:00:00Z", 4_000, { status: "delivered" }) // 7 days ago: month only
    await order("2026-10-20T12:00:00Z", 9_000, { status: "delivered" }) // 32 days ago: out
    await order("2026-11-21T07:00:00Z", 7_000, { status: "cancelled", payment: "pending" }) // unpaid: never counted
    await d.insert(catalogProducts).values({ id: "p_1", brandId: "b_live", slug: "p-1", title: "Candle", categorySlug: "home", priceMinor: 1000, currency: "NGN", status: "published" })
    await d.insert(catalogVariants).values([
      { id: "v_1", productId: "p_1", brandId: "b_live", sku: "C-1", onHand: 2, held: 0 },
      { id: "v_2", productId: "p_1", brandId: "b_live", sku: "C-2", onHand: 40, held: 0 },
      { id: "v_3", productId: "p_1", brandId: "b_live", sku: "C-3", onHand: 5, held: 3 },
    ])
    await d.execute(sql`set session_replication_role = replica`)
    for (const [i, day] of ["2026-11-21", "2026-11-21", "2026-11-19", "2026-11-01"].entries()) await d.insert(chartEvents).values({ brandId: "b_live", kind: "storefront_view", actorKind: "anon", actorId: `anon_${i}`, day })
    await d.insert(chartEvents).values({ brandId: "b_live", kind: "storefront_view", actorKind: "anon", actorId: "anon_y", day: "2026-11-21", verdict: "excluded_fraud" })
    await d.execute(sql`set session_replication_role = origin`)
  })
  it("sums captured sales in the brand's own calendar", async () => {
    const x = await dashboardNumbers(d, { brandId: "b_live", timeZone: "Africa/Lagos", days: 7, now })
    assert.deepEqual(x.sales.today, { orders: 2, grossMinor: 15_000, refundedMinor: 0, netMinor: 15_000 })
    assert.deepEqual(x.sales.week, { orders: 4, grossMinor: 20_000, refundedMinor: 500, netMinor: 19_500 })
    assert.deepEqual(x.sales.month, { orders: 5, grossMinor: 24_000, refundedMinor: 500, netMinor: 23_500 })
  })
  it("gives one point per day, today last", async () => {
    const x = await dashboardNumbers(d, { brandId: "b_live", timeZone: "Africa/Lagos", days: 7, now })
    assert.equal(x.series.points.length, 7)
    assert.equal(x.series.points[0].date, "2026-11-15")
    assert.deepEqual(x.series.points[6], { date: "2026-11-21", orders: 2, grossMinor: 15_000, netMinor: 15_000 })
    assert.deepEqual(x.series.points[5], { date: "2026-11-20", orders: 1, grossMinor: 2_000, netMinor: 1_500 })
    const m = await dashboardNumbers(d, { brandId: "b_live", timeZone: "Africa/Lagos", days: 30, now })
    assert.equal(m.series.points.length, 30)
    assert.equal(m.series.points.reduce((s, p) => s + p.orders, 0), 5)
  })
  it("counts orders to ship, low stock and counted store views", async () => {
    const x = await dashboardNumbers(d, { brandId: "b_live", timeZone: "Africa/Lagos", days: 7, now })
    assert.deepEqual(x.toShip, { total: 2, paid: 1, processing: 1 })
    assert.deepEqual(x.lowStock, { variants: 2, products: 1, threshold: 3 })
    assert.deepEqual(x.storeViews, { today: 2, week: 3, month: 4 })
  })
})

describe("Studio push preferences", () => {
  it("default to on and are per member and brand", async () => {
    assert.deepEqual(await pushPrefsOf(d, "u_ada", "b_live"), { orders: true, messages: true, lowStock: true, payouts: true })
    await savePushPrefs(d, "u_ada", "b_live", { orders: false })
    assert.deepEqual(await pushPrefsOf(d, "u_ada", "b_live"), { orders: false, messages: true, lowStock: true, payouts: true })
    assert.deepEqual(await pushPrefsOf(d, "u_ada", "b_found"), { orders: true, messages: true, lowStock: true, payouts: true })
    assert.deepEqual(await wantingPush(d, "b_live", ["u_ada", "u_bo"], "orders"), ["u_bo"])
    assert.deepEqual(await wantingPush(d, "b_live", ["u_ada", "u_bo"], "messages"), ["u_ada", "u_bo"])
  })
})
