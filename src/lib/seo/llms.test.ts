import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { llmsTxt, type LlmsInput } from "./llms"

const input: LlmsInput = {
  base: "https://yardstore.space",
  name: "Yard",
  tagline: "Independent brands, found first.",
  description: "A global destination for discovering, following and shopping independent brands.",
  categories: [
    { slug: "jewelry", name: "Jewelry", description: "Hand-cast silver and brass.", productCount: 12, brandCount: 3 },
    { slug: "home-lifestyle", name: "Home & lifestyle", description: "Ceramics, candles and lighting.", productCount: 1, brandCount: 1 },
    { slug: "technology", name: "Technology", description: "", productCount: 0, brandCount: 0 },
  ],
  totals: { brands: 2, products: 13, openingSoon: { brands: 0, products: 0 } },
  checkout: "bachs",
  brands: [
    { name: "Clay [Works]", handle: "clay-works", oneLine: "Stoneware from a night-shift studio.", city: "Accra", country: "GH", productCount: 1, forSale: true },
    { name: "Ferro Club", handle: "ferro-club", oneLine: null, city: "Mexico City", country: "MX", productCount: 12, forSale: true },
  ],
  generatedAt: "2026-11-22T12:00:00.000Z",
}

describe("llms.txt", () => {
  const txt = llmsTxt(input)

  it("follows the convention: an H1, a blockquote summary, then H2 sections of links", () => {
    const lines = txt.split("\n")
    assert.equal(lines[0], "# Yard")
    assert.ok(lines[2].startsWith("> Yard is an online marketplace for independent brands"))
    for (const h of ["## Who it's for", "## How buying works", "## Key pages", "## Policies", "## Machine-readable", "## Optional"]) assert.ok(txt.includes(`\n${h}\n`), h)
  })

  it("explains checkout, delivery, returns and drops", () => {
    assert.match(txt, /Checkout: add pieces from one or more brands to one bag and pay once/)
    assert.match(txt, /Delivery: each brand dispatches its own orders/)
    assert.match(txt, /returned within 7 days of delivery/)
    assert.match(txt, /Drops: a drop is a limited release/)
  })

  it("links the key pages, the legal pages, the sitemap, the feeds and the full version with absolute URLs", () => {
    for (const path of ["/brands", "/categories", "/drops", "/charts", "/sell", "/legal/refunds", "/legal/terms", "/sitemap.xml", "/feeds/google.xml", "/feeds/products.json", "/llms-full.txt"]) {
      assert.ok(txt.includes(`(https://yardstore.space${path})`), path)
    }
  })

  it("is category-neutral: categories come from the data, and the intro names fashion as one kind among many", () => {
    assert.match(txt, /across Jewelry, Home & lifestyle\./)
    assert.match(txt.split("\n")[2], /from fashion and streetwear to art, beauty, home goods and more/)
    assert.ok(!/clothing/i.test(txt))
  })

  it("isn't tied to one city: Lagos never appears, and the launch country is stated as a fact", () => {
    assert.ok(!/Lagos/.test(txt))
    assert.match(txt, /launched in Nigeria; each brand chooses where it delivers/)
  })

  it("lists Yard's own profiles only when there are some", () => {
    assert.ok(!txt.includes("## Yard elsewhere"))
    const withSocials = llmsTxt({ ...input, socials: [{ label: "Instagram", href: "https://www.instagram.com/yard" }] })
    assert.ok(withSocials.includes("## Yard elsewhere\n\n- [Yard on Instagram](https://www.instagram.com/yard)\n"))
  })

  it("states the public catalogue's counts, in the singular where it is one", () => {
    assert.match(txt, /Right now Yard lists 13 products from 2 brands, across Jewelry, Home & lifestyle\./)
    assert.match(llmsTxt({ ...input, totals: { brands: 1, products: 1 } }), /Right now Yard lists 1 product from 1 brand,/)
    assert.match(llmsTxt({ ...input, totals: { brands: 0, products: 0 } }), /no products are listed yet/)
  })

  it("says which part of the catalogue is from brands opening soon (visible, not selling yet)", () => {
    assert.ok(!/opening soon/i.test(txt))
    const some = llmsTxt({ ...input, totals: { brands: 2, products: 13, openingSoon: { brands: 1, products: 12 } } })
    assert.match(some, /12 of these products are from 1 brand opening soon on Yard: those pieces can be browsed and the brands followed, but they are not on sale yet\./)
    const all = llmsTxt({ ...input, totals: { brands: 1, products: 13, openingSoon: { brands: 1, products: 13 } } })
    assert.match(all, /All of them are from a brand opening soon on Yard/)
  })

  it("names the payment provider only while checkout is open", () => {
    assert.match(txt, /Payment is by card or bank transfer, processed by Bachs\./)
    assert.match(llmsTxt({ ...input, checkout: "paystack" }), /processed by Paystack\./)
    const test = llmsTxt({ ...input, checkout: "test" })
    assert.match(test, /test mode and takes no real payment/)
    assert.ok(!/processed by/.test(test))
  })

  it("with payments off, says checkout is opening soon and never that payment is taken", () => {
    const soon = llmsTxt({ ...input, checkout: "soon" })
    assert.match(soon, /- Checkout: opening soon\. Yard isn't taking payments yet, so nothing can be bought on Yard today\./)
    assert.match(soon, /follow brands to get notified/)
    assert.match(soon, /\(once checkout opens\) check out once/)
    assert.ok(!/Payment is by|processed by|Bachs|Paystack/.test(soon))
  })

  it("lists no brands (that is the full version)", () => {
    assert.ok(!txt.includes("ferro-club"))
  })
})

describe("llms-full.txt", () => {
  const full = llmsTxt(input, true)

  it("lists every live brand with its one-line, city and link", () => {
    assert.ok(full.includes("- [Clay Works](https://yardstore.space/brands/clay-works): Stoneware from a night-shift studio. Based in Accra, Ghana. 1 product on Yard."))
    assert.ok(full.includes("- [Ferro Club](https://yardstore.space/brands/ferro-club): Based in Mexico City, Mexico. 12 products on Yard."))
  })

  it("marks a brand that is opening soon", () => {
    const soon = llmsTxt({ ...input, brands: [{ ...input.brands![1], forSale: false }] }, true)
    assert.ok(soon.includes("- [Ferro Club](https://yardstore.space/brands/ferro-club): Based in Mexico City, Mexico. 12 products on Yard. Opening soon: not selling yet."))
  })

  it("lists the categories with product counts", () => {
    assert.match(full, /- \[Jewelry\]\(https:\/\/yardstore.space\/categories\/jewelry\): 12 products from 3 brands\. Hand-cast silver and brass\./)
    assert.match(full, /- \[Technology\]\(https:\/\/yardstore.space\/categories\/technology\): 0 products from 0 brands\./)
  })

  it("carries no private data", () => {
    assert.ok(!/@(?!yardstore\.space)[a-z0-9-]+\.[a-z]/i.test(full.replace("support@yardstore.space", "")))
  })
})
