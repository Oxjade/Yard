import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { ImportProductDto } from "../../../lib/api/contracts/imports"
import { websitePiecesCopy } from "../../../lib/brand-emails"
import { catalogSitePieces } from "../../db/schema/imports"
import { FetchRefused } from "./fetch"
import { claimAllPieces, claimPiece, finishPiece, releasePiece, skipPiece } from "./pieces-db"
import { scanSite, siteFetcher, type Get } from "./scan"
import { backoff, baselineOf, changeOf, classifyScan, jitterMs, newPiecesLine, nextAfterSuccess, SeenIndex, watchEveryHours, watchPerRun, WATCH_PAUSE_AFTER, type KnownPiece } from "./watch-rules"
import { urlKey } from "./normalize"

/* Website watch (docs/IMPORTER.md › Watching a website): new-piece detection against the saved
 * 813israw.labeld.app pages, "seen" never coming back, change flags, backoff, and first-wins
 * locking on a real (in-memory) database with the migrations applied. */

const FIX = path.join(__dirname, "fixtures")
const read = (p: string) => readFileSync(path.join(FIX, p), "utf8")
const HTML = "text/html; charset=utf-8"
const LABELD = "https://813israw.labeld.app"
const DROPS = ["RG51ZHs89DpAevzvhTDk", "yH5muf5m08vjopDbrqvo", "iYwsRgjWQNbQqEe0rjVD", "AdvYjeDno2TknGUnnjaU"]
const NORM = { brandCurrency: "NGN", brandCategory: "streetwear", categories: [{ slug: "streetwear", subcategories: ["Hoodies", "T-shirts", "Shirts", "Outerwear", "Trousers"] }] }
const NONE = { titles: [], sourceUrls: [] }

function labeldSite() {
  const asked: string[] = []
  const pages: Record<string, [string, string]> = {
    [`${LABELD}/`]: [HTML, read("labeld/home.html")],
    [`${LABELD}/sitemap.xml`]: ["application/xml", read("labeld/sitemap.xml")],
    ...Object.fromEntries(DROPS.map((id) => [`${LABELD}/drops/${id}`, [HTML, read(`labeld/drop-${id}.html`)] as [string, string]])),
  }
  const get: Get = async (url) => {
    asked.push(url)
    const hit = pages[url]
    if (!hit) throw new FetchRefused("status", "404", 404)
    return { url, status: 200, contentType: hit[0], body: Buffer.from(hit[1]) }
  }
  return { fetch: siteFetcher(get, { delayMs: 0 }), asked }
}

const drop = (id: string) => `${LABELD}/drops/${id}`
const known = (id: string, status: KnownPiece["status"], over: Partial<KnownPiece> = {}): KnownPiece => ({ id: `sp_${id}`, urlKey: urlKey(drop(id)), sourceId: null, status, baseline: null, change: null, ...over })
const NOW = new Date("2026-11-19T10:00:00Z")

let scanned: ImportProductDto[] = []
before(async () => {
  const { fetch } = labeldSite()
  scanned = (await scanSite(LABELD, { fetch, normalize: NORM, existing: NONE })).products
})

describe("new pieces", () => {
  it("finds the 4 products of the saved shop", () => {
    assert.equal(scanned.length, 4)
  })

  it("an import of 2 of 4 makes nothing new: the 2 unticked ones are seen and passed over", () => {
    const seen = new SeenIndex([known(DROPS[0], "imported"), known(DROPS[1], "imported"), known(DROPS[2], "ignored"), known(DROPS[3], "ignored")])
    const c = classifyScan(scanned, seen, { baseline: false, now: NOW })
    assert.equal(c.fresh.length, 0)
    assert.equal(c.seen.length, 4)
  })

  it("a product never seen is new (waiting), whatever was seen before", () => {
    const seen = new SeenIndex([known(DROPS[0], "imported"), known(DROPS[1], "imported")])
    const c = classifyScan(scanned, seen, { baseline: false, now: NOW })
    assert.deepEqual(c.fresh.map((f) => [urlKey(f.product.sourceUrl), f.ignoredBecause]).sort(), [DROPS[2], DROPS[3]].map((id) => [urlKey(drop(id)), null]).sort())
  })

  it("matches on the source id too: a product that moved to a new address isn't new", () => {
    const p = scanned[0]
    assert.ok(p.sourceId)
    const seen = new SeenIndex([{ ...known("old-address", "imported"), urlKey: "813israw.labeld.app/old/address", sourceId: p.sourceId }])
    assert.equal(seen.find(p)?.id, "sp_old-address")
  })

  it("the first check with nothing seen records the site as it is (nothing offered)", () => {
    const c = classifyScan(scanned, new SeenIndex([]), { baseline: true, now: NOW })
    assert.equal(c.fresh.length, 4)
    assert.ok(c.fresh.every((f) => f.ignoredBecause === "On the site when watching started."))
  })

  it("a new product with the name of one already in Yard is recorded, not offered", () => {
    const dup = { ...scanned[2], duplicate: { reason: "Same name as “X” in the catalogue." } }
    const c = classifyScan([dup], new SeenIndex([known(DROPS[0], "imported")]), { baseline: false, now: NOW })
    assert.equal(c.fresh[0].ignoredBecause, "Same name as “X” in the catalogue.")
  })
})

