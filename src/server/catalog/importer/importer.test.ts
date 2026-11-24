import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { adminProposalCreateBody } from "../contracts"
import { importChoiceBody, ONE_SIZE, type ImportProductDto } from "../../../lib/api/contracts/imports"
import { guessMarket } from "../../../lib/from-website"
import { choiceOf, draftOf, draftProblems, stockLabels, withCurrency } from "../../../lib/importer"
import { bumpaProduct } from "./adapters/bumpa"
import { labeldProduct, labeldShopUrl } from "./adapters/labeld"
import { FetchRefused, safeGet, vetHost, type HttpTransport, type Resolver } from "./fetch"
import { guessCategory, markDuplicates, normalizeProduct, priceToMinor, proposalBodyOf, splitStock, titleKey } from "./normalize"
import { scanSite, siteFetcher, startUrlOf, type Get } from "./scan"
import { cleanUrl, ImportUrlError, isBlockedAddress, isBlockedHostname } from "./url"

const FIX = path.join(__dirname, "fixtures")
const read = (p: string) => readFileSync(path.join(FIX, p), "utf8")

const CATEGORIES = [
  { slug: "fashion", subcategories: ["Outerwear", "Shirts", "Knitwear", "Dresses", "Trousers", "Skirts", "Tailoring", "Footwear"] },
  { slug: "streetwear", subcategories: ["Hoodies", "T-shirts", "Shirts", "Outerwear", "Trousers"] },
  { slug: "accessories", subcategories: ["Bags", "Headwear", "Eyewear", "Watches", "Footwear"] },
  { slug: "jewelry", subcategories: ["Chains", "Rings", "Earrings", "Bracelets", "Pendants"] },
  { slug: "home-lifestyle", subcategories: ["Vases", "Candles", "Lighting"] },
]
const NORM = { brandCurrency: "NGN", brandCategory: "streetwear", categories: CATEGORIES }
const NONE = { titles: [], sourceUrls: [] }

/** A fake site: URL → [content type, body]; anything else is a 404. Records what was asked for. */
function site(pages: Record<string, [string, string]>) {
  const asked: string[] = []
  const get: Get = async (url) => {
    asked.push(url)
    const hit = pages[url]
    if (!hit) throw new FetchRefused("status", `${new URL(url).hostname} answered 404.`, 404)
    return { url, status: 200, contentType: hit[0], body: Buffer.from(hit[1]) }
  }
  return { fetch: siteFetcher(get, { delayMs: 0 }), asked }
}

const HTML = "text/html; charset=utf-8"
const LABELD = "https://813israw.labeld.app"
const DROPS = ["RG51ZHs89DpAevzvhTDk", "yH5muf5m08vjopDbrqvo", "iYwsRgjWQNbQqEe0rjVD", "AdvYjeDno2TknGUnnjaU"]
const labeldSite = () =>
  site({
    [`${LABELD}/`]: [HTML, read("labeld/home.html")],
    [`${LABELD}/sitemap.xml`]: ["application/xml", read("labeld/sitemap.xml")],
    ...Object.fromEntries(DROPS.map((id) => [`${LABELD}/drops/${id}`, [HTML, read(`labeld/drop-${id}.html`)] as [string, string]])),
  })

/* ---------- URL safety ---------- */

