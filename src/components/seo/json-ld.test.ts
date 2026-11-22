import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { productJsonLd } from "../../lib/seo/json-ld"
import { JsonLd } from "./json-ld"

/** The JSON-LD blocks in a piece of HTML, parsed (what a crawler reads from the page). */
function jsonLdIn(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
}

describe("<JsonLd> rendered markup", () => {
  const product = productJsonLd("https://yardstore.space", {
    slug: "ring",
    name: "Ring </script><script>alert(1)</script>",
    description: "",
    images: [{ src: "/api/media/r1" }],
    currency: "NGN",
    priceMinor: 1_200_000,
    category: { slug: "jewelry", name: "Jewelry" },
    variants: [{ sku: "R-1", options: {}, priceMinor: 1_200_000, available: 1 }],
    brand: { name: "Ferro", handle: "ferro", city: "Lagos", country: "NG" },
    forSale: true,
  })

  it("renders one script tag whose @graph parses back with the required Product fields", () => {
    const html = renderToStaticMarkup(createElement(JsonLd, { nodes: [product, { "@type": "BreadcrumbList", itemListElement: [] }] }))
    const blocks = jsonLdIn(html)
    assert.equal(blocks.length, 1)
    const graph = (blocks[0] as { "@graph": Record<string, unknown>[] })["@graph"]
    const p = graph.find((n) => n["@type"] === "Product")!
    for (const field of ["name", "image", "description", "sku", "brand", "offers", "url", "category"]) assert.ok(field in p, field)
    const offer = p.offers as Record<string, unknown>
    for (const field of ["price", "priceCurrency", "availability", "url", "itemCondition", "seller"]) assert.ok(field in offer, field)
  })

  it("a hostile product name can't end the script tag", () => {
    const html = renderToStaticMarkup(createElement(JsonLd, { nodes: [product] }))
    assert.equal(html.match(/<\/script>/g)?.length, 1)
    assert.ok(!html.includes("<script>alert"))
  })

  it("renders nothing for no nodes", () => {
    assert.equal(renderToStaticMarkup(createElement(JsonLd, { nodes: [null] })), "")
  })
})