describe("seen pieces never come back", () => {
  for (const status of ["skipped", "ignored", "waiting", "approving", "approved", "imported"] as const) {
    it(`a ${status} piece is not new again`, () => {
      const c = classifyScan(scanned, new SeenIndex(DROPS.map((id) => known(id, status))), { baseline: false, now: NOW })
      assert.equal(c.fresh.length, 0)
    })
  }

  it("a check skips the pages of pieces passed over or waiting, and re-reads pieces in Yard", async () => {
    const seen = new SeenIndex([known(DROPS[0], "imported"), known(DROPS[1], "skipped"), known(DROPS[2], "ignored")])
    const { fetch, asked } = labeldSite()
    let skipped = 0
    const out = await scanSite(LABELD, { fetch, normalize: NORM, existing: NONE, platform: "labeld", skipPage: (u) => (seen.skips(u) ? (skipped++, true) : false) })
    assert.equal(skipped, 2)
    assert.ok(!asked.includes(drop(DROPS[1])) && !asked.includes(drop(DROPS[2])))
    assert.ok(asked.includes(drop(DROPS[0])) && asked.includes(drop(DROPS[3])))
    // Home, sitemap and the two pages it needed: a few requests, not the whole shop again.
    assert.equal(asked.length, 4)
    const c = classifyScan(out.products, seen, { baseline: false, now: NOW })
    assert.deepEqual(c.fresh.map((f) => urlKey(f.product.sourceUrl)), [urlKey(drop(DROPS[3]))])
  })

  it("a check pinned to its platform never falls through to another adapter", async () => {
    const seen = new SeenIndex(DROPS.map((id) => known(id, "skipped")))
    const { fetch, asked } = labeldSite()
    const out = await scanSite(LABELD, { fetch, normalize: NORM, existing: NONE, platform: "labeld", skipPage: (u) => seen.skips(u) })
    assert.equal(out.products.length, 0)
    assert.equal(out.platform, "labeld")
    assert.deepEqual(asked, [`${LABELD}/`, `${LABELD}/sitemap.xml`])
  })
})

