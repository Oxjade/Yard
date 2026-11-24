import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { SAMPLE_BRAND_IDS } from "../../lib/data/sample-ids"
import { ADMIN_ROLES } from "../../lib/api/contracts/enums"
import { canAdminFinance } from "../../lib/permissions"
import { brands } from "../db/schema/brands"
import { catalogCategories, catalogProducts, catalogVariants } from "../db/schema/catalog"
import { chartEvents, shopperFollows } from "../db/schema/charts"
import { ledgerOrderMoney } from "../db/schema/ledger"
import { orderGroups, orderRefs } from "../db/schema/orders"
import { orderLines, orderStates } from "../db/schema/orders-v3"
import { users } from "../db/schema/people"
import { adminAnalyticsDb } from "./admin-db"
import { brandAnalyticsDb, brandCustomersDb } from "./brand-db"
import type { Db, Guards } from "./common"

/* Studio › Analytics and Customers, and the Control Center's performance figures, on a real
 * (in-memory) database with every migration applied: a brand sees only its own orders, buyers
 * and signals; production leaves sample brands and demo accounts out; a new brand gets zeros. */

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db
const NOW = Date.parse("2026-11-24T12:00:00Z")
const SAMPLE = [...SAMPLE_BRAND_IDS][0]
const PROD: Guards = { sampleBrandIds: SAMPLE_BRAND_IDS, realUsersOnly: true }

