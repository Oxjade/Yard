import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { duplicateReasons, guessMarket, handleCandidates, hostLabel, planCreate, similarHandles, suggestHandle, type CreateState, type CreateWish } from "../../lib/from-website"
import { brands } from "../db/schema/brands"
import { catalogImports } from "../db/schema/imports"
import { brandFromHtml, locationOf } from "./importer/adapters/common"
import { attachImport, chooseSiteImages } from "./from-website-db"

/* Create brand from website (docs/IMPORTER.md › Create brand from website): the handle suggestion,
 * the place and currency guesses, duplicate detection, the idempotent create plan with its
 * switches, and the two writes it adds on a real (in-memory) database with the migrations. */

const LABELD_HOME = readFileSync(path.join(__dirname, "importer/fixtures/labeld/home.html"), "utf8")

describe("handle suggestion", () => {
  it("takes the shop from a platform subdomain", () => {
    assert.equal(suggestHandle("https://813israw.labeld.app/", "Eight One Three"), "813israw")
    assert.equal(suggestHandle("https://kachi-studio.myshopify.com/", null), "kachi-studio")
    assert.equal(hostLabel("shop.labeld.app"), null)
  })
  it("takes the brand's own name from its domain, skipping shop. and www. and country second levels", () => {
    assert.equal(suggestHandle("https://www.kachistudio.com/", "Kachi Studio"), "kachistudio")
    assert.equal(suggestHandle("https://shop.kachistudio.com.ng/", "Kachi Studio"), "kachistudio")
    assert.equal(suggestHandle("https://kachi.co.uk/collections/all", null), "kachi")
  })
  it("falls back to the name when the domain gives too little", () => {
    assert.equal(suggestHandle("https://ab.ng/", "Ọ̀ṣun Àṣẹ & Co"), "osun-ase-and-co")
    assert.ok(suggestHandle("https://x.io/", null).length >= 3)
  })
  it("offers variants within 30 characters when the first is taken", () => {
    const c = handleCandidates("kachi")
    assert.deepEqual(c.slice(0, 4), ["kachi", "kachi-studio", "kachi-official", "kachi-yard"])
    assert.ok(c.includes("kachi-2"))
    for (const h of handleCandidates("a-very-long-brand-name-for-yard-x")) assert.ok(h.length <= 30 && !h.endsWith("-"), h)
  })
})

describe("place and currency guesses", () => {
  it("reads the saved Labeld shop: Lagos, Nigeria, NGN", () => {
    const site = brandFromHtml(LABELD_HOME, "https://813israw.labeld.app/")
    const g = guessMarket({ siteUrl: "https://813israw.labeld.app/", platform: "labeld", location: site.location, productCurrencies: ["NGN", "NGN"] })
    assert.equal(g.country, "NG")
    assert.equal(g.currency, "NGN")
    assert.match(g.why.join(" "), /Labeld/)
    assert.equal(site.location, "Minimal Street · Lagos State, Nigeria")
    assert.equal(g.city, "Lagos")
  })
  it("names the city only when the site does", () => {
    assert.equal(locationOf("<main><h1>Kachi</h1><p>Minimal Street · Lagos State, Nigeria</p></main>"), "Minimal Street · Lagos State, Nigeria")
    const g = guessMarket({ siteUrl: "https://kachi.labeld.app/", platform: "labeld", location: null, productCurrencies: [] })
    assert.deepEqual([g.country, g.currency, g.city], ["NG", "NGN", null])
    assert.equal(guessMarket({ siteUrl: "https://kachi.labeld.app/", platform: "labeld", location: "Minimal Street · Lagos State, Nigeria", productCurrencies: [] }).city, "Lagos")
  })
  it("prefers the JSON-LD address, then the products' currency, then the domain's country", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Ama","address":{"@type":"PostalAddress","addressLocality":"Accra","addressCountry":"GH"}}</script>`
    assert.equal(locationOf(html, [{ "@type": "Organization", address: { addressLocality: "Accra", addressCountry: "GH" } }]), "Accra, GH")
    assert.deepEqual(guessMarket({ siteUrl: "https://ama.com/", platform: "shopify", location: "Accra, GH", productCurrencies: ["GHS"] }), { country: "GH", currency: "GHS", city: "Accra", why: ["The site says Accra", "Products are priced in GHS"] })
    assert.equal(guessMarket({ siteUrl: "https://ama.co.ke/", platform: "generic", location: null, productCurrencies: [] }).currency, "KES")
    assert.equal(guessMarket({ siteUrl: "https://ama.com/", platform: "shopify", location: null, productCurrencies: ["USD", "USD", "GBP"] }).country, "US")
  })
})

describe("duplicate detection", () => {
  const brand = { id: "b1", name: "Kachi Studio", handle: "kachi-studio", founding: true, sites: [] as string[] }
  it("flags the same website, a similar handle and the same name", () => {
    assert.deepEqual(duplicateReasons({ site: "https://www.kachi.com/", handle: "zzz", name: "Other" }, { ...brand, sites: ["https://kachi.com/products"] }), ["site"])
    assert.deepEqual(duplicateReasons({ site: null, handle: "kachistudio", name: "Another" }, brand), ["handle"])
    assert.deepEqual(duplicateReasons({ site: null, handle: "zzz", name: "KACHI  studio" }, brand), ["name"])
    assert.deepEqual(duplicateReasons({ site: null, handle: "kachi-studio", name: "Kachi Studio" }, brand), ["handle", "name"])
  })
  it("doesn't flag what merely shares a few letters", () => {
    assert.equal(similarHandles("kachi", "kachina-lagos"), true)
    assert.equal(similarHandles("ama", "amara"), false)
    assert.equal(similarHandles("813israw", "813isra"), true)
    assert.equal(similarHandles("osun", "osun-ase"), false)
    assert.deepEqual(duplicateReasons({ site: "https://other.com/", handle: "zeta", name: "Zeta" }, brand), [])
  })
})