describe("watching a Bumpa shop (saved responses of themangabookshop981.bumpa.shop)", () => {
  const B = "https://themangabookshop981.bumpa.shop"
  const LIST = `${B}/storefront/products?limit=200&page=1`
  const listing = JSON.parse(read("bumpa/products.json"))
  const tee = JSON.parse(read("bumpa/product-variant-constructed.json")).product
  const teeUrl = `${B}/storefront/products/5590001?with_variations=1`
  /** The shop with the constructed variant tee added at the top of the listing (the newest first, as Bumpa lists). */
  function bumpaSite(withTee: boolean) {
    const asked: string[] = []
    const data = withTee ? [{ ...tee, variations: undefined, tags: undefined }, ...listing.products.data] : listing.products.data
    const pages: Record<string, [string, string]> = {
      [`${B}/`]: [HTML, read("bumpa/home.html")],
      [LIST]: ["application/json", JSON.stringify({ products: { ...listing.products, data, total: data.length } })],
      [teeUrl]: ["application/json", read("bumpa/product-variant-constructed.json")],
    }
    const get: Get = async (url) => {
      asked.push(url)
      const hit = pages[url]
      if (!hit) throw new FetchRefused("status", "404", 404)
      return { url, status: 200, contentType: hit[0], body: Buffer.from(hit[1]) }
    }
    return { fetch: siteFetcher(get, { delayMs: 0 }), asked }
  }
  const page = (slug: string, id: number) => `${B}/products/${slug}/${id}`
  const shopPieces = (): KnownPiece[] => listing.products.data.map((p: { slug: string; id: number }) => ({ id: `sp_${p.id}`, urlKey: urlKey(page(p.slug, p.id)), sourceId: String(p.id), status: "ignored", baseline: null, change: null }))
  const seenAll = () => new SeenIndex(shopPieces())

  it("a check is the home page and one listing request; a new piece is found, with its variations", async () => {
    const seen = seenAll()
    const { fetch, asked } = bumpaSite(true)
    let skipped = 0
    const out = await scanSite(B, { fetch, normalize: NORM, existing: NONE, platform: "bumpa", skipPage: (u) => (seen.skips(u) ? (skipped++, true) : false) })
    assert.equal(skipped, 5)
    assert.deepEqual(asked, [`${B}/`, LIST, teeUrl])
    const c = classifyScan(out.products, seen, { baseline: false, now: NOW })
    assert.deepEqual(
      c.fresh.map((f) => f.product.title),
      ["One Piece Logo Tee"],
    )
    assert.equal(c.fresh[0].product.variants.length, 4)
  })

  it("nothing new: two requests, and a known piece with variations isn't read again", async () => {
    const seen = new SeenIndex([...shopPieces(), { id: "sp_tee", urlKey: urlKey(page("one-piece-logo-tee", 5590001)), sourceId: "5590001", status: "skipped", baseline: null, change: null }])
    const { fetch, asked } = bumpaSite(true)
    const out = await scanSite(B, { fetch, normalize: NORM, existing: NONE, platform: "bumpa", skipPage: (u) => seen.skips(u) })
    assert.equal(out.products.length, 0)
    assert.equal(out.platform, "bumpa")
    assert.deepEqual(asked, [`${B}/`, LIST])
  })

  it("a piece in Yard is re-read from the listing and its price change flagged", async () => {
    const batman = listing.products.data[0]
    const seen = new SeenIndex([{ id: "sp_b", urlKey: urlKey(page(batman.slug, batman.id)), sourceId: String(batman.id), status: "imported", baseline: { priceMinor: 3_000_000, currency: "NGN", available: false }, change: null }])
    const { fetch } = bumpaSite(false)
    const out = await scanSite(B, { fetch, normalize: NORM, existing: NONE, platform: "bumpa", skipPage: (u) => seen.skips(u) })
    const c = classifyScan(out.products, seen, { baseline: false, now: NOW })
    assert.deepEqual(c.changes.find((x) => x.id === "sp_b")?.change?.price, { from: 3_000_000, to: 3_480_000, currency: "NGN" })
  })
})

describe("changes on their site (flagged, never applied)", () => {
  const base = { priceMinor: 1700000, currency: "NGN", available: true }
  it("flags a new price in the same currency", () => {
    assert.deepEqual(changeOf(base, { priceMinor: 1500000, currency: "NGN", availability: "in_stock" }, NOW), { at: NOW.toISOString(), price: { from: 1700000, to: 1500000, currency: "NGN" } })
  })
  it("flags a sell-out", () => {
    assert.deepEqual(changeOf(base, { priceMinor: 1700000, currency: "NGN", availability: "out_of_stock" }, NOW), { at: NOW.toISOString(), soldOut: true })
  })
  it("ignores a currency switch and an unchanged product", () => {
    assert.equal(changeOf(base, { priceMinor: 1500, currency: "USD", availability: "in_stock" }, NOW), null)
    assert.equal(changeOf(base, { priceMinor: 1700000, currency: "NGN", availability: "unknown" }, NOW), null)
    assert.equal(changeOf(null, { priceMinor: 1, currency: "NGN", availability: "out_of_stock" }, NOW), null)
  })
  it("only pieces in Yard are compared; a flag clears when the site goes back, and isn't rewritten when seen again", () => {
    const p = scanned[0]
    const cheaper = { ...p, priceMinor: (p.priceMinor ?? 0) - 100 }
    const b = baselineOf(p)
    const flagged = classifyScan([cheaper], new SeenIndex([known(DROPS[0], "imported", { baseline: b })]), { baseline: false, now: NOW })
    assert.equal(flagged.changes.length, 1)
    assert.equal(flagged.changes[0].change?.price?.to, cheaper.priceMinor)
    const again = classifyScan([cheaper], new SeenIndex([known(DROPS[0], "imported", { baseline: b, change: flagged.changes[0].change })]), { baseline: false, now: new Date(NOW.getTime() + 3600_000) })
    assert.equal(again.changes.length, 0)
    const back = classifyScan([p], new SeenIndex([known(DROPS[0], "imported", { baseline: b, change: flagged.changes[0].change })]), { baseline: false, now: NOW })
    assert.deepEqual(back.changes, [{ id: `sp_${DROPS[0]}`, change: null }])
    const ignored = classifyScan([cheaper], new SeenIndex([known(DROPS[0], "ignored", { baseline: b })]), { baseline: false, now: NOW })
    assert.equal(ignored.changes.length, 0)
  })
})

