import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { VisibilityBrand, VisibilityProduct } from "../page-visibility"
import { FEED_PAGE_SIZE, feedEligible, feedId, feedItemsFor, feedPage, googleFeedXml, productsJson, xmlText, type FeedItem } from "./feed"
import type { SeoProductInput } from "./json-ld"
import { newest, sitemapIndexXml, sitemapPart, sitemapParts, SITEMAP_LIMIT, urlsetXml } from "./sitemap"

const base = "https://yardstore.space"
const now = new Date("2026-11-22T12:00:00Z")

const product = (over: Partial<SeoProductInput> = {}): SeoProductInput => ({
  slug: "heavy-hoodie",
  name: "Heavy Hoodie",
  description: "450gsm loopback cotton & a <b>big</b> hood.",
  images: [{ src: "/api/media/m1" }, { src: "/api/media/m2" }],
  currency: "NGN",
  priceMinor: 4_500_000,
  compareAtMinor: null,
  category: { slug: "streetwear", name: "Streetwear" },
  subcategory: "Hoodies",
  variants: [
    { sku: "HH-S", options: { Size: "S", Colour: "Black" }, priceMinor: 4_500_000, available: 3 },
    { sku: "HH-M", options: { Size: "M", Colour: "Black" }, priceMinor: 4_500_000, available: 0 },
  ],
  brand: { name: "Lagos Static", handle: "lagos-static", city: "Lagos", country: "NG" },
  forSale: true,
  releaseAt: null,
  shipping: [{ countries: ["NG"], rateMinor: 250_000, currency: "NGN", handling: [1, 3], transit: [1, 4] }],
  ...over,
})

describe("feed eligibility (on top of productPublicWhere)", () => {
  const live: VisibilityProduct = { status: "published", publishAt: null, moderationStatus: "ok" }
  const ordinary: VisibilityBrand = { founding: false, launchedAt: null, reviewStatus: "approved" }
  const ok = { product: live, brand: ordinary, forSale: true, variants: 1, images: 1 }

  it("a published piece of a listed brand that sells is in", () => {
    assert.equal(feedEligible(ok, now), true)
    assert.equal(feedEligible({ ...ok, brand: { founding: true, launchedAt: new Date("2026-11-01T00:00:00Z"), reviewStatus: "approved" } }, now), true)
  })

  it("drafts, archived, not-yet-due and moderation-hidden pieces are out", () => {
    assert.equal(feedEligible({ ...ok, product: { ...live, status: "draft" } }, now), false)
    assert.equal(feedEligible({ ...ok, product: { ...live, status: "archived" } }, now), false)
    assert.equal(feedEligible({ ...ok, product: { status: "scheduled", publishAt: new Date("2026-12-01T00:00:00Z"), moderationStatus: "ok" } }, now), false)
    assert.equal(feedEligible({ ...ok, product: { ...live, moderationStatus: "hidden" } }, now), false)
  })

  it("an opens-soon piece (founding brand not launched) is out", () => {
    assert.equal(feedEligible({ ...ok, brand: { founding: true, launchedAt: null, reviewStatus: "approved" } }, now), false)
  })

  it("restricted, suspended and refused-sample brands are out", () => {
    assert.equal(feedEligible({ ...ok, brand: { ...ordinary, reviewStatus: "restricted" } }, now), false)
    assert.equal(feedEligible({ ...ok, brand: { ...ordinary, reviewStatus: "suspended" } }, now), false)
    assert.equal(feedEligible({ ...ok, brand: { ...ordinary, sample: true } }, now), false)
  })

  it("a brand that isn't selling yet, a piece with no variant or no photo is out", () => {
    assert.equal(feedEligible({ ...ok, forSale: false }, now), false)
    assert.equal(feedEligible({ ...ok, variants: 0 }, now), false)
    assert.equal(feedEligible({ ...ok, images: 0 }, now), false)
  })
})

