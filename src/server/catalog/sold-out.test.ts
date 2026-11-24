import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { asc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { askAvailabilityText, askBrandHref } from "../../lib/ask-brand"
import { inStockFirst, productInStock } from "../../lib/in-stock-first"
import { brands } from "../db/schema/brands"
import { catalogCategories, catalogOptions, catalogProducts, catalogVariants, productProposals, stockMovements } from "../db/schema/catalog"
import { catalogImportItems, catalogImports, catalogSitePieces } from "../db/schema/imports"
import { users } from "../db/schema/people"
import { availableOf, inStockFirstOrder, productInStockSql, UNTRACKED_AVAILABLE } from "./availability"
import { brandForSaleSql } from "./for-sale-sql"
import { applyImportedStock, planImportedStock, type Db } from "./importer/imported-stock-db"

/*
 * Sold out isn't a dead end (owner's report: the home page showed everything SOLD OUT, nearly all
 * of it Animed Merch Store, imported from its website). Covers:
 *   - "available, stock not tracked" variants (catalog/availability.ts) and in-stock-first sorting,
 *     on a real in-memory database with every migration;
 *   - the Admin action that marks imported products available (importer/imported-stock-db.ts);
 *   - holds and sales of an untracked variant, the search order, and "Ask the brand" (a message to
 *     the brand with the piece attached, its notification and the inbox's limits) through the real
 *     "server-only" modules, in a child under the react-server condition on a throwaway database.
 * The importer's own mapping ("available, no count" → not tracked) is in importer/importer.test.ts.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.SOLD_OUT_CHILD
const T0 = new Date("2026-11-01T10:00:00Z")

type ChildResult = {
  hold: { ok: boolean; onHandAfter: number; held: number; movement: { delta: number; note: string | null } | null; tracked: boolean }
  sellable: Record<string, number>
  search: { default: string[]; priceAsc: string[]; priceDesc: string[] }
  ask: { origin: string; originRef: string | null; topic: string | null; kind: string; body: string | null; productId: string | null; variantId: string | null; snapshot: string | null; notified: string[] }
  limits: { firstContactCapAt: number; perMinuteCapAt: number }
}

if (!CHILD) {
  describe("in stock first (lib/in-stock-first.ts)", () => {
    it("puts pieces a shopper can buy first and keeps each group's own order", () => {
      const list = [
        { id: "a", out: true },
        { id: "b", out: false },
        { id: "c", out: true },
        { id: "d", out: false },
      ]
      assert.deepEqual(
        inStockFirst(list, (x) => !x.out).map((x) => x.id),
        ["b", "d", "a", "c"],
      )
    })
    it("a product is in stock when a variant has stock left and its brand sells", () => {
      assert.equal(productInStock({ variants: [{ stock: 0, reserved: 0 }, { stock: 2, reserved: 2 }] }), false)
      assert.equal(productInStock({ variants: [{ stock: 0, reserved: 0 }, { stock: 3, reserved: 1 }] }), true)
      assert.equal(productInStock({ variants: [{ stock: 3, reserved: 0 }], brandSummary: { forSale: false } }), false)
    })
    it("an untracked variant is always available, above every per-line cap", () => {
      assert.equal(availableOf({ trackStock: false, onHand: 0, held: 4 }), UNTRACKED_AVAILABLE)
      assert.equal(availableOf({ trackStock: true, onHand: 2, held: 3 }), 0)
      assert.equal(availableOf({ trackStock: true, onHand: 5, held: 1 }), 4)
    })
  })

  describe("Ask the brand (lib/ask-brand.ts)", () => {
    it("prefills an editable question naming the piece and the size chosen", () => {
      assert.equal(askAvailabilityText("Okarun Dandandan Tee", "Size M"), "Hi! Is the Okarun Dandandan Tee (Size M) available, or coming back soon?")
      assert.equal(askAvailabilityText("Okarun Dandandan Tee"), "Hi! Is the Okarun Dandandan Tee available, or coming back soon?")
    })
    it("opens the brand's thread with the piece, the size and the question", () => {
      assert.equal(askBrandHref({ handle: "animedmerch" }, "p_1", "pv_2"), "/inbox?brand=animedmerch&product=p_1&variant=pv_2&ask=availability")
      assert.equal(askBrandHref({ handle: "animedmerch" }, "p_1"), "/inbox?brand=animedmerch&product=p_1&ask=availability")
    })
    it("sending needs a signed-in shopper: the message endpoint is shopper-only", () => {
      const src = readFileSync(path.join(path.dirname(SELF), "../../app/api/inbox/messages/route.ts"), "utf8")
      assert.match(src, /route\(\{ auth: "shopper"/)
    })
  })

  describe("listings on a database", () => {
    let pg: PGlite
    let d: ReturnType<typeof drizzle>
    before(async () => {
      pg = new PGlite()
      d = drizzle(pg)
      await migrate(d, { migrationsFolder: "drizzle" })
      await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })
      const brand = async (key: string, over: Partial<typeof brands.$inferInsert> = {}) =>
        d.insert(brands).values({ id: `b_${key}`, handle: key, name: key, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true, ...over })
      await brand("animed")
      await brand("unclaimed", { founding: true, claimStatus: "unclaimed", launchedAt: T0 })
      // Newest first by publishedAt; prices make the price sort differ from the newest sort.
      const product = async (id: string, brandKey: string, day: number, price: number, variants: { onHand?: number; held?: number; trackStock?: boolean; status?: string }[]) => {
        await d.insert(catalogProducts).values({ id, brandId: `b_${brandKey}`, slug: id, title: id, categorySlug: "streetwear", priceMinor: price, currency: "NGN", status: "published", publishedAt: new Date(T0.getTime() + day * 86_400_000) })
        for (const [i, v] of variants.entries()) await d.insert(catalogVariants).values({ id: `${id}_v${i}`, productId: id, brandId: `b_${brandKey}`, sku: `${id}-${i}`, options: { Size: `S${i}` }, onHand: v.onHand ?? 0, held: v.held ?? 0, trackStock: v.trackStock ?? true, status: v.status ?? "active" })
      }
      await product("p_new_soldout", "animed", 9, 3000, [{ onHand: 0 }, { onHand: 0 }])
      await product("p_untracked", "animed", 8, 9000, [{ trackStock: false }])
      await product("p_held_out", "animed", 7, 1000, [{ onHand: 2, held: 2 }])
      await product("p_counted", "animed", 6, 5000, [{ onHand: 0 }, { onHand: 4 }])
      await product("p_archived_size", "animed", 5, 2000, [{ onHand: 3, status: "archived" }])
      await product("p_unclaimed", "unclaimed", 10, 4000, [{ onHand: 5 }])
      await product("p_old_soldout", "animed", 1, 500, [{ onHand: 0 }])
    })
    after(async () => pg.close())

    const listed = async (order: "new" | "price_asc" | "price_desc") =>
      (
        await d
          .select({ id: catalogProducts.id })
          .from(catalogProducts)
          .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
          .orderBy(
            inStockFirstOrder(brandForSaleSql()),
            order === "price_asc" ? asc(catalogProducts.priceMinor) : order === "price_desc" ? sql`${catalogProducts.priceMinor} desc` : sql`${catalogProducts.publishedAt} desc`,
            asc(catalogProducts.id),
          )
      ).map((r) => r.id)

    it("sorts in-stock first (untracked counts as in stock), newest first within each group", async () => {
      assert.deepEqual(await listed("new"), ["p_untracked", "p_counted", "p_unclaimed", "p_new_soldout", "p_held_out", "p_archived_size", "p_old_soldout"])
    })
    it("an explicit price sort still applies within each group", async () => {
      assert.deepEqual(await listed("price_asc"), ["p_counted", "p_untracked", "p_old_soldout", "p_held_out", "p_archived_size", "p_new_soldout", "p_unclaimed"])
      assert.deepEqual(await listed("price_desc"), ["p_untracked", "p_counted", "p_unclaimed", "p_new_soldout", "p_archived_size", "p_held_out", "p_old_soldout"])
    })
    it("the in-stock filter matches the same rule", async () => {
      const rows = await d.select({ id: catalogProducts.id }).from(catalogProducts).where(productInStockSql()).orderBy(asc(catalogProducts.id))
      assert.deepEqual(
        rows.map((r) => r.id),
        ["p_counted", "p_unclaimed", "p_untracked"],
      )
    })
    it("the database lets an untracked variant hold more than it has on hand, and a tracked one not", async () => {
      await d.update(catalogVariants).set({ held: 3 }).where(eq(catalogVariants.id, "p_untracked_v0"))
      await assert.rejects(d.update(catalogVariants).set({ held: 9 }).where(eq(catalogVariants.id, "p_counted_v1")).then(() => undefined))
      await d.update(catalogVariants).set({ held: 0 }).where(eq(catalogVariants.id, "p_untracked_v0"))
    })
  })

  describe("Admin › Mark imported products as available (importer/imported-stock-db.ts)", () => {
    let pg: PGlite
    let d: ReturnType<typeof drizzle>
    const db = () => d as unknown as Db
    const B = "b_imp"
    const site = (handle: string, variants: { size: string; available: boolean | null; stock?: number | null }[], availability = "in_stock") => ({
      key: `url:shop.example.com/products/${handle}`,
      sourceUrl: `https://shop.example.com/products/${handle}`,
      sourceId: null,
      title: handle,
      description: "",
      priceMinor: 1_800_000,
      compareAtMinor: null,
      currency: "NGN",
      images: [],
      options: [{ name: "Size", values: variants.map((v) => ({ value: v.size })) }],
      variants: variants.map((v) => ({ options: { Size: v.size }, stock: v.stock ?? null, priceMinor: null, available: v.available })),
      availability,
      categorySlug: "streetwear",
      subcategory: null,
      processingDays: null,
      tags: [],
      warnings: [],
      duplicate: null,
    })

    before(async () => {
      pg = new PGlite()
      d = drizzle(pg)
      await migrate(d, { migrationsFolder: "drizzle" })
      await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })
      await d.insert(users).values({ id: "u_admin", kind: "admin", name: "Admin", email: "a@example.test", demo: false })
      await d.insert(brands).values({ id: B, handle: "imp", name: "Imp Merch", city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
      const found = [
        site("tee", [
          { size: "M", available: true },
          { size: "L", available: false },
          { size: "XL", available: true },
        ]),
        site("hoodie", [{ size: "M", available: null }], "out_of_stock"),
        site("cap", [{ size: "M", available: true, stock: 0 }]),
        site("tote", [{ size: "M", available: true }]),
        site("scarf", [{ size: "M", available: true }]),
      ]
      await d.insert(catalogImports).values({ id: "ci_1", brandId: B, sourceUrl: "https://shop.example.com", platform: "shopify", status: "done", consentAt: T0, found: found as never, createdBy: "u_admin" })
      const product = async (handle: string, sizes: string[], opts: { typed?: Record<string, number>; viaPiece?: boolean; moved?: string } = {}) => {
        const pid = `p_${handle}`
        await d.insert(catalogProducts).values({ id: pid, brandId: B, slug: handle, title: handle, categorySlug: "streetwear", priceMinor: 1_800_000, currency: "NGN", status: "published", publishedAt: T0 })
        await d.insert(catalogOptions).values({ id: `po_${handle}`, productId: pid, name: "Size", values: sizes.map((value) => ({ value })) })
        for (const s of sizes) await d.insert(catalogVariants).values({ id: `${pid}_${s}`, productId: pid, brandId: B, sku: `${handle}-${s}`, options: { Size: s } })
        await d.insert(productProposals).values({ id: `pp_${handle}`, brandId: B, productId: pid, kind: "new", payload: {}, status: "accepted", createdByAdminId: "u_admin" })
        if (opts.viaPiece) await d.insert(catalogSitePieces).values({ id: `sp_${handle}`, brandId: B, urlKey: `shop.example.com/products/${handle}`, sourceUrl: `https://shop.example.com/products/${handle}`, title: handle, status: "approved", origin: "watch", proposalId: `pp_${handle}` })
        else await d.insert(catalogImportItems).values({ importId: "ci_1", key: `url:shop.example.com/products/${handle}`, brandId: B, sourceUrl: `https://shop.example.com/products/${handle}`, title: handle, status: "created", proposalId: `pp_${handle}`, choice: { stock: opts.typed ?? {} } })
        if (opts.moved) await d.insert(stockMovements).values({ id: `sm_${handle}`, variantId: `${pid}_${opts.moved}`, brandId: B, delta: 0, onHandAfter: 0, reason: "sale" })
      }
      await product("tee", ["M", "L", "XL"], { typed: { XL: 0 } }) // M: mark. L: sold out on the site. XL: the admin typed 0.
      await product("hoodie", ["M"]) // the whole product sold out on the site
      await product("cap", ["M"]) // the site showed a count (0)
      await product("tote", ["M"], { viaPiece: true }) // approved from "New from their website"
      await product("scarf", ["M"], { moved: "M" }) // sold or counted in Yard since
    })
    after(async () => pg.close())

    it("previews only sizes the site showed as available without a count, never touching Yard's own stock", async () => {
      const plan = await planImportedStock(db(), B)
      assert.deepEqual(plan.platforms, ["Shopify"])
      assert.equal(plan.imported, 5)
      assert.deepEqual([...plan.variants].sort(), ["p_tee_M", "p_tote_M"])
      assert.deepEqual([...plan.products].sort(), ["p_tee", "p_tote"])
      assert.deepEqual(plan.skipped, { soldOutOnSite: 2, countOnSite: 1, stockSetInYard: 2, unknown: 0 })
    })

    it("applies it: those sizes become untracked (no count invented), and a second run changes nothing", async () => {
      const done = await applyImportedStock(db(), B, await planImportedStock(db(), B))
      assert.deepEqual([...done.variants].sort(), ["p_tee_M", "p_tote_M"])
      const rows = await d.select({ id: catalogVariants.id, trackStock: catalogVariants.trackStock, onHand: catalogVariants.onHand }).from(catalogVariants).where(eq(catalogVariants.brandId, B)).orderBy(asc(catalogVariants.id))
      assert.deepEqual(
        rows.filter((r) => !r.trackStock).map((r) => r.id),
        ["p_tee_M", "p_tote_M"],
      )
      assert.ok(rows.every((r) => r.onHand === 0))
      const again = await planImportedStock(db(), B)
      assert.deepEqual(again.variants, [])
    })

    it("a site later seen sold out isn't marked", async () => {
      await d.update(catalogVariants).set({ trackStock: true }).where(eq(catalogVariants.id, "p_tote_M"))
      await d.update(catalogSitePieces).set({ change: { soldOut: true } }).where(eq(catalogSitePieces.id, "sp_tote"))
      const plan = await planImportedStock(db(), B)
      assert.ok(!plan.variants.includes("p_tote_M"))
    })
  })

  describe("holds, search order and Ask the brand on the real server modules", () => {
    let r: ChildResult
    before(() => {
      const dir = mkdtempSync(path.join(tmpdir(), "yard-sold-out-"))
      try {
        const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
          env: { ...process.env, SOLD_OUT_CHILD: "run", NODE_ENV: "test", NODE_TEST_CONTEXT: "", YARD_DATA_DIR: dir, DATABASE_URL: "" },
          encoding: "utf8",
          timeout: 240_000,
        })
        const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
        r = JSON.parse(line!) as ChildResult
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("an untracked variant can be held and sold without a count: the sale is recorded, on hand stays", () => {
      assert.equal(r.hold.ok, true)
      assert.equal(r.hold.onHandAfter, 0)
      assert.equal(r.hold.held, 0)
      assert.deepEqual(r.hold.movement, { delta: 0, note: "2 sold (stock not tracked)" })
      assert.equal(r.hold.tracked, false)
    })

    it("cart and PDP availability: untracked reads as available, sold out as 0", () => {
      assert.deepEqual(r.sellable, { v_untracked: UNTRACKED_AVAILABLE, v_out: 0, v_in: 4 })
    })

    it("search (shop, categories, search results) lists in stock first under every sort", () => {
      assert.deepEqual(r.search.default, ["p_in", "p_untracked", "p_out"])
      assert.deepEqual(r.search.priceAsc, ["p_untracked", "p_in", "p_out"])
      assert.deepEqual(r.search.priceDesc, ["p_in", "p_untracked", "p_out"])
    })

    it("Ask the brand opens a thread with the piece attached, the question as typed, and tells the brand", () => {
      assert.equal(r.ask.origin, "product")
      assert.equal(r.ask.originRef, "p_out")
      assert.equal(r.ask.topic, "availability")
      assert.equal(r.ask.kind, "product")
      assert.equal(r.ask.body, "Hi! Is the Out Tee (Size M) available, or coming back soon?")
      assert.equal(r.ask.productId, "p_out")
      assert.equal(r.ask.variantId, "v_out")
      assert.equal(r.ask.snapshot, "Out Tee")
      assert.deepEqual(r.ask.notified, ["new_message:New message from Ada Shopper:studio"])
    })

    it("the inbox's limits still apply: 5 new conversations an hour, 20 messages a minute", () => {
      assert.equal(r.limits.firstContactCapAt, 6)
      assert.equal(r.limits.perMinuteCapAt, 21)
    })
  })
} else {
  async function run(): Promise<ChildResult> {
    const { db, withTx } = await import("../db")
    const { brands: B } = await import("../db/schema/brands")
    const { catalogProducts: P, catalogVariants: V, stockMovements: SM } = await import("../db/schema/catalog")
    const { users: U } = await import("../db/schema/people")
    const { conversations, messages } = await import("../db/schema/inbox")
    const { notifications } = await import("../db/schema/platform")
    const { holdStock, commitHold } = await import("./stock")
    const { getSellableVariants } = await import("./sellable")
    const { reindexProduct, searchCatalog } = await import("../search")
    const { sendAsShopper } = await import("../inbox/service")
    const { HttpError } = await import("../http/errors")
    const d = await db()

    const brand = async (key: string) => d.insert(B).values({ id: `b_${key}`, handle: key, name: `${key} brand`, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
    await brand("so")
    const product = async (id: string, title: string, price: number, day: number, v: { id: string; onHand: number; trackStock?: boolean }) => {
      await d.insert(P).values({ id, brandId: "b_so", slug: id, title, categorySlug: "streetwear", priceMinor: price, currency: "NGN", status: "published", publishedAt: new Date(T0.getTime() + day * 86_400_000) })
      await d.insert(V).values({ id: v.id, productId: id, brandId: "b_so", sku: v.id, options: { Size: "M" }, onHand: v.onHand, trackStock: v.trackStock ?? true })
    }
    await product("p_out", "Out Tee", 1000, 9, { id: "v_out", onHand: 0 })
    await product("p_untracked", "Untracked Tee", 2000, 5, { id: "v_untracked", onHand: 0, trackStock: false })
    await product("p_in", "In Tee", 3000, 7, { id: "v_in", onHand: 4 })

    // Hold and sell 2 of the untracked variant.
    const hold = await withTx(async (tx) => holdStock(tx, { holdKey: "hk_1", lines: [{ variantId: "v_untracked", qty: 2 }] }))
    await withTx(async (tx) => commitHold(tx, "hk_1"))
    const [after] = await d.select({ onHand: V.onHand, held: V.held, trackStock: V.trackStock }).from(V).where(eq(V.id, "v_untracked"))
    const [move] = await d.select({ delta: SM.delta, note: SM.note }).from(SM).where(eq(SM.variantId, "v_untracked"))

    const sellable = Object.fromEntries((await getSellableVariants(["v_untracked", "v_out", "v_in"])).map((s) => [s.variantId, s.available]))

    for (const id of ["p_out", "p_untracked", "p_in"]) await reindexProduct(id)
    const ids = async (sort?: "price_asc" | "price_desc") => (await searchCatalog({ currency: "NGN", brandIds: ["b_so"], ...(sort ? { sort } : {}) })).items.map((i) => i.productId)
    const search = { default: await ids(), priceAsc: await ids("price_asc"), priceDesc: await ids("price_desc") }

    // Ask the brand, as the composer sends it: the piece and size attached, the prefilled question.
    const shopper = async (id: string, name: string) => {
      await d.insert(U).values({ id, kind: "shopper", name, email: `${id}@example.test`, demo: false, createdAt: new Date("2025-01-01T00:00:00Z") })
      return { kind: "shopper" as const, sessionId: `s_${id}`, userId: id, name, email: `${id}@example.test`, status: "active" as const, createdAt: new Date("2025-01-01T00:00:00Z"), demo: false }
    }
    const ada = await shopper("u_so_ada", "Ada Shopper")
    const body = askAvailabilityText("Out Tee", "Size M")
    const sent = await sendAsShopper(ada, { clientId: "c_ask_1", brandId: "b_so", kind: "product", body, productId: "p_out", variantId: "v_out", topic: "availability", origin: "product" } as never, null)
    const [conv] = await d.select().from(conversations).where(eq(conversations.id, sent.result.conversation.id))
    const [msg] = await d.select().from(messages).where(eq(messages.id, sent.result.message.id))
    const notified = (await d.select({ category: notifications.category, title: notifications.title, href: notifications.href }).from(notifications).where(eq(notifications.recipientId, "b_so"))).map((n) => `${n.category}:${n.title}:${n.href?.startsWith("/studio/inbox") ? "studio" : n.href}`)

    // Limits: a sixth new conversation in an hour, and a 21st message in a minute, are refused (429).
    const bob = await shopper("u_so_bob", "Bob Shopper")
    let firstContactCapAt = 0
    for (let i = 1; i <= 7 && !firstContactCapAt; i++) {
      await brand(`socap${i}`)
      try {
        await sendAsShopper(bob, { clientId: `c_cap_${i}`, brandId: `b_socap${i}`, kind: "text", body: "Hi! Is this available?", origin: "product" } as never, null)
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) firstContactCapAt = i
        else throw e
      }
    }
    const cyd = await shopper("u_so_cyd", "Cyd Shopper")
    let perMinuteCapAt = 0
    for (let i = 1; i <= 22 && !perMinuteCapAt; i++) {
      try {
        await sendAsShopper(cyd, { clientId: `c_min_${i}`, brandId: "b_so", kind: "text", body: `Question ${i}` } as never, null)
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) perMinuteCapAt = i
        else throw e
      }
    }

    return {
      hold: { ok: hold.ok, onHandAfter: after.onHand, held: after.held, movement: move ? { delta: move.delta, note: move.note } : null, tracked: after.trackStock },
      sellable,
      search,
      ask: {
        origin: conv.origin,
        originRef: conv.originRef,
        topic: conv.topic,
        kind: msg.kind,
        body: msg.body,
        productId: msg.productId,
        variantId: msg.variantId,
        snapshot: (msg.productSnapshot as { name?: string } | null)?.name ?? null,
        notified,
      },
      limits: { firstContactCapAt, perMinuteCapAt },
    }
  }
  run().then(
    (r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`)
      process.exit(0)
    },
    (e) => {
      process.stderr.write(`${String(e?.stack ?? e)}\n${e?.cause ? String(e.cause) : ""}`)
      process.exit(1)
    },
  )
}