describe("URL safety", () => {
  it("strips tracking parameters and fragments, keeps the rest", () => {
    assert.equal(cleanUrl("https://813israw.labeld.app/?utm_source=snapchat&utm_medium=social").toString(), "https://813israw.labeld.app/")
    assert.equal(cleanUrl("https://shop.example.com/p/1?fbclid=x&color=red&gclid=y&_ga=1#top").toString(), "https://shop.example.com/p/1?color=red")
    assert.equal(cleanUrl("brand.example.com").toString(), "https://brand.example.com/")
  })

  it("refuses other schemes, credentials, odd ports and private hosts", () => {
    for (const bad of ["ftp://example.com/", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com/", "https://example.com:8443/", "http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://intranet/", "http://printer.local/", "http://0x7f.1/", "http://2130706433/", "http://db.internal/"]) {
      assert.throws(() => cleanUrl(bad), ImportUrlError, bad)
    }
    assert.doesNotThrow(() => cleanUrl("http://example.com:80/"))
    assert.doesNotThrow(() => cleanUrl("https://8.8.8.8/"))
  })

  it("blocks private, loopback, link-local, CGNAT and IPv6 forms that carry them", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:c0a8:0101::1", "ff02::1", "not-an-ip"]) assert.equal(isBlockedAddress(a), true, a)
    for (const a of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"]) assert.equal(isBlockedAddress(a), false, a)
    assert.equal(isBlockedHostname("813israw.labeld.app"), false)
    assert.equal(isBlockedHostname("[fe80::1]"), true)
  })

  it("refuses a host when any of its addresses is private (DNS checked before connecting)", async () => {
    const mixed: Resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]
    await assert.rejects(vetHost(new URL("https://rebind.example.com/"), mixed, false), (e: FetchRefused) => e.reason === "private")
    const nx: Resolver = async () => {
      throw new Error("ENOTFOUND")
    }
    await assert.rejects(vetHost(new URL("https://nx.example.com/"), nx, false), (e: FetchRefused) => e.reason === "dns")
    // Through an egress proxy a host only the proxy resolves is left to the proxy.
    assert.equal(await vetHost(new URL("https://nx.example.com/"), nx, true), null)
    const ok: Resolver = async () => [{ address: "93.184.216.34", family: 4 }]
    assert.deepEqual(await vetHost(new URL("https://ok.example.com/"), ok, false), { address: "93.184.216.34", family: 4 })
  })

  it("follows redirects by hand, re-checking every hop, and stops after 5", async () => {
    const resolve: Resolver = async (h) => [{ address: h === "evil.example.com" ? "127.0.0.1" : "93.184.216.34", family: 4 }]
    const pinnedTo: string[] = []
    const hop = (to: string): HttpTransport => async (url, pinned) => {
      pinnedTo.push(`${url.hostname}@${pinned?.address}`)
      return url.hostname === "a.example.com" ? { status: 302, headers: { location: to }, body: Buffer.alloc(0) } : { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("ok") }
    }
    await assert.rejects(safeGet("https://a.example.com/", { accept: "*/*", maxBytes: 100 }, { resolve, transport: hop("https://evil.example.com/") }), (e: FetchRefused) => e.reason === "private")
    await assert.rejects(safeGet("https://a.example.com/", { accept: "*/*", maxBytes: 100 }, { resolve, transport: hop("http://192.168.0.1/admin") }), (e: FetchRefused) => e.reason === "url")
    const r = await safeGet("https://a.example.com/?utm_source=x", { accept: "*/*", maxBytes: 100 }, { resolve, transport: hop("https://b.example.com/x?gclid=1&id=2") })
    assert.equal(r.url, "https://b.example.com/x?id=2")
    assert.ok(pinnedTo.every((p) => p.endsWith("@93.184.216.34") || p.endsWith("@127.0.0.1")))
    const loop: HttpTransport = async () => ({ status: 301, headers: { location: "https://a.example.com/" }, body: Buffer.alloc(0) })
    await assert.rejects(safeGet("https://a.example.com/", { accept: "*/*", maxBytes: 100 }, { resolve, transport: loop }), (e: FetchRefused) => e.reason === "redirects")
    const notFound: HttpTransport = async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) })
    await assert.rejects(safeGet("https://a.example.com/", { accept: "*/*", maxBytes: 100 }, { resolve, transport: notFound }), (e: FetchRefused) => e.reason === "status" && e.status === 404)
  })

  it("spaces requests and caps them per scan", async () => {
    const times: number[] = []
    const f = siteFetcher(
      async (url) => {
        times.push(Date.now())
        return { url, status: 200, contentType: "text/plain", body: Buffer.from("x") }
      },
      { delayMs: 40, maxRequests: 3 },
    )
    await Promise.all([f.get("https://a.example.com/1"), f.get("https://a.example.com/2"), f.get("https://a.example.com/3")])
    assert.ok(times[2] - times[0] >= 70, `requests were spaced (${times[2] - times[0]} ms)`)
    await assert.rejects(f.get("https://a.example.com/4"), (e: FetchRefused) => e.reason === "too_large")
    // A catch-all HTML page is not JSON (a Labeld /products.json answers 200 text/html).
    const g = siteFetcher(async (url) => ({ url, status: 200, contentType: HTML, body: Buffer.from("<html></html>") }), { delayMs: 0 })
    assert.equal(await g.json("https://a.example.com/products.json"), null)
  })
})

/* ---------- Labeld ---------- */