async function brand(id: string, name: string) {
  await d.insert(brands).values({ id, handle: id.replace(/^b_/, "").replace(/_/g, "-"), name, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", launchedAt: new Date("2026-09-01T00:00:00Z") })
}
async function user(id: string, demo = false) {
  await d.insert(users).values({ id, kind: "shopper", name: id === "u_ada" ? "Ada Obi" : id === "u_bola" ? "Bola Ade" : "Demo Shopper", email: `${id}@example.test`, demo })
}
async function product(id: string, brandId: string, stock = 5) {
  await d.insert(catalogProducts).values({ id, brandId, slug: id, title: `Tee ${id}`, categorySlug: "streetwear", priceMinor: 5000, currency: "NGN", status: "published" })
  await d.insert(catalogVariants).values({ id: `${id}_v0`, productId: id, brandId, sku: `${id}-0`, onHand: stock })
}

let n = 0
async function order(o: { brandId: string; customerId: string; placedAt: string; lines: [productId: string, qty: number, unit: number][]; payment?: string; status?: string; country?: string; ledger?: boolean }) {
  const id = `o_${++n}`
  const subtotal = o.lines.reduce((s, [, q, u]) => s + q * u, 0)
  const payment = o.payment ?? "paid"
  await d.insert(orderGroups).values({ id: `g_${n}`, customerId: o.customerId, reference: `YD-${n}` })
  await d.insert(orderRefs).values({ id, groupId: `g_${n}`, reference: `YD-${n}-1`, brandId: o.brandId, customerId: o.customerId, placedAt: new Date(o.placedAt), status: o.status ?? "paid", paid: payment !== "pending", currency: "NGN", subtotalMinor: subtotal, shippingMinor: 0, totalMinor: subtotal, items: o.lines.map(([productId, qty, unitMinor]) => ({ productId, variantId: `${productId}_v0`, name: `Tee ${productId}`, qty, unitMinor })), shipToCountry: o.country ?? "NG", shipToCity: "Lagos", source: "browser" })
  await d.insert(orderStates).values({ orderRefId: id, brandId: o.brandId, customerId: o.customerId, currency: "NGN", totalMinor: subtotal, paymentStatus: payment, shipTo: { name: "Ship Name", line1: "1 Secret Street", country: o.country ?? "NG", phone: "+2340000" } })
  for (const [i, [productId, qty, unitMinor]] of o.lines.entries()) await d.insert(orderLines).values({ id: `${id}_l${i}`, orderRefId: id, variantId: `${productId}_v0`, productId, title: `Tee ${productId}`, qty, unitMinor, currency: "NGN" })
  if (o.ledger !== false && payment === "paid")
    await d.insert(ledgerOrderMoney).values({ orderId: id, brandId: o.brandId, currency: "NGN", paymentId: `pay_${n}`, grossMinor: subtotal, commissionMinor: Math.round(subtotal * 0.05), commissionBps: 500, tier: "new", reserveBps: 0, pendingMinor: subtotal, reserveMinor: 0, capturedAt: new Date(o.placedAt) })
  return id
}
async function signal(brandId: string, kind: string, actorId: string, day: string, productId: string | null = null, verdict = "counted") {
  await d.insert(chartEvents).values({ brandId, productId, kind, actorKind: actorId.startsWith("u_") ? "shopper" : "anon", actorId, day, verdict })
}

before(async () => {
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })
  await brand("b_alpha", "Alpha Label")
  await brand("b_beta", "Beta Label")
  await brand("b_gamma", "Gamma Label")
  await brand(SAMPLE, "Sample Brand")
  await user("u_ada")
  await user("u_bola")
  await user("u_demo", true)
  await product("p_a1", "b_alpha")
  await product("p_a2", "b_alpha", 0)
  await product("p_b1", "b_beta")
  await product("p_s1", SAMPLE)

  // Alpha: two paid orders this week from Ada, a cancelled one and an older paid one from Bola, one from a demo account.
  await order({ brandId: "b_alpha", customerId: "u_ada", placedAt: "2026-11-20T10:00:00Z", lines: [["p_a1", 2, 5000]] })
  await order({ brandId: "b_alpha", customerId: "u_ada", placedAt: "2026-11-23T10:00:00Z", lines: [["p_a2", 1, 3000]], country: "GH" })
  await order({ brandId: "b_alpha", customerId: "u_bola", placedAt: "2026-11-22T10:00:00Z", lines: [["p_a1", 1, 5000]], payment: "pending", status: "cancelled", ledger: false })
  await order({ brandId: "b_alpha", customerId: "u_bola", placedAt: "2026-10-30T10:00:00Z", lines: [["p_a2", 1, 4000]] })
  await order({ brandId: "b_alpha", customerId: "u_demo", placedAt: "2026-11-21T10:00:00Z", lines: [["p_a1", 9, 11111]] })
  // Beta and the sample brand: their own sales, which alpha must never see.
  await order({ brandId: "b_beta", customerId: "u_bola", placedAt: "2026-11-21T10:00:00Z", lines: [["p_b1", 1, 77777]] })
  await order({ brandId: SAMPLE, customerId: "u_ada", placedAt: "2026-11-21T10:00:00Z", lines: [["p_s1", 1, 55555]] })

  await signal("b_alpha", "product_view", "anon_1", "2026-11-20", "p_a1")
  await signal("b_alpha", "product_view", "u_ada", "2026-11-20", "p_a1")
  await signal("b_alpha", "product_view", "anon_1", "2026-11-20", "p_a1", "deduped")
  await signal("b_alpha", "storefront_view", "anon_2", "2026-11-21")
  await signal("b_alpha", "wishlist_add", "u_ada", "2026-11-21", "p_a1")
  await signal("b_alpha", "follow", "u_bola", "2026-11-22")
  await signal("b_alpha", "product_view", "u_demo", "2026-11-22", "p_a2")
  await signal("b_beta", "product_view", "anon_9", "2026-11-20", "p_b1")
  await d.insert(shopperFollows).values([{ userId: "u_bola", brandId: "b_alpha" }, { userId: "u_ada", brandId: "b_beta" }])
})
after(async () => {
  await pg?.close()
})

