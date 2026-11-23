import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  availabilityOf,
  brandJsonLd,
  breadcrumbJsonLd,
  collectionPageJsonLd,
  decimalPrice,
  fallbackProductDescription,
  jsonLdGraph,
  productJsonLd,
  sameAsLinks,
  serializeJsonLd,
  yardJsonLd,
  type JsonLdNode,
  type SeoProductInput,
} from "./json-ld"
import { rateFor, shippingOptions } from "./shipping"

const base = "https://yardstore.space"
const now = new Date("2026-11-22T12:00:00Z")

const product = (over: Partial<SeoProductInput> = {}): SeoProductInput => ({
  slug: "heavy-hoodie",
  name: "Heavy Hoodie",
  description: "450gsm loopback cotton.",
  images: [{ src: "/api/media/m1" }, { src: "https://cdn.example.com/2.jpg" }],
  currency: "NGN",
  priceMinor: 4_500_000,
  compareAtMinor: null,
  category: { slug: "streetwear", name: "Streetwear" },
  subcategory: "Hoodies",
  variants: [
    { sku: "HH-S-BLK", options: { Size: "S", Colour: "Black" }, priceMinor: 4_500_000, available: 3 },
    { sku: "HH-M-BLK", options: { Size: "M", Colour: "Black" }, priceMinor: 4_500_000, available: 0 },
  ],
  brand: { name: "Lagos Static", handle: "lagos-static", city: "Lagos", country: "NG" },
  forSale: true,
  releaseAt: null,
  shipping: [{ countries: ["NG"], rateMinor: 250_000, currency: "NGN", handling: [1, 3], transit: [1, 4] }],
  ...over,
})