describe("Labeld adapter (saved pages of 813israw.labeld.app)", () => {
  it("reads the brand, every drop, sizes, colours, stock and production days", async () => {
    const { fetch, asked } = labeldSite()
    const r = await scanSite("https://813israw.labeld.app/?utm_source=snapchat&utm_medium=social", { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.platform, "labeld")
    assert.equal(r.startUrl, "https://813israw.labeld.app/")
    // Shopify and WooCommerce aren't probed on a site that is clearly Labeld: home, sitemap, 4 drops.
    assert.equal(asked.length, 6)
    assert.ok(!asked.some((u) => u.includes("products.json") || u.includes("wp-json")))
    assert.equal(r.brand.name, "Eight One Three")
    assert.match(r.brand.logo ?? "", /^https:\/\/ik\.imagekit\.io\/labeld\/brandImages\/.+45QlTVWb9\.jpg$/)
    assert.match(r.brand.banner ?? "", /eUozj9g3B\.jpg$/)
    assert.equal(r.brand.description, "Eight One Three is Raw")
    assert.equal(r.brand.socials.tiktok, "813israw")
    assert.equal(r.products.length, 4)
    assert.deepEqual(
      r.products.map((p) => p.title),
      ["MOLADE TEE", "Eight-1-3 Molade Jorts", "Eight-1-3 Wild West Tee (Black)", "Eight-1-3 Wild West Tee (Red)"],
    )
    const tee = r.products[0]
    assert.equal(tee.sourceId, "RG51ZHs89DpAevzvhTDk")
    assert.equal(tee.sourceUrl, `${LABELD}/drops/RG51ZHs89DpAevzvhTDk`)
    assert.equal(tee.priceMinor, 1_700_000)
    assert.equal(tee.currency, "NGN")
    assert.deepEqual(
      tee.options.map((o) => [o.name, o.values.map((v) => v.value)]),
      [
        ["Size", ["M", "L", "XL", "XXL"]],
        ["Colour", ["Black", "White"]],
      ],
    )
    assert.equal(tee.options[1].values[1].hex, "#FFFFFF")
    assert.equal(tee.variants.length, 8)
    // "global" stock of 10, split across the 8 variants.
    assert.equal(
      tee.variants.reduce((n, v) => n + (v.stock ?? 0), 0),
      10,
    )
    assert.deepEqual(tee.processingDays, [1, 3])
    assert.equal(tee.categorySlug, "streetwear")
    assert.equal(tee.subcategory, "T-shirts")
    assert.ok(tee.warnings.some((w) => /across all sizes/.test(w)))
    assert.ok(tee.warnings.includes("No description on the site."))
    assert.equal(tee.images.length, 1)
    const jorts = r.products[1]
    assert.deepEqual(
      jorts.variants.map((v) => [v.options.Size, v.stock]),
      [
        ["M", 3],
        ["L", 3],
        ["XL", 2],
        ["XXL", 2],
      ],
    )
    assert.equal(jorts.subcategory, "Trousers")
    assert.deepEqual(jorts.processingDays, [7, 10])
    assert.equal(r.products[2].description, "100% Cotton , soft to touch , Iron on low heat")
    assert.ok(r.products.every((p) => p.availability === "in_stock" && !p.duplicate))
  })

  it("reads per-variant stock, price adjustments, gallery images and sold-out drops", () => {
    const html = read("labeld/drop-RG51ZHs89DpAevzvhTDk.html").replace('\\"galleryImages\\":null', '\\"galleryImages\\":[\\"https://ik.imagekit.io/labeld/productImages/x/back.jpg\\"]').replace('\\"stockMode\\":\\"global\\",\\"variantStock\\":null,\\"variantPriceAdjustmentsMinor\\":null', '\\"stockMode\\":\\"variant\\",\\"variantStock\\":{\\"M|Black\\":2,\\"XL-White\\":5},\\"variantPriceAdjustmentsMinor\\":{\\"XXL|Black\\":150000}')
    const got = labeldProduct(html, `${LABELD}/drops/RG51ZHs89DpAevzvhTDk`)
    assert.ok(got.product)
    const p = normalizeProduct(got.product!, NORM)!
    const v = (s: string, c: string) => p.variants.find((x) => x.options.Size === s && x.options.Colour === c)!
    assert.equal(v("M", "Black").stock, 2)
    assert.equal(v("XL", "White").stock, 5)
    assert.equal(v("L", "Black").stock, 0)
    assert.equal(v("XXL", "Black").priceMinor, 1_850_000)
    assert.equal(p.images.length, 2)
    assert.deepEqual(got.related.sort(), ["AdvYjeDno2TknGUnnjaU", "iYwsRgjWQNbQqEe0rjVD", "yH5muf5m08vjopDbrqvo"])
    const sold = labeldProduct(read("labeld/drop-yH5muf5m08vjopDbrqvo.html").replace('\\"isAvailableNow\\":true', '\\"isAvailableNow\\":false'), `${LABELD}/drops/yH5muf5m08vjopDbrqvo`)
    assert.equal(sold.product?.availability, "out_of_stock")
  })

  it("finds drops through related products when the sitemap is missing", async () => {
    const pages: Record<string, [string, string]> = {
      [`${LABELD}/`]: [HTML, read("labeld/home.html").replace(/href="\/drops\/(?!RG51ZHs89DpAevzvhTDk)[^"]+"/g, 'href="/"')],
      ...Object.fromEntries(DROPS.map((id) => [`${LABELD}/drops/${id}`, [HTML, read(`labeld/drop-${id}.html`)] as [string, string]])),
    }
    const { fetch } = site(pages)
    const r = await scanSite(LABELD, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.products.length, 4)
    assert.ok(r.warnings.some((w) => /sitemap/.test(w)))
  })

  it("turns a Labeld marketplace page into the brand's own shop", () => {
    assert.equal(startUrlOf("https://shop.labeld.app/813israw?utm_source=x").toString(), "https://813israw.labeld.app/")
    assert.equal(startUrlOf("https://shop.labeld.app/brands/813israw").toString(), "https://813israw.labeld.app/")
    assert.equal(labeldShopUrl(new URL("https://shop.labeld.app/drops/abc123")), null)
  })
})

/* ---------- Shopify, WooCommerce, generic ---------- */

describe("Shopify adapter", () => {
  it("reads products.json with options, variants, availability and the shop's currency", async () => {
    const O = "https://testlabel.example.com"
    const { fetch, asked } = site({ [`${O}/`]: [HTML, read("shopify/home.html")], [`${O}/products.json?limit=250&page=1`]: ["application/json", read("shopify/products.json")] })
    const r = await scanSite(`${O}/collections/all?utm_campaign=x`, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.platform, "shopify")
    assert.equal(asked.length, 2)
    assert.equal(r.brand.name, "Test Label")
    assert.equal(r.brand.socials.instagram, "testlabel")
    assert.equal(r.brand.banner, "https://cdn.shopify.com/s/files/1/0001/files/banner.jpg")
    const [hoodie, tote] = r.products
    assert.equal(hoodie.sourceUrl, `${O}/products/danfo-heavyweight-hoodie`)
    assert.equal(hoodie.priceMinor, 4_500_000)
    assert.equal(hoodie.compareAtMinor, 5_200_000)
    assert.equal(hoodie.currency, "NGN")
    assert.deepEqual(
      hoodie.options.map((o) => o.name),
      ["Size", "Colour"],
    )
    assert.equal(hoodie.variants.length, 4)
    assert.equal(hoodie.variants.find((v) => v.options.Size === "L")?.stock, 0)
    assert.equal(hoodie.variants.find((v) => v.options.Colour === "Sand")?.priceMinor, 4_700_000)
    assert.match(hoodie.description, /480 gsm fleece\.\n• Puff print\n• Made in Lagos/)
    assert.equal(hoodie.subcategory, "Hoodies")
    assert.equal(hoodie.images.length, 2)
    // Shopify says available without a count: in stock, count not tracked (L is sold out on the site: 0).
    assert.ok(hoodie.warnings.some((w) => /no count shown: imported as in stock with the count not tracked/.test(w)))
    // "Default Title" is no option at all: One size.
    assert.equal(tote.options.length, 0)
    assert.equal(tote.variants.length, 1)
    assert.ok(tote.warnings.includes(`No sizes found, defaulting to ${ONE_SIZE}.`))
    assert.equal(tote.images[0], "https://cdn.shopify.com/s/files/1/0001/products/tote.jpg")
    assert.equal(tote.categorySlug, "accessories")
  })
})

describe("Bumpa adapter (real responses of themangabookshop981.bumpa.shop, trimmed)", () => {
  const B = "https://themangabookshop981.bumpa.shop"
  const JSON_T = "application/json"
  const listing = JSON.parse(read("bumpa/products.json")) as { products: { data: Record<string, unknown>[] } & Record<string, unknown> }
  /** The listing split into pages of `per`, in the API's own Laravel shape. */
  const pages = (origin: string, per: number, limit = 200) => {
    const data = listing.products.data
    const last = Math.ceil(data.length / per)
    return Object.fromEntries(
      Array.from({ length: last }, (_, i) => [`${origin}/storefront/products?limit=${limit}&page=${i + 1}`, [JSON_T, JSON.stringify({ products: { ...listing.products, current_page: i + 1, last_page: last, per_page: per, total: data.length, data: data.slice(i * per, (i + 1) * per) } })] as [string, string]]),
    )
  }

  it("reads the brand from storeData and every product, without probing other platforms", async () => {
    const { fetch, asked } = site({ [`${B}/`]: [HTML, read("bumpa/home.html")], ...pages(B, 200) })
    const r = await scanSite(`${B}/?utm_source=ig`, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.platform, "bumpa")
    // Home and one listing request: no products.json, no Store API, no product pages.
    assert.deepEqual(asked, [`${B}/`, `${B}/storefront/products?limit=200&page=1`])
    assert.equal(r.brand.name, "The Manga Bookshop")
    assert.equal(r.brand.logo, "https://dodptt9f4zk9h.cloudfront.net/stores/269199/themangabookshop981.jpeg")
    assert.equal(r.brand.location, "Gwarinpa, Nigeria")
    // The meta description only repeats the name: no bio.
    assert.equal(r.brand.description, null)
    // The phone, street and zip are never imported (the fixture carries placeholders for them).
    const all = JSON.stringify(r)
    for (const secret of ["+2340000000000", "2340000000000", "Redacted Street", "000000"]) assert.ok(!all.includes(secret), secret)
    assert.equal(guessMarket({ siteUrl: r.startUrl, platform: r.platform, location: r.brand.location, productCurrencies: r.products.map((p) => p.currency) }).country, "NG")
    assert.equal(r.products.length, 5)
  })

  it("maps prices to minor units, stock from quantity, images from the CDN", async () => {
    const { fetch } = site({ [`${B}/`]: [HTML, read("bumpa/home.html")], ...pages(B, 200) })
    const r = await scanSite(B, { fetch, normalize: NORM, existing: NONE })
    const [batman, mha, , persona, bleach] = r.products
    assert.equal(batman.title, "Absolute Batman")
    assert.equal(batman.sourceUrl, `${B}/products/absolute-batman/5583683`)
    assert.equal(batman.sourceId, "5583683")
    assert.equal(batman.priceMinor, 3_480_000)
    assert.equal(batman.compareAtMinor, null)
    assert.equal(batman.currency, "NGN")
    assert.equal(batman.availability, "out_of_stock")
    assert.equal(batman.variants[0].stock, 0)
    assert.deepEqual(batman.images, ["https://dodptt9f4zk9h.cloudfront.net/stores/269199/products/1d17eeeca6529db3b9e0a050b841b4e447887226.jpeg"])
    assert.ok(batman.warnings.includes(`No sizes found, defaulting to ${ONE_SIZE}.`))
    assert.equal(mha.priceMinor, 2_262_300)
    assert.equal(mha.availability, "in_stock")
    assert.equal(mha.variants[0].stock, 1)
    assert.equal(persona.variants[0].stock, 2)
    assert.ok(!persona.warnings.some((w) => /Stock count not shown/.test(w)))
    assert.match(bleach.description, /608 pages/)
  })

  it("pages through the listing until last_page", async () => {
    const { fetch, asked } = site({ [`${B}/`]: [HTML, read("bumpa/home.html")], ...pages(B, 2) })
    const r = await scanSite(B, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.products.length, 5)
    assert.deepEqual(asked.slice(1), [1, 2, 3].map((n) => `${B}/storefront/products?limit=200&page=${n}`))
    // The product cap holds across pages (and asks for no more than it needs).
    const capped = await scanSite(B, { fetch: site({ [`${B}/`]: [HTML, read("bumpa/home.html")], ...pages(B, 2, 3) }).fetch, normalize: NORM, existing: NONE, maxProducts: 3 })
    assert.equal(capped.products.length, 3)
    assert.ok(capped.warnings.some((w) => /Stopped at 3 products/.test(w)))
  })

  it("takes a sale price, with the regular price as compare-at, and an untracked product as in stock", () => {
    const p = listing.products.data[1]
    const sale = normalizeProduct(bumpaProduct({ ...p, id: 1, price: "20000.00", sales: "15000.00" } as never, B, "NGN"), NORM)!
    assert.equal(sale.priceMinor, 1_500_000)
    assert.equal(sale.compareAtMinor, 2_000_000)
    const compare = normalizeProduct(bumpaProduct({ ...p, id: 2, price: "20000.00", sales: null, compare_at_price: "25000.00" } as never, B, "NGN"), NORM)!
    assert.equal(compare.priceMinor, 2_000_000)
    assert.equal(compare.compareAtMinor, 2_500_000)
    const untracked = normalizeProduct(bumpaProduct({ ...p, id: 3, manage_stock: false, quantity: 0, in_stock: true } as never, B, "NGN"), NORM)!
    assert.equal(untracked.availability, "in_stock")
    assert.equal(untracked.variants[0].stock, null)
    assert.ok(untracked.warnings.some((w) => /no count shown: imported as in stock with the count not tracked/.test(w)))
  })

  it("reads a product's variations from its detail record: size, colour, stock and price", async () => {
    const tee = JSON.parse(read("bumpa/product-variant-constructed.json")).product
    const { variations: _v, tags: _t, ...listed } = tee
    void _v
    void _t
    const body = JSON.stringify({ products: { ...listing.products, data: [listed, listing.products.data[0]], total: 2 } })
    const { fetch, asked } = site({ [`${B}/`]: [HTML, read("bumpa/home.html")], [`${B}/storefront/products?limit=200&page=1`]: [JSON_T, body], [`${B}/storefront/products/5590001?with_variations=1`]: [JSON_T, read("bumpa/product-variant-constructed.json")] })
    const r = await scanSite(B, { fetch, normalize: { ...NORM, brandCategory: "streetwear" }, existing: NONE })
    // Only the product with variations is read again.
    assert.deepEqual(asked.slice(2), [`${B}/storefront/products/5590001?with_variations=1`])
    const p = r.products[0]
    assert.deepEqual(
      p.options.map((o) => [o.name, o.values.map((v) => v.value)]),
      [
        ["Size", ["M", "L"]],
        ["Colour", ["Black", "White"]],
      ],
    )
    assert.equal(p.priceMinor, 1_200_000)
    assert.equal(p.compareAtMinor, 1_500_000)
    assert.equal(p.variants.length, 4)
    assert.equal(p.variants.find((v) => v.options.Size === "M" && v.options.Colour === "Black")?.stock, 2)
    assert.equal(p.variants.find((v) => v.options.Size === "M" && v.options.Colour === "White")?.available, false)
    assert.equal(p.variants.find((v) => v.options.Size === "L" && v.options.Colour === "White")?.priceMinor, 1_300_000)
    assert.ok(p.tags.includes("Merch"))
    assert.equal(p.subcategory, "T-shirts")
    assert.equal(p.availability, "in_stock")
  })

  it("keeps One size with a warning when the variations can't be read", async () => {
    const tee = JSON.parse(read("bumpa/product-variant-constructed.json")).product
    const body = JSON.stringify({ products: { ...listing.products, data: [{ ...tee, options: [], variations: undefined }], total: 1 } })
    const { fetch } = site({ [`${B}/`]: [HTML, read("bumpa/home.html")], [`${B}/storefront/products?limit=200&page=1`]: [JSON_T, body] })
    const [p] = (await scanSite(B, { fetch, normalize: NORM, existing: NONE })).products
    assert.equal(p.options.length, 0)
    assert.ok(p.warnings.includes(`No sizes found, defaulting to ${ONE_SIZE}.`))
    assert.ok(p.warnings.some((w) => /4 variations .* couldn't be read/.test(w)))
  })

  it("detects a Bumpa shop on its own domain by its home page", async () => {
    const O = "https://shop.mangabooks.com.ng"
    const { fetch, asked } = site({ [`${O}/`]: [HTML, read("bumpa/home.html")], ...pages(O, 200) })
    const r = await scanSite(O, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.platform, "bumpa")
    assert.equal(asked.length, 2)
    assert.equal(r.products[0].sourceUrl, `${O}/products/absolute-batman/5583683`)
    // A site without the markers isn't asked for /storefront.
    const other = site({ [`${O}/`]: [HTML, "<html><head><title>Shop</title></head><body>Hi</body></html>"] })
    await scanSite(O, { fetch: other.fetch, normalize: NORM, existing: NONE })
    assert.ok(!other.asked.some((u) => u.includes("/storefront/")))
  })
})

describe("WooCommerce adapter", () => {
  it("reads the Store API: minor-unit prices, sale prices, variation attributes by slug", async () => {
    const O = "https://shop.example.org"
    const { fetch } = site({ [`${O}/`]: [HTML, '<html><link rel="stylesheet" href="/wp-content/plugins/woocommerce/style.css"></html>'], [`${O}/wp-json/wc/store/v1/products?per_page=100&page=1`]: ["application/json; charset=UTF-8", read("woocommerce/products.json")] })
    const r = await scanSite(O, { fetch, normalize: { ...NORM, brandCategory: "fashion" }, existing: NONE })
    assert.equal(r.platform, "woocommerce")
    const [shirt, ring] = r.products
    assert.equal(shirt.title, "Àdìrẹ Shirt")
    assert.equal(shirt.priceMinor, 3_500_000)
    assert.equal(shirt.compareAtMinor, 4_000_000)
    assert.deepEqual(
      shirt.variants.map((v) => v.options.Size),
      ["Small", "Large"],
    )
    assert.equal(shirt.categorySlug, "fashion")
    assert.equal(shirt.subcategory, "Shirts")
    assert.equal(ring.availability, "out_of_stock")
    assert.equal(ring.description, "Hand-cast brass.")
    assert.ok(ring.warnings.includes("No photos found. Products need a photo to go live."))
    assert.equal(ring.variants[0].stock, 0)
    assert.equal(ring.categorySlug, "jewelry")
  })
})

describe("available on the site, no count shown (Shopify, WooCommerce, untracked Bumpa)", () => {
  // What a variant becomes in the suggestion: a count, "stock not tracked", or nothing (0, sold out).
  const stockOf = (v: { initialStock?: number; untracked?: true }) => (v.initialStock ? v.initialStock : v.untracked ? "untracked" : 0)
  const choose = (p: ImportProductDto, stock: Record<string, number> = {}) => importChoiceBody.parse({ key: p.key, title: p.title, priceMinor: p.priceMinor ?? 1000, currency: p.currency ?? "NGN", categorySlug: "streetwear", stock })

  it("Shopify: available variants come in as in stock, count not tracked; sold-out ones stay sold out", async () => {
    const O = "https://testlabel.example.com"
    const { fetch } = site({ [`${O}/`]: [HTML, read("shopify/home.html")], [`${O}/products.json?limit=250&page=1`]: ["application/json", read("shopify/products.json")] })
    const r = await scanSite(O, { fetch, normalize: NORM, existing: NONE })
    const [hoodie, tote] = r.products
    const body = proposalBodyOf(hoodie, choose(hoodie), [], { defaultProcessing: [1, 3] })
    assert.deepEqual(
      body.variants.map((v) => [`${v.options.Size} / ${v.options.Colour}`, stockOf(v)]),
      [
        ["S / Black", "untracked"],
        ["M / Black", "untracked"],
        ["L / Black", 0],
        ["M / Sand", "untracked"],
      ],
    )
    // Never an invented number.
    assert.ok(body.variants.every((v) => v.initialStock === undefined))
    // The product form (and so the suggestion) accepts it.
    assert.doesNotThrow(() => adminProposalCreateBody.parse({ kind: "new", brandId: "b_x", product: body }))
    assert.deepEqual(proposalBodyOf(tote, choose(tote), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), ["untracked"])
  })

  it("a count the admin types wins over not tracked, 0 included", async () => {
    const O = "https://testlabel.example.com"
    const { fetch } = site({ [`${O}/`]: [HTML, read("shopify/home.html")], [`${O}/products.json?limit=250&page=1`]: ["application/json", read("shopify/products.json")] })
    const [hoodie] = (await scanSite(O, { fetch, normalize: NORM, existing: NONE })).products
    const body = proposalBodyOf(hoodie, choose(hoodie, { "S / Black": 3, "M / Black": 0 }), [], { defaultProcessing: [1, 3] })
    assert.deepEqual(body.variants.map(stockOf), [3, 0, 0, "untracked"])
  })

  it("WooCommerce: is_in_stock without a count is in stock, not tracked; out of stock is 0", async () => {
    const O = "https://shop.example.org"
    const { fetch } = site({ [`${O}/`]: [HTML, '<html><link rel="stylesheet" href="/wp-content/plugins/woocommerce/style.css"></html>'], [`${O}/wp-json/wc/store/v1/products?per_page=100&page=1`]: ["application/json; charset=UTF-8", read("woocommerce/products.json")] })
    const [shirt, ring] = (await scanSite(O, { fetch, normalize: { ...NORM, brandCategory: "fashion" }, existing: NONE })).products
    assert.equal(shirt.availability, "in_stock")
    assert.deepEqual(proposalBodyOf(shirt, choose(shirt), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), ["untracked", "untracked"])
    assert.deepEqual(proposalBodyOf(ring, choose(ring), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), [0])
  })

  it("Bumpa: a product that doesn't manage stock is in stock, not tracked; a counted one keeps its count", () => {
    const listing = JSON.parse(read("bumpa/products.json"))
    const p = listing.products.data[1]
    const off = normalizeProduct(bumpaProduct({ ...p, id: 3, manage_stock: false, quantity: 0, in_stock: true } as never, "https://themangabookshop981.bumpa.shop", "NGN"), NORM)!
    assert.deepEqual(proposalBodyOf(off, choose(off), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), ["untracked"])
    const counted = normalizeProduct(bumpaProduct({ ...p, id: 4, manage_stock: true, quantity: 2, in_stock: true } as never, "https://themangabookshop981.bumpa.shop", "NGN"), NORM)!
    assert.deepEqual(proposalBodyOf(counted, choose(counted), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), [2])
  })

  it("a site that says nothing about availability stays at 0, with the old warning", () => {
    const p = normalizeProduct({ sourceUrl: "https://x.example.com/p/1", title: "Plain Tee", price: "10000", currency: "NGN", images: [] }, NORM)!
    assert.equal(p.availability, "unknown")
    assert.ok(p.warnings.some((w) => /Stock count not shown/.test(w)))
    assert.deepEqual(proposalBodyOf(p, choose(p), [], { defaultProcessing: [1, 3] }).variants.map(stockOf), [0])
  })
})

describe("generic adapter", () => {
  it("reads Product JSON-LD (ProductGroup variants) and OpenGraph pages found from the home page", async () => {
    const O = "https://brand.example.com"
    const { fetch, asked } = site({
      [`${O}/`]: [HTML, read("generic/home.html")],
      [`${O}/shop/lagos-static-cap`]: [HTML, read("generic/product.html")],
      [`${O}/products/clay-vase`]: [HTML, read("generic/og.html")],
    })
    const r = await scanSite(O, { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.platform, "generic")
    assert.ok(!asked.some((u) => u.includes("elsewhere") || u.includes("/about")), "off-site and non-product pages aren't read")
    assert.equal(r.products.length, 2)
    const cap = r.products.find((p) => p.title === "Lagos Static Cap")!
    assert.equal(cap.description, "Six-panel cap & embroidered logo.")
    assert.equal(cap.sourceUrl, `${O}/shop/lagos-static-cap?ref=nav`)
    assert.equal(cap.priceMinor, 2500)
    assert.equal(cap.currency, "USD")
    assert.deepEqual(cap.images, [`${O}/media/cap-1.jpg`, `${O}/media/cap-2.jpg`])
    assert.deepEqual(
      cap.variants.map((v) => [v.options.Colour, v.available]),
      [
        ["Black", true],
        ["Red", false],
      ],
    )
    assert.equal(cap.subcategory, "Headwear")
    assert.ok(cap.warnings.some((w) => /Priced in USD; this brand sells in NGN/.test(w)))
    const vase = r.products.find((p) => p.title.startsWith("Clay Vase"))!
    assert.equal(vase.title, "Clay Vase – Studio")
    assert.equal(vase.priceMinor, 123_450)
    assert.equal(vase.currency, "EUR")
    assert.ok(vase.warnings.some((w) => /OpenGraph/.test(w)))
  })

  it("reports a site with no product data", async () => {
    const { fetch } = site({ "https://plain.example.com/": [HTML, "<html><a href='/about'>About</a></html>"] })
    const r = await scanSite("https://plain.example.com", { fetch, normalize: NORM, existing: NONE })
    assert.equal(r.products.length, 0)
    assert.ok(r.warnings.includes("No products were found on this site."))
  })
})

/* ---------- normalisation, duplicates, the suggestion body ---------- */

const product = (over: Partial<ImportProductDto> = {}): ImportProductDto => ({
  key: "id:1",
  sourceUrl: "https://shop.example.com/products/tee",
  sourceId: "1",
  title: "Wild West Tee",
  description: "Cotton.",
  priceMinor: 1_300_000,
  compareAtMinor: null,
  currency: "NGN",
  images: ["https://cdn.example.com/a.jpg"],
  options: [{ name: "Size", values: [{ value: "M" }, { value: "L" }] }],
  variants: [
    { options: { Size: "M" }, stock: 5, priceMinor: null, available: true },
    { options: { Size: "L" }, stock: 5, priceMinor: null, available: true },
  ],
  availability: "in_stock",
  categorySlug: "streetwear",
  subcategory: "T-shirts",
  processingDays: [3, 5],
  tags: [],
  warnings: [],
  duplicate: null,
  ...over,
})

describe("normalisation", () => {
  it("reads prices in any common format into minor units", () => {
    assert.equal(priceToMinor("₦17,000", "NGN"), 1_700_000)
    assert.equal(priceToMinor("1.234,56", "EUR"), 123_456)
    assert.equal(priceToMinor("1,234.56", "USD"), 123_456)
    assert.equal(priceToMinor(17000, "NGN"), 1_700_000)
    assert.equal(priceToMinor("1500", "JPY"), 1500)
    assert.equal(priceToMinor("free", "USD"), null)
    assert.equal(priceToMinor(0, "USD"), null)
  })

  it("flags a missing price and currency, defaulting to One size", () => {
    const p = normalizeProduct({ sourceUrl: "https://x.example.com/p/1", title: "  Mystery   Item ", images: [] }, NORM)!
    assert.equal(p.title, "Mystery Item")
    assert.equal(p.priceMinor, null)
    assert.ok(p.warnings.includes("Price missing: enter it before importing."))
    assert.ok(p.warnings.some((w) => /doesn't say which currency/.test(w)))
    assert.ok(p.warnings.includes(`No sizes found, defaulting to ${ONE_SIZE}.`))
    assert.equal(normalizeProduct({ sourceUrl: "https://x.example.com/", title: "", images: [] }, NORM), null)
    const odd = normalizeProduct({ sourceUrl: "https://x.example.com/p/2", title: "Thing", price: 10, currency: "CHF", images: [] }, NORM)!
    assert.ok(odd.warnings.some((w) => /Yard doesn't sell in/.test(w)))
  })

  it("guesses categories within Yard's own", () => {
    assert.deepEqual(guessCategory("Eight-1-3 Molade Jorts", NORM), { slug: "streetwear", subcategory: "Trousers" })
    assert.deepEqual(guessCategory("Linen shirt", { ...NORM, brandCategory: "fashion" }), { slug: "fashion", subcategory: "Shirts" })
    assert.deepEqual(guessCategory("Gold chain", NORM), { slug: "jewelry", subcategory: "Chains" })
    assert.deepEqual(guessCategory("Something unusual", NORM), { slug: "streetwear", subcategory: null })
    assert.deepEqual(guessCategory("Bucket hat", { ...NORM, categories: CATEGORIES.filter((c) => c.slug !== "accessories") }), { slug: "streetwear", subcategory: null })
  })

  it("splits a shared count evenly", () => {
    assert.deepEqual(splitStock(10, 4), [3, 3, 2, 2])
    assert.deepEqual(splitStock(10, 8), [2, 2, 1, 1, 1, 1, 1, 1])
    assert.deepEqual(splitStock(0, 3), [0, 0, 0])
  })

  it("flags duplicates: imported before, same name on the brand, repeats within the scan", () => {
    const list = [product(), product({ key: "id:2", sourceUrl: "https://shop.example.com/products/hoodie", title: "Danfo Hoodie" }), product({ key: "id:3", sourceUrl: "https://shop.example.com/products/tee-2", title: "WILD WEST tee!" }), product({ key: "id:4", sourceUrl: "https://shop.example.com/products/new", title: "New Thing" })]
    const out = markDuplicates(list, { titles: [{ title: "Danfo hoodie", what: "“Danfo hoodie” in the catalogue" }], sourceUrls: [{ url: "http://www.shop.example.com/products/tee/", what: "suggested 2026-11-18" }] })
    assert.match(out[0].duplicate?.reason ?? "", /Imported before/)
    assert.match(out[1].duplicate?.reason ?? "", /in the catalogue/)
    assert.match(out[2].duplicate?.reason ?? "", /another product on the site/)
    assert.equal(out[3].duplicate, null)
    assert.equal(titleKey("Àdìrẹ — Shirt"), "adire shirt")
  })

  it("builds a suggestion body the product form accepts: SKUs, opening stock, edited sizes, photos", () => {
    const p = product()
    const choice = importChoiceBody.parse({ key: p.key, title: "Wild West Tee", priceMinor: 1_300_000, currency: "NGN", categorySlug: "streetwear", subcategory: "T-shirts", sizes: ["M", "L", "XL"], stock: { M: 4, XL: 1 } })
    const body = proposalBodyOf(p, choice, ["med_a", "med_b"], { defaultProcessing: [1, 3] })
    const parsed = adminProposalCreateBody.parse({ kind: "new", brandId: "b_x", product: body })
    assert.equal(parsed.kind, "new")
    assert.deepEqual(
      body.variants.map((v) => [v.options.Size, v.initialStock ?? 0]),
      [
        ["M", 4],
        ["L", 5],
        ["XL", 1],
      ],
    )
    assert.equal(new Set(body.variants.map((v) => v.sku)).size, 3)
    assert.match(body.variants[0].sku, /^WILD-WEST-TEE-[0-9A-F]{5}-M$/)
    assert.deepEqual(body.images, [
      { mediaId: "med_a", alt: "Wild West Tee" },
      { mediaId: "med_b", alt: "Wild West Tee" },
    ])
    assert.deepEqual(body.processingDays, [3, 5])
    // Another product with the same name gets other SKUs (its source differs).
    const twin = proposalBodyOf(product({ sourceId: "99" }), choice, [], { defaultProcessing: [1, 3] })
    assert.notEqual(twin.variants[0].sku, body.variants[0].sku)
    // No sizes: one variant without options.
    const one = proposalBodyOf(p, { ...choice, sizes: [] }, [], { defaultProcessing: [1, 3] })
    assert.equal(one.options.length, 0)
    assert.equal(one.variants.length, 1)
    assert.doesNotThrow(() => adminProposalCreateBody.parse({ kind: "new", brandId: "b_x", product: one }))
  })
})

describe("the review page's drafts", () => {
  const brand = { currency: "NGN", category: "streetwear", name: "Eight One Three" }
  it("starts ticked unless duplicate or unpriced, and sends what was edited", () => {
    const p = product()
    const d = draftOf(p, brand, CATEGORIES)
    assert.equal(d.on, true)
    assert.equal(d.price, "13000")
    assert.equal(d.sizes, "M, L")
    assert.equal(draftOf(product({ duplicate: { reason: "x" } }), brand, CATEGORIES).on, false)
    assert.equal(draftOf(product({ priceMinor: null }), brand, CATEGORIES).on, false)
    const edited = { ...d, sizes: "M, L, XL", stock: { ...d.stock, XL: "2" } }
    assert.deepEqual(stockLabels(p, edited), ["M", "L", "XL"])
    const c = choiceOf(p, edited)
    assert.deepEqual(c.sizes, ["M", "L", "XL"])
    assert.deepEqual(c.stock, { M: 5, L: 5, XL: 2 })
    assert.equal(c.priceMinor, 1_300_000)
    assert.doesNotThrow(() => importChoiceBody.parse(c))
  })

  it("converts the price when the currency changes, and refuses a currency the brand doesn't sell in", () => {
    const usd = draftOf(product({ currency: "USD", priceMinor: 2500 }), brand, CATEGORIES)
    assert.equal(usd.price, "25")
    assert.match(draftProblems(usd, brand).currency ?? "", /sells in NGN/)
    const ngn = withCurrency(usd, "NGN")
    assert.equal(ngn.price, "38000")
    assert.equal(ngn.convertedFrom, "USD")
    assert.deepEqual(draftProblems(ngn, brand), {})
    assert.deepEqual(Object.keys(draftProblems({ ...ngn, title: "x", price: "0", stock: { M: "1.5" } }, brand)).sort(), ["price", "stock", "title"])
  })
})
