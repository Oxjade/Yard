import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { BrandMark } from "../../components/market/brand-mark"
import { PhotoOrInitials } from "../../components/media/person-photo"
import { META_DESCRIPTION_MAX, PRIVATE_PAGE_PREFIXES, isPrivatePage, metaDescription } from "./meta"

describe("metaDescription", () => {
  it("takes the first candidate with text, as one line", () => {
    assert.equal(metaDescription("", "  ", null, undefined, "Linen shirt\n by  Oyin."), "Linen shirt by Oyin.")
  })
  it("cuts long text at a word boundary to 155 characters", () => {
    const long = "word ".repeat(80)
    const d = metaDescription(long)
    assert.ok(d.length <= META_DESCRIPTION_MAX, `${d.length}`)
    assert.ok(d.endsWith("…"))
  })
  it("never returns an empty description when a fallback is given", () => {
    assert.equal(metaDescription("", "Ring by Ferro Club, an independent brand on Yard."), "Ring by Ferro Club, an independent brand on Yard.")
  })
})

describe("private pages", () => {
  it("covers accounts, Studio, the Control Center, checkout and sign-in, with what is under them", () => {
    for (const p of ["/admin", "/admin/users", "/studio", "/studio/catalog", "/you", "/you/orders/o_1", "/bag", "/checkout/confirm", "/inbox", "/wishlist", "/following", "/notifications", "/welcome", "/sign-in", "/auth/reset", "/unsubscribe"]) {
      assert.ok(isPrivatePage(p), p)
    }
  })
  it("leaves every public page, and the files pages need to render, crawlable", () => {
    const publicPaths = ["/", "/shop", "/brands", "/brands/ferro-club", "/brands/ferro-club/collections/rings", "/products/ring", "/drops", "/drops/drop-07", "/categories", "/categories/jewelry", "/collections/edit", "/charts", "/around", "/sell", "/support", "/stories", "/stories/origins", "/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/seller-agreement", "/legal/data-deletion", "/youth-edit", "/devices", "/llms.txt", "/sitemap.xml", "/feeds/products.json", "/_next/static/chunks/app.js", "/_next/image", "/api/media/med_1", "/vendor/maplibre-gl-worker.mjs"]
    for (const p of publicPaths) assert.ok(!isPrivatePage(p), p)
  })
  it("starts every prefix with a slash and never lists the build's own files", () => {
    for (const prefix of PRIVATE_PAGE_PREFIXES) assert.ok(prefix.startsWith("/") && !prefix.startsWith("/_next") && !prefix.startsWith("/vendor"), prefix)
  })
})

type Photo = Parameters<typeof PhotoOrInitials>[0]

describe("image alt text", () => {
  it("names an uploaded brand logo", () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { brand: { name: "Ferro Club", mark: { text: "FC", style: "condensed" }, logoSrc: "/api/media/m1" } }))
    assert.match(html, /<img [^>]*alt="Ferro Club logo"/)
  })
  it("keeps an alt attribute on a profile photo, empty only when no name is given", () => {
    assert.match(renderToStaticMarkup(createElement(PhotoOrInitials, { src: "/p.jpg", alt: "Ada Obi" } as Photo, "AO")), /alt="Ada Obi"/)
    assert.match(renderToStaticMarkup(createElement(PhotoOrInitials, { src: "/p.jpg" } as Photo, "AO")), /<img [^>]*alt=""/)
  })
})