/** Google's required and recommended fields for a merchant listing Offer. */
function assertOffer(offer: JsonLdNode) {
  assert.equal(offer["@type"], "Offer")
  assert.match(String(offer.price), /^\d+(\.\d+)?$/)
  assert.equal(typeof offer.priceCurrency, "string")
  assert.match(String(offer.availability), /^https:\/\/schema\.org\/(InStock|OutOfStock|PreOrder)$/)
  assert.equal(offer.itemCondition, "https://schema.org/NewCondition")
  assert.match(String(offer.url), /^https:\/\//)
  assert.equal((offer.seller as JsonLdNode)["@type"], "Organization")
  assert.equal((offer.hasMerchantReturnPolicy as JsonLdNode)["@type"], "MerchantReturnPolicy")
}

describe("serializeJsonLd", () => {
  it("escapes markup so a value can't close the script tag, and still parses back", () => {
    const evil = { name: "</script><script>alert(1)</script> & co" }
    const out = serializeJsonLd(evil)
    assert.ok(!out.includes("<"))
    assert.ok(!out.includes(">"))
    assert.deepEqual(JSON.parse(out), evil)
  })

  it("puts every node in one @graph", () => {
    const g = jsonLdGraph([{ "@type": "A" }, null, false, { "@type": "B" }])
    assert.equal(g["@context"], "https://schema.org")
    assert.equal((g["@graph"] as unknown[]).length, 2)
  })
})

describe("product JSON-LD", () => {
  it("variants by size and colour: a ProductGroup with hasVariant, variesBy and an Offer per variant", () => {
    const ld = productJsonLd(base, product(), now)
    assert.equal(ld["@type"], "ProductGroup")
    assert.equal(ld.name, "Heavy Hoodie")
    assert.equal(ld.productGroupID, "heavy-hoodie")
    assert.deepEqual(ld.variesBy, ["https://schema.org/size", "https://schema.org/color"])
    assert.deepEqual(ld.image, ["https://yardstore.space/api/media/m1", "https://cdn.example.com/2.jpg"])
    assert.deepEqual(ld.brand, { "@type": "Brand", name: "Lagos Static", url: "https://yardstore.space/brands/lagos-static" })
    assert.equal(ld.category, "Streetwear > Hoodies")
    assert.equal(ld.url, "https://yardstore.space/products/heavy-hoodie")
    const variants = ld.hasVariant as JsonLdNode[]
    assert.equal(variants.length, 2)
    assert.equal(variants[0].sku, "HH-S-BLK")
    assert.equal(variants[0].size, "S")
    assert.equal(variants[0].color, "Black")
    for (const v of variants) assertOffer(v.offers as JsonLdNode)
    assert.equal((variants[0].offers as JsonLdNode).availability, "https://schema.org/InStock")
    assert.equal((variants[1].offers as JsonLdNode).availability, "https://schema.org/OutOfStock")
    assert.equal((variants[0].offers as JsonLdNode).price, "45000.00")
  })

  it("one variant: a Product with sku and one Offer, with shipping and returns", () => {
    const ld = productJsonLd(base, product({ variants: [{ sku: "ONE", options: {}, priceMinor: 900_000, available: 2 }] }), now)
    assert.equal(ld["@type"], "Product")
    assert.equal(ld.sku, "ONE")
    const offer = ld.offers as JsonLdNode
    assertOffer(offer)
    const ship = (offer.shippingDetails as JsonLdNode[])[0]
    assert.equal(ship["@type"], "OfferShippingDetails")
    assert.deepEqual(ship.shippingRate, { "@type": "MonetaryAmount", value: "2500.00", currency: "NGN" })
    assert.deepEqual((ship.shippingDestination as JsonLdNode[])[0], { "@type": "DefinedRegion", addressCountry: "NG" })
    const returns = offer.hasMerchantReturnPolicy as JsonLdNode
    assert.equal(returns.merchantReturnDays, 7)
    assert.equal(returns.applicableCountry, "NG")
    assert.equal(returns.returnPolicyCategory, "https://schema.org/MerchantReturnFiniteReturnWindow")
  })

  it("variants with option names schema.org can't name and different prices: an AggregateOffer", () => {
    const ld = productJsonLd(
      base,
      product({
        variants: [
          { sku: "A", options: { Scent: "Cedar" }, priceMinor: 1000, available: 1 },
          { sku: "B", options: { Scent: "Fig" }, priceMinor: 2500, available: 0 },
        ],
      }),
      now,
    )
    assert.equal(ld["@type"], "Product")
    const offers = ld.offers as JsonLdNode
    assert.equal(offers["@type"], "AggregateOffer")
    assert.equal(offers.lowPrice, "10.00")
    assert.equal(offers.highPrice, "25.00")
    assert.equal(offers.offerCount, 2)
    assert.equal(offers.availability, "https://schema.org/InStock")
  })

  it("an upcoming drop is a pre-order from its release; a brand not selling yet is out of stock", () => {
    const releaseAt = "2026-12-01T18:00:00.000Z"
    const pre = productJsonLd(base, product({ releaseAt, variants: [{ sku: "X", options: {}, priceMinor: 100, available: 5 }] }), now)
    assert.equal((pre.offers as JsonLdNode).availability, "https://schema.org/PreOrder")
    assert.equal((pre.offers as JsonLdNode).availabilityStarts, releaseAt)
    assert.equal(availabilityOf({ forSale: true, releaseAt: "2026-11-01T00:00:00Z" }, 2, now), "InStock")
    assert.equal(availabilityOf({ forSale: false, releaseAt: null }, 9, now), "OutOfStock")
  })

  it("a founding brand that is opening soon: every Offer of its ProductGroup is OutOfStock, whatever is on hand, and never a pre-order", () => {
    const ld = productJsonLd(base, product({ forSale: false, variants: product().variants.map((v) => ({ ...v, available: 9 })) }), now)
    assert.equal(ld["@type"], "ProductGroup")
    const offers = (ld.hasVariant as JsonLdNode[]).map((v) => v.offers as JsonLdNode)
    assert.ok(offers.length > 1)
    for (const o of offers) assert.equal(o.availability, "https://schema.org/OutOfStock")
    const soonDrop = productJsonLd(base, product({ forSale: false, releaseAt: "2026-12-01T18:00:00.000Z", variants: [{ sku: "X", options: {}, priceMinor: 100, available: 5 }] }), now)
    assert.equal((soonDrop.offers as JsonLdNode).availability, "https://schema.org/OutOfStock")
    assert.ok(!JSON.stringify(soonDrop).includes("InStock"))
  })

  it("no reviews, no rating: aggregateRating is never invented", () => {
    assert.ok(!("aggregateRating" in productJsonLd(base, product(), now)))
  })

  it("an empty description falls back to facts", () => {
    const ld = productJsonLd(base, product({ description: "  " }), now)
    assert.equal(ld.description, "Heavy Hoodie by Lagos Static, Lagos. NGN 45,000. Streetwear > Hoodies.")
    assert.equal(fallbackProductDescription({ name: "Vase", brand: { name: "Clay", handle: "clay" } }), "Vase by Clay.")
  })

  it("prices keep the currency's minor digits", () => {
    assert.equal(decimalPrice(123456, "NGN"), "1234.56")
    assert.equal(decimalPrice(5000, "JPY"), "5000")
  })
})

describe("brand, collection and site JSON-LD", () => {
  it("a brand is an Organization with logo, sameAs and address, plus an ItemList of its products", () => {
    const [org, list] = brandJsonLd(
      base,
      {
        name: "Clay Works",
        handle: "clay-works",
        description: "",
        logo: "/api/media/logo",
        city: "Accra",
        country: "GH",
        social: { instagram: "@clayworks", tiktok: "clay.works", website: "https://clay.example" },
      },
      [{ name: "Vase", path: "/products/vase" }],
    )
    assert.equal(org["@type"], "Organization")
    assert.equal(org.url, "https://yardstore.space/brands/clay-works")
    assert.equal(org.logo, "https://yardstore.space/api/media/logo")
    assert.equal(org.description, "Clay Works is an independent brand from Accra, GH, selling on Yard.")
    assert.deepEqual(org.sameAs, ["https://www.instagram.com/clayworks", "https://www.tiktok.com/@clay.works", "https://clay.example"])
    assert.deepEqual(org.address, { "@type": "PostalAddress", addressLocality: "Accra", addressCountry: "GH" })
    assert.equal(list["@type"], "ItemList")
    assert.deepEqual((list.itemListElement as JsonLdNode[])[0], { "@type": "ListItem", position: 1, url: "https://yardstore.space/products/vase", name: "Vase" })
  })

  it("sameAs ignores empty handles and non-http websites", () => {
    assert.deepEqual(sameAsLinks({ instagram: " ", website: "javascript:alert(1)" }), [])
  })

  it("collection pages carry an ItemList as mainEntity; breadcrumbs are positioned absolute URLs", () => {
    const page = collectionPageJsonLd(base, { name: "Jewelry", description: "Hand-cast silver.", path: "/categories/jewelry", entries: [{ name: "Rings", path: "/categories/jewelry?sub=Rings" }] })
    assert.equal(page["@type"], "CollectionPage")
    assert.equal((page.mainEntity as JsonLdNode)["@type"], "ItemList")
    const crumbs = breadcrumbJsonLd(base, [
      { name: "Categories", path: "/categories" },
      { name: "Jewelry", path: "/categories/jewelry" },
    ])
    assert.deepEqual((crumbs.itemListElement as JsonLdNode[])[1], { "@type": "ListItem", position: 2, name: "Jewelry", item: "https://yardstore.space/categories/jewelry" })
  })

  it("home: Yard's Organization and a WebSite whose SearchAction targets the shop search", () => {
    const [org, website] = yardJsonLd(base, { name: "Yard", description: "Independent brands.", logoPath: "/icon/512", searchPath: "/shop" })
    assert.equal(org["@type"], "Organization")
    assert.equal(org.logo, "https://yardstore.space/icon/512")
    assert.equal(website["@type"], "WebSite")
    const action = website.potentialAction as JsonLdNode
    assert.equal(action["@type"], "SearchAction")
    assert.equal((action.target as JsonLdNode).urlTemplate, "https://yardstore.space/shop?q={search_term_string}")
    assert.equal(action["query-input"], "required name=search_term_string")
    assert.equal(org.sameAs, undefined)
    const [withSocial] = yardJsonLd(base, { name: "Yard", description: "Independent brands.", logoPath: "/icon/512", sameAs: ["https://www.instagram.com/yard"], searchPath: "/shop" })
    assert.deepEqual(withSocial.sameAs, ["https://www.instagram.com/yard"])
  })
})

describe("shipping options from the brand's rates", () => {
  const zones = [
    {
      enabled: true,
      countries: ["NG"],
      methods: [
        {
          service: "standard",
          enabled: true,
          transitMin: 1,
          transitMax: 3,
          rates: [
            { minSubtotalMinor: 0, amountMinor: 300_000, currency: "NGN" },
            { minSubtotalMinor: 5_000_000, amountMinor: 0, currency: "NGN" },
          ],
        },
        { service: "express", enabled: true, transitMin: 1, transitMax: 1, rates: [{ minSubtotalMinor: 0, amountMinor: 800_000, currency: "NGN" }] },
        { service: "pickup", enabled: true, transitMin: 0, transitMax: 0, rates: [{ minSubtotalMinor: 0, amountMinor: 0, currency: "NGN" }] },
      ],
    },
    { enabled: true, countries: ["*"], methods: [{ service: "standard", enabled: true, transitMin: 5, transitMax: 10, rates: [{ minSubtotalMinor: 0, amountMinor: 2_000_000, currency: "NGN" }] }] },
    { enabled: false, countries: ["GH"], methods: [{ service: "standard", enabled: true, transitMin: 3, transitMax: 6, rates: [{ minSubtotalMinor: 0, amountMinor: 1_000_000, currency: "NGN" }] }] },
  ]

  it("the tier for the price, the cheapest shipped method per zone (never store pickup), zones that name countries only", () => {
    assert.deepEqual(shippingOptions(zones, 1_000_000, "NGN", [1, 2]), [{ countries: ["NG"], rateMinor: 300_000, currency: "NGN", handling: [1, 2], transit: [1, 3] }])
    assert.equal(shippingOptions(zones, 6_000_000, "NGN", [1, 2])[0].rateMinor, 0)
  })

  it("no rate in the product's currency means no shipping claim", () => {
    assert.equal(rateFor([{ minSubtotalMinor: 0, amountMinor: 500, currency: "USD" }], 1000, "NGN"), null)
    assert.deepEqual(shippingOptions(zones, 1000, "USD", [1, 2]), [])
  })
})