describe("feed items", () => {
  it("one item per variant, grouped, with Merchant Center's fields", () => {
    const items = feedItemsFor(base, product(), now)
    assert.equal(items.length, 2)
    const [s, m] = items
    assert.equal(s.id, "lagos-static-HH-S")
    assert.equal(s.itemGroupId, "heavy-hoodie")
    assert.equal(s.title, "Heavy Hoodie (Size S, Black)")
    assert.equal(s.link, "https://yardstore.space/products/heavy-hoodie")
    assert.equal(s.imageLink, "https://yardstore.space/api/media/m1")
    assert.deepEqual(s.additionalImageLinks, ["https://yardstore.space/api/media/m2"])
    assert.equal(s.availability, "in_stock")
    assert.equal(m.availability, "out_of_stock")
    assert.deepEqual(s.price, { value: "45000.00", currency: "NGN" })
    assert.equal(s.salePrice, null)
    assert.equal(s.brand, "Lagos Static")
    assert.equal(s.condition, "new")
    assert.equal(s.productType, "Streetwear > Hoodies")
    assert.equal(s.googleProductCategory, "Apparel & Accessories > Clothing")
    assert.equal(s.size, "S")
    assert.equal(s.color, "Black")
    assert.deepEqual(s.shipping, [{ country: "NG", price: "2500.00", currency: "NGN", minHandlingDays: 1, maxHandlingDays: 3, minTransitDays: 1, maxTransitDays: 4 }])
  })

  it("a single piece has no item group; a compare-at price becomes price with sale_price", () => {
    const [item] = feedItemsFor(base, product({ compareAtMinor: 6_000_000, variants: [{ sku: "ONE", options: {}, priceMinor: 4_500_000, available: 1 }] }), now)
    assert.equal(item.itemGroupId, null)
    assert.equal(item.title, "Heavy Hoodie")
    assert.deepEqual(item.price, { value: "60000.00", currency: "NGN" })
    assert.deepEqual(item.salePrice, { value: "45000.00", currency: "NGN" })
  })

  it("a category without a safe Google mapping gets none; an upcoming drop is a pre-order with its date", () => {
    const [item] = feedItemsFor(
      base,
      product({ category: { slug: "technology", name: "Technology" }, releaseAt: "2026-12-01T18:00:00.000Z", variants: [{ sku: "T", options: {}, priceMinor: 100, available: 4 }] }),
      now,
    )
    assert.equal(item.googleProductCategory, null)
    assert.equal(item.availability, "preorder")
    assert.equal(item.availabilityDate, "2026-12-01T18:00:00.000Z")
  })

  it("no photo or no variant: no item", () => {
    assert.deepEqual(feedItemsFor(base, product({ images: [] }), now), [])
    assert.deepEqual(feedItemsFor(base, product({ variants: [] }), now), [])
  })

  it("ids stay within 50 characters and stable", () => {
    const long = feedId(`${"a".repeat(40)}-${"SKU".repeat(10)}`)
    assert.ok(long.length <= 50)
    assert.equal(long, feedId(`${"a".repeat(40)}-${"SKU".repeat(10)}`))
    assert.notEqual(feedId(`${"a".repeat(60)}1`), feedId(`${"a".repeat(60)}2`))
  })
})

describe("feed documents", () => {
  const items = feedItemsFor(base, product(), now)
  const page = feedPage(items, null)!

  it("Google RSS: g: namespace, escaped text, one <item> per variant", () => {
    const xml = googleFeedXml(base, page, { title: "Yard products", description: "Independent brands.", generatedAt: now.toISOString() })
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
    assert.match(xml, /<rss version="2.0" xmlns:g="http:\/\/base.google.com\/ns\/1.0"/)
    assert.equal(xml.match(/<item>/g)?.length, 2)
    assert.match(xml, /<g:id>lagos-static-HH-S<\/g:id>/)
    assert.match(xml, /<g:price>45000.00 NGN<\/g:price>/)
    assert.match(xml, /<g:availability>in_stock<\/g:availability>/)
    assert.match(xml, /<g:item_group_id>heavy-hoodie<\/g:item_group_id>/)
    assert.match(xml, /<g:identifier_exists>no<\/g:identifier_exists>/)
    assert.match(xml, /<g:shipping><g:country>NG<\/g:country><g:price>2500.00 NGN<\/g:price>/)
    assert.match(xml, /cotton &amp; a &lt;b&gt;big&lt;\/b&gt; hood/)
    assert.ok(!xml.includes("<b>"))
  })

  it("JSON: the same items with paging facts", () => {
    const json = productsJson(base, page, { title: "Yard products", generatedAt: now.toISOString() })
    assert.equal(json.total, 2)
    assert.equal(json.next, null)
    assert.equal((json.items as FeedItem[])[0].id, "lagos-static-HH-S")
  })

  it("pages of FEED_PAGE_SIZE; out-of-range pages are refused", () => {
    const many = Array.from({ length: FEED_PAGE_SIZE + 1 }, () => items[0])
    assert.equal(feedPage(many, null)!.pages, 2)
    assert.equal(feedPage(many, "2")!.items.length, 1)
    assert.equal(feedPage(many, "3"), null)
    assert.equal(feedPage(many, "x"), null)
  })

  it("xmlText drops characters XML forbids", () => {
    assert.equal(xmlText("a\u0001b<"), "ab&lt;")
  })
})

describe("sitemap documents", () => {
  it("a urlset with lastmod and image entries", () => {
    const xml = urlsetXml([
      { url: "https://yardstore.space/products/a?x=1&y=2", lastModified: "2026-11-20T10:00:00.000Z", changeFrequency: "weekly", priority: 0.7, images: ["https://yardstore.space/api/media/m1"] },
    ])
    assert.match(xml, /<loc>https:\/\/yardstore.space\/products\/a\?x=1&amp;y=2<\/loc>/)
    assert.match(xml, /<lastmod>2026-11-20T10:00:00.000Z<\/lastmod>/)
    assert.match(xml, /<image:image><image:loc>https:\/\/yardstore.space\/api\/media\/m1<\/image:loc><\/image:image>/)
  })

  it("past 50,000 URLs: parts of 50,000 behind an index", () => {
    assert.equal(sitemapParts(SITEMAP_LIMIT), 1)
    assert.equal(sitemapParts(SITEMAP_LIMIT + 1), 2)
    const entries = Array.from({ length: SITEMAP_LIMIT + 2 }, (_, i) => ({ url: `https://y/p/${i}`, lastModified: i === 3 ? "2026-11-21T00:00:00.000Z" : "2026-11-01T00:00:00.000Z" }))
    assert.equal(sitemapPart(entries, 1).length, 2)
    assert.equal(newest(sitemapPart(entries, 0)), "2026-11-21T00:00:00.000Z")
    const index = sitemapIndexXml([{ url: "https://y/sitemaps/0.xml" }, { url: "https://y/sitemaps/1.xml" }])
    assert.match(index, /<sitemapindex xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/)
    assert.equal(index.match(/<sitemap>/g)?.length, 2)
  })
})