describe("schedule and backoff", () => {
  it("checks every 6 hours unless YARD_IMPORTER_WATCH_HOURS says otherwise", () => {
    assert.equal(watchEveryHours(undefined), 6)
    assert.equal(watchEveryHours("12"), 12)
    assert.equal(watchEveryHours("0"), 6)
    assert.equal(watchEveryHours("nope"), 6)
    assert.equal(watchPerRun(undefined), 4)
    assert.equal(watchPerRun("10"), 10)
  })
  it("spreads brands within ±10 % of the interval", () => {
    const every = 6 * 3600_000
    const a = nextAfterSuccess(NOW, "b_one", 1, 6).getTime() - NOW.getTime()
    const b = nextAfterSuccess(NOW, "b_two", 1, 6).getTime() - NOW.getTime()
    assert.notEqual(a, b)
    for (const x of [a, b]) assert.ok(Math.abs(x - every) <= every * 0.1)
    assert.equal(jitterMs("b_one", 1, every), jitterMs("b_one", 1, every))
  })
  it("backs off 6, 12, 24, 48 hours, then pauses", () => {
    const hours = [1, 2, 3, 4].map((f) => (backoff(f, NOW, 6).next.getTime() - NOW.getTime()) / 3600_000)
    assert.deepEqual(hours, [6, 12, 24, 48])
    assert.ok([1, 2, 3, 4].every((f) => !backoff(f, NOW, 6).pause))
    assert.equal(backoff(WATCH_PAUSE_AFTER, NOW, 6).pause, true)
  })
})

describe("the brand's email", () => {
  it("says how many pieces are waiting, with the opt-out link", () => {
    const c = websitePiecesCopy({ brand: "813 Is Raw", count: 3 })
    assert.equal(c.paragraphs[0], "3 new pieces from your website are waiting. Add them to Yard in one tap.")
    assert.equal(c.paragraphs[0], newPiecesLine(3))
    assert.equal(c.action?.url, "/studio/products#from-website")
    assert.ok(c.footerLink)
    assert.equal(websitePiecesCopy({ brand: "X", count: 1 }).subject, "1 new piece from your website is waiting")
  })
})

/* ---------- first wins, on a database ---------- */