describe("the create plan: idempotent, with the switches applied", () => {
  const wish: CreateWish = { goLiveOnClaim: true, watch: true, foundingBadge: true, products: 4, logo: true, banner: true }
  const fresh: CreateState = { brand: null, import: { brandId: null, status: "scanned" }, watch: null }
  it("does every step the first time", () => {
    assert.deepEqual(planCreate(fresh, wish), { createBrand: true, attach: true, patch: {}, startImport: true, watch: true, conflict: null })
  })
  it("does nothing again once it's all done (a double click or a retry)", () => {
    const done: CreateState = { brand: { id: "b1", goLiveOnClaim: true, foundingBadge: true }, import: { brandId: "b1", status: "importing" }, watch: { enabled: true } }
    assert.deepEqual(planCreate(done, wish), { createBrand: false, attach: false, patch: {}, startImport: false, watch: false, conflict: null })
  })
  it("finishes only what's missing after a crash between steps", () => {
    const half: CreateState = { brand: { id: "b1", goLiveOnClaim: true, foundingBadge: true }, import: { brandId: "b1", status: "scanned" }, watch: null }
    assert.deepEqual(planCreate(half, wish), { createBrand: false, attach: false, patch: {}, startImport: true, watch: true, conflict: null })
  })
  it("writes a switch turned off, once", () => {
    const off = { ...wish, goLiveOnClaim: false, foundingBadge: false, watch: false }
    assert.deepEqual(planCreate(fresh, off).patch, { goLiveOnClaim: false, foundingBadge: false })
    assert.equal(planCreate(fresh, off).watch, false)
    const applied: CreateState = { brand: { id: "b1", goLiveOnClaim: false, foundingBadge: false }, import: { brandId: "b1", status: "importing" }, watch: null }
    assert.deepEqual(planCreate(applied, off).patch, {})
  })
  it("skips the import when there's nothing to import, and refuses a scan another brand used", () => {
    assert.equal(planCreate(fresh, { ...wish, products: 0, logo: false, banner: false }).startImport, false)
    assert.equal(planCreate(fresh, { ...wish, products: 0, logo: true, banner: false }).startImport, true)
    assert.match(planCreate({ ...fresh, import: { brandId: "b9", status: "importing" } }, wish).conflict ?? "", /another brand/)
  })
})

describe("the writes (PGlite with the migrations)", () => {
  let pg: PGlite
  let d: ReturnType<typeof drizzle>
  const scan = async (id: string) => {
    await d.insert(catalogImports).values({ id, brandId: null, sourceUrl: "https://813israw.labeld.app/", status: "scanned", consentAt: new Date(), createdBy: "u_owner", brand: { name: "Eight One Three", logo: "https://ik.imagekit.io/labeld/a.jpg", banner: null } })
  }
  before(async () => {
    pg = new PGlite()
    d = drizzle(pg)
    await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
    // The rows below reference users this test doesn't create.
    await d.execute(sql`set session_replication_role = replica`)
  })
  after(async () => {
    await pg?.close()
  })

  it("keeps a scan with no brand yet (migration 0025)", async () => {
    await scan("imp_a")
    const [r] = await d.select().from(catalogImports).where(eq(catalogImports.id, "imp_a"))
    assert.equal(r.brandId, null)
  })

  it("attaches a scan to one brand only; repeating it for that brand is fine", async () => {
    await scan("imp_b")
    assert.deepEqual(await attachImport(d, { importId: "imp_b", brandId: "b_one" }), { ok: true })
    assert.deepEqual(await attachImport(d, { importId: "imp_b", brandId: "b_one" }), { ok: true })
    assert.deepEqual(await attachImport(d, { importId: "imp_b", brandId: "b_two" }), { ok: false, brandId: "b_one" })
    const [r] = await d.select().from(catalogImports).where(eq(catalogImports.id, "imp_b"))
    assert.equal(r.brandId, "b_one")
  })

  it("puts the chosen logo and banner on the scan, only before the import starts", async () => {
    await scan("imp_c")
    assert.equal(await chooseSiteImages(d, { importId: "imp_c", logo: "https://ik.imagekit.io/labeld/p1.jpg", banner: "https://ik.imagekit.io/labeld/b.jpg" }), true)
    const [r] = await d.select().from(catalogImports).where(eq(catalogImports.id, "imp_c"))
    assert.deepEqual(r.brand, { name: "Eight One Three", logo: "https://ik.imagekit.io/labeld/p1.jpg", banner: "https://ik.imagekit.io/labeld/b.jpg" })
    await d.update(catalogImports).set({ status: "importing" }).where(eq(catalogImports.id, "imp_c"))
    assert.equal(await chooseSiteImages(d, { importId: "imp_c", logo: null, banner: null }), false)
  })

  it("one brand per (admin, request key): a second insert with the key is refused, so a replay returns the first", async () => {
    const row = { handle: "kachi", name: "Kachi", city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["fashion"], joinedAt: "2026-11-19", followersBase: 0, timeZone: "Africa/Lagos", founding: true, claimStatus: "unclaimed", createdBy: "u_owner", creationKey: "key-12345678" }
    await d.insert(brands).values({ id: "b_k1", ...row })
    await assert.rejects(() => d.insert(brands).values({ id: "b_k2", ...row, handle: "kachi-2" }), (e: { cause?: { code?: string }; code?: string }) => (e.cause?.code ?? e.code) === "23505")
    const mine = await d.select({ id: brands.id }).from(brands).where(eq(brands.creationKey, "key-12345678"))
    assert.deepEqual(mine, [{ id: "b_k1" }])
  })
})