describe("Studio › Analytics (brandAnalyticsDb)", () => {
  it("counts the brand's own paid orders, traffic and products", async () => {
    const a = await brandAnalyticsDb(db(), "b_alpha", "NGN", 7, PROD, NOW)
    assert.equal(a.today, "2026-11-24")
    assert.equal(a.from, "2026-11-18")
    assert.equal(a.series.length, 14)
    assert.equal(a.now.orders, 2)
    assert.equal(a.now.revenue, 13000)
    assert.equal(a.now.aov, 6500)
    assert.equal(a.prev.orders, 0)
    assert.equal(a.historyStart, "2026-10-30")
    // Visits are distinct visitors per day: two on the 20th (one deduped view ignored), one on the 21st.
    assert.equal(a.now.visits, 3)
    assert.equal(a.now.productViews, 2)
    assert.equal(a.now.wishlists, 1)
    assert.equal(a.now.follows, 1)
    assert.ok(Math.abs(a.now.conversion - 2 / 3) < 1e-9)
    assert.deepEqual(a.bestSellers.map((p) => [p.productId, p.units, p.revenue]), [["p_a1", 2, 10000], ["p_a2", 1, 3000]])
    assert.equal(a.bestSellers[1].soldOut, 1)
    assert.deepEqual(a.traffic.map((p) => [p.productId, p.views, p.saves]), [["p_a1", 2, 1]])
    assert.deepEqual(a.locations, [{ country: "GH", orders: 1 }, { country: "NG", orders: 1 }])
    assert.deepEqual(a.returning.now, { customers: 1, returning: 1 })
    assert.equal(a.followers, 1)
  })

  it("never shows brand A another brand's orders or signals", async () => {
    const a = await brandAnalyticsDb(db(), "b_alpha", "NGN", 30, PROD, NOW)
    const b = await brandAnalyticsDb(db(), "b_beta", "NGN", 30, PROD, NOW)
    assert.equal(a.now.revenue, 17000)
    assert.ok(!a.bestSellers.some((p) => p.productId === "p_b1" || p.productId === "p_s1"))
    assert.equal(b.now.orders, 1)
    assert.equal(b.now.revenue, 77777)
    assert.equal(b.now.visits, 1)
    assert.deepEqual(b.bestSellers.map((p) => p.productId), ["p_b1"])
    assert.equal(b.followers, 1)
  })

  it("leaves demo accounts out in production and keeps them in the demo", async () => {
    const prod = await brandAnalyticsDb(db(), "b_alpha", "NGN", 7, PROD, NOW)
    const demo = await brandAnalyticsDb(db(), "b_alpha", "NGN", 7, {}, NOW)
    assert.equal(prod.now.orders, 2)
    assert.equal(demo.now.orders, 3)
    assert.equal(prod.now.productViews, 2)
    assert.equal(demo.now.productViews, 3)
  })

  it("answers zeros for a sample brand in production", async () => {
    const prod = await brandAnalyticsDb(db(), SAMPLE, "NGN", 7, PROD, NOW)
    assert.equal(prod.now.orders, 0)
    assert.equal(prod.bestSellers.length, 0)
    const demo = await brandAnalyticsDb(db(), SAMPLE, "NGN", 7, {}, NOW)
    assert.equal(demo.now.orders, 1)
  })

  it("gives a new brand a calm, complete empty answer", async () => {
    const g = await brandAnalyticsDb(db(), "b_gamma", "NGN", 30, PROD, NOW)
    assert.equal(g.series.length, 60)
    assert.ok(g.series.every((p) => p.orders === 0 && p.visits === 0))
    assert.equal(g.now.conversion, 0)
    assert.equal(g.now.aov, 0)
    assert.equal(g.historyStart, null)
    assert.deepEqual([g.bestSellers, g.traffic, g.locations, g.drops], [[], [], [], []])
  })
})