describe("first wins (catalog_site_pieces, PGlite with the migrations)", () => {
  let pg: PGlite
  let d: ReturnType<typeof drizzle>
  const T0 = new Date("2026-11-19T10:00:00Z")
  const admin = { side: "admin" as const, userId: "u_admin", userName: "Ife" }
  const brand = { side: "brand" as const, userId: "u_owner", userName: "Tobi" }
  let n = 0
  const piece = async (status = "waiting") => {
    const id = `sp_t${++n}`
    await d.insert(catalogSitePieces).values({ id, brandId: "b_raw", urlKey: `x/${id}`, sourceUrl: `https://x/${id}`, title: "Wild West Tee", status, origin: "watch", product: {}, firstSeenAt: T0, lastSeenAt: T0, updatedAt: T0 })
    return id
  }
  const statusOf = async (id: string) => (await d.select().from(catalogSitePieces).where(eq(catalogSitePieces.id, id)))[0]

  before(async () => {
    pg = new PGlite()
    d = drizzle(pg)
    await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
    // The rows below reference a brand and users this test doesn't create.
    await d.execute(sql`set session_replication_role = replica`)
  })
  after(async () => {
    await pg?.close()
  })

  it("Yard approves first: the brand can't add or skip it, and only Yard can finish", async () => {
    const id = await piece()
    assert.ok(await claimPiece(d, { id, brandId: "b_raw", now: T0, ...admin }))
    assert.equal(await claimPiece(d, { id, brandId: "b_raw", now: T0, ...brand }), null)
    assert.equal(await skipPiece(d, { id, brandId: "b_raw", now: T0, ...brand }), null)
    assert.equal(await finishPiece(d, { id, side: "brand", now: T0, productId: null }), null)
    assert.ok(await finishPiece(d, { id, side: "admin", now: T0 }))
    assert.equal((await statusOf(id)).status, "approved")
    assert.equal(await claimPiece(d, { id, brandId: "b_raw", now: new Date(T0.getTime() + 3600_000), ...brand }), null)
  })

  it("the brand says Not this one first: Yard can't approve it, and it stays skipped", async () => {
    const id = await piece()
    assert.ok(await skipPiece(d, { id, brandId: "b_raw", now: T0, ...brand }))
    assert.equal(await claimPiece(d, { id, brandId: "b_raw", now: T0, ...admin }), null)
    assert.equal(await skipPiece(d, { id, brandId: "b_raw", now: T0, ...admin }), null)
    const r = await statusOf(id)
    assert.equal(r.status, "skipped")
    assert.equal(r.decidedKind, "brand")
  })

  it("two taps at once: exactly one wins", async () => {
    const id = await piece()
    const [a, b] = await Promise.all([claimPiece(d, { id, brandId: "b_raw", now: T0, ...admin }), claimPiece(d, { id, brandId: "b_raw", now: T0, ...brand })])
    assert.equal([a, b].filter(Boolean).length, 1)
  })

  it("an interrupted approval can be taken over once its claim ran out, and the first claimant can't finish then", async () => {
    const id = await piece()
    assert.ok(await claimPiece(d, { id, brandId: "b_raw", now: T0, ...admin, leaseMs: 1000 }))
    assert.equal(await claimPiece(d, { id, brandId: "b_raw", now: new Date(T0.getTime() + 500), ...brand }), null)
    assert.ok(await claimPiece(d, { id, brandId: "b_raw", now: new Date(T0.getTime() + 5000), ...brand }))
    // Yard's (slow) approval comes back: it no longer holds the piece, so its transaction must roll back.
    assert.equal(await finishPiece(d, { id, side: "admin", now: T0 }), null)
    assert.ok(await finishPiece(d, { id, side: "brand", now: T0, productId: null }))
  })

  it("a failed approval gives the piece back, with why", async () => {
    const id = await piece()
    await claimPiece(d, { id, brandId: "b_raw", now: T0, ...brand })
    await releasePiece(d, { id, side: "brand", now: T0, error: "Photo 1: the site answered 404." })
    const r = await statusOf(id)
    assert.equal(r.status, "waiting")
    assert.equal(r.reason, "Photo 1: the site answered 404.")
    assert.ok(await claimPiece(d, { id, brandId: "b_raw", now: T0, ...admin }))
  })

  it("Approve all takes only the waiting pieces of that brand", async () => {
    await d.delete(catalogSitePieces)
    const w1 = await piece()
    const w2 = await piece()
    const s = await piece("skipped")
    await d.insert(catalogSitePieces).values({ id: "sp_other", brandId: "b_other", urlKey: "x/other", sourceUrl: "https://x/other", title: "Other", status: "waiting", origin: "watch", firstSeenAt: T0, lastSeenAt: T0, updatedAt: T0 })
    const taken = await claimAllPieces(d, { brandId: "b_raw", now: T0, ...admin })
    assert.deepEqual(taken.map((t) => t.id).sort(), [w1, w2].sort())
    assert.equal((await statusOf(s)).status, "skipped")
    assert.equal((await statusOf("sp_other")).status, "waiting")
  })

  it("one row per address per brand: a seen piece can't be recorded twice", async () => {
    await assert.rejects(d.insert(catalogSitePieces).values({ id: "sp_dupe", brandId: "b_raw", urlKey: "x/sp_t1", sourceUrl: "https://x/sp_t1", title: "Again", status: "waiting", origin: "watch" }).then(() => d.insert(catalogSitePieces).values({ id: "sp_dupe2", brandId: "b_raw", urlKey: "x/sp_t1", sourceUrl: "https://x/sp_t1", title: "Again", status: "waiting", origin: "watch" })))
  })
})