describe("Studio › Customers (brandCustomersDb)", () => {
  it("lists the brand's buyers from its own orders, without contact details", async () => {
    const c = await brandCustomersDb(db(), "b_alpha", "NGN", PROD)
    assert.equal(c.total, 2)
    const [ada, bola] = c.customers
    assert.equal(ada.name, "Ada Obi")
    assert.equal(ada.orderCount, 2)
    assert.equal(ada.spentMinor, 13000)
    assert.equal(ada.lastOrderAt, "2026-11-23T10:00:00.000Z")
    assert.equal(ada.orders.length, 2)
    assert.equal(bola.orderCount, 1)
    assert.equal(bola.cancelledCount, 1)
    assert.equal(bola.spentMinor, 4000)
    const text = JSON.stringify(c)
    for (const secret of ["@example.test", "Secret Street", "+2340000", "u_ada", "u_bola"]) assert.ok(!text.includes(secret), `leaked ${secret}`)
    assert.ok(!c.customers.some((x) => x.name === "Demo Shopper"))
  })

  it("keys a shopper differently per brand and never lists another brand's buyers", async () => {
    const a = await brandCustomersDb(db(), "b_alpha", "NGN", PROD)
    const b = await brandCustomersDb(db(), "b_beta", "NGN", PROD)
    assert.deepEqual(b.customers.map((x) => [x.name, x.spentMinor]), [["Bola Ade", 77777]])
    assert.notEqual(a.customers.find((x) => x.name === "Bola Ade")!.id, b.customers[0].id)
    assert.ok(!b.customers[0].orders.some((o) => a.customers.flatMap((x) => x.orders).some((y) => y.id === o.id)))
  })

  it("is empty for a new brand and for a sample brand in production", async () => {
    assert.deepEqual((await brandCustomersDb(db(), "b_gamma", "NGN", PROD)).customers, [])
    assert.deepEqual((await brandCustomersDb(db(), SAMPLE, "NGN", PROD)).customers, [])
    assert.equal((await brandCustomersDb(db(), SAMPLE, "NGN", {})).customers.length, 1)
  })
})

describe("Control Center › Marketplace performance (adminAnalyticsDb)", () => {
  it("sums GMV and commission per brand from the ledger, without sample brands or demo accounts", async () => {
    const a = await adminAnalyticsDb(db(), 7, PROD, NOW)
    assert.deepEqual(a.currencies, ["NGN"])
    const ngn = a.byCurrency.NGN
    assert.equal(ngn.series.length, 180)
    const week = ngn.series.slice(-7)
    assert.equal(week.reduce((s, p) => s + p.gmv, 0), 13000 + 77777)
    assert.equal(week.reduce((s, p) => s + p.orders, 0), 3)
    assert.deepEqual(ngn.brands.map((b) => [b.brandId, b.orders, b.gross, b.net]), [["b_beta", 1, 77777, 3889], ["b_alpha", 2, 13000, 650]])
    assert.equal(ngn.historyStart, "2026-10-30")
    assert.equal(a.counts.users, 2)
    assert.equal(a.counts.brands, 3)
  })

  it("keeps everything in the demo", async () => {
    const a = await adminAnalyticsDb(db(), 7, {}, NOW)
    assert.equal(a.byCurrency.NGN.brands.length, 3)
    assert.equal(a.counts.users, 3)
  })
})

describe("Permissions", () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8")

  it("Studio reads take the brand from the signed-in session, never from the request", () => {
    for (const file of ["src/app/api/studio/analytics/route.ts", "src/app/api/studio/customers/route.ts"]) {
      const code = src(file)
      assert.match(code, /auth: "brand"/, file)
      assert.match(code, /actor\.brandId/, file)
      assert.doesNotMatch(code, /query\.brand|params\.brand|body\.brand/, file)
    }
    // Yard setup staff (an unclaimed founding brand) are kept to the catalogue and storefront routes.
    const allow = src("src/server/http/route.ts").match(/const YARD_SETUP_PATHS = \[(.*)\]/)?.[1] ?? ""
    assert.ok(allow.length > 0)
    assert.doesNotMatch(allow, /analytics|customers/)
  })

  it("the marketplace figures answer Owner and Finance only", () => {
    const code = src("src/app/api/admin/analytics/route.ts")
    assert.match(code, /auth: "admin"/)
    assert.match(code, /assertAdminFinance\(actor\)/)
    assert.deepEqual(ADMIN_ROLES.filter(canAdminFinance), ["owner", "finance"])
  })

  it("production no longer redirects Analytics or Customers to coming soon, and keeps the features that don't exist yet gated", () => {
    const proxy = src("src/proxy.ts")
    assert.doesNotMatch(proxy, /"\/studio\/(analytics|customers)/)
    for (const gated of ["/studio/campaigns", "/studio/advertising", "/admin/advertising"]) assert.ok(proxy.includes(`["${gated}"`), gated)
  })
})
