import { isType, jsonLd, ldText, links, meta, microdataProduct, robotsSitemaps, sitemap, title as pageTitle, type LdNode } from "../html"
import type { RawProduct } from "../normalize"
import { FetchRefused } from "../fetch"
import { cleanHref, sameSite } from "../url"
import { availabilityOf, brandFromHtml, productFromLd } from "./common"
import { eachLimit, type Adapter, type ScanContext } from "./types"

/**
 * Any other shop: candidate pages from robots.txt's sitemaps and /sitemap.xml (an index is
 * followed, product sitemaps first) and the home page's own links, product-looking paths first.
 * Each page is read for schema.org Product JSON-LD (ProductGroup variants included), then Product
 * microdata, then OpenGraph product tags (og:type product, product:price:amount). Pages with none
 * of these are skipped; ItemList JSON-LD adds the products it lists.
 */

const PRODUCTISH = /\/(products?|p|item|items|shop|store|drops?|collections\/[^/]+\/products)\/[^/]+/i
const SKIP = /\.(jpe?g|png|webp|gif|svg|pdf|zip|mp4|css|js|xml|txt)(\?|$)|\/(cart|checkout|account|login|register|wp-admin|wp-login|search|tag|author|feed|blog|news|policies|policy|terms|privacy|contact|about|faq)(\/|$|\?)/i

/** Products a page describes, in order of preference. */
export function productsFromPage(html: string, pageUrl: string): { products: RawProduct[]; listed: string[] } {
  const nodes = jsonLd(html)
  const listed: string[] = []
  for (const n of nodes.filter((x) => isType(x, "ItemList"))) {
    for (const el of Array.isArray(n.itemListElement) ? (n.itemListElement as LdNode[]) : []) {
      const u = ldText(el?.url) ?? ldText((el?.item as LdNode | undefined)?.url) ?? (typeof el?.item === "string" ? el.item : null)
      if (u) listed.push(u)
    }
  }
  const groups = nodes.filter((n) => isType(n, "ProductGroup"))
  const plain = nodes.filter((n) => isType(n, "Product", "IndividualProduct", "ProductModel") && !groups.some((g) => Array.isArray(g.hasVariant) && (g.hasVariant as unknown[]).includes(n)))
  const fromLd = [...groups, ...plain].map((n) => productFromLd(n, pageUrl)).filter((p): p is RawProduct => !!p)
  if (fromLd.length) return { products: fromLd, listed }
  const md = microdataProduct(html)
  if (md?.name) return { products: [{ sourceUrl: pageUrl, sourceId: md.sku, title: md.name, description: md.description, price: md.price, currency: md.currency, images: md.images, availability: availabilityOf(md.availability), notes: ["Read from the page's microdata."] }], listed }
  const ogType = meta(html, "og:type")
  const ogPrice = meta(html, "product:price:amount") ?? meta(html, "og:price:amount")
  if ((ogType && /product/i.test(ogType)) || ogPrice) {
    const t = meta(html, "og:title") ?? pageTitle(html)
    if (t)
      return {
        products: [
          {
            sourceUrl: meta(html, "og:url") ?? pageUrl,
            title: t,
            description: meta(html, "og:description") ?? meta(html, "description"),
            price: ogPrice,
            currency: meta(html, "product:price:currency") ?? meta(html, "og:price:currency"),
            images: [meta(html, "og:image:secure_url") ?? meta(html, "og:image")].filter((x): x is string => !!x),
            availability: availabilityOf(meta(html, "product:availability") ?? meta(html, "og:availability")),
            notes: ["Only the page's preview tags (OpenGraph) describe this product: check every field."],
          },
        ],
        listed,
      }
  }
  return { products: [], listed }
}

export const generic: Adapter = {
  id: "generic",
  detect: () => "maybe",
  async scan(ctx: ScanContext) {
    const origin = ctx.start.origin
    const warnings: string[] = []
    const candidates: string[] = []
    const seen = new Set<string>()
    const add = (u: string, base = origin) => {
      try {
        const clean = cleanHref(u, base)
        if (!clean) return
        const url = new URL(clean)
        if (!sameSite(url, ctx.start) || SKIP.test(url.pathname)) return
        const k = url.toString()
        if (seen.has(k)) return
        seen.add(k)
        candidates.push(k)
      } catch {
        /* not a URL */
      }
    }
    ctx.progress({ phase: "listing", note: "Reading the sitemap and the home page" })

    // Sitemaps: robots.txt first, then /sitemap.xml. An index is followed (product sitemaps first, at most 5).
    const maps: string[] = []
    try {
      const robots = await ctx.fetch.get(`${origin}/robots.txt`, { accept: "text/plain" })
      maps.push(...robotsSitemaps(robots.text))
    } catch (e) {
      if (!(e instanceof FetchRefused)) throw e
    }
    if (!maps.length) maps.push(`${origin}/sitemap.xml`)
    const sitemapUrls: string[] = []
    let followed = 0
    while (maps.length && followed < 6) {
      const m = maps.shift()!
      followed++
      try {
        const page = await ctx.fetch.get(m, { accept: "application/xml,text/xml" })
        const sm = sitemap(page.text)
        if (sm.index) maps.push(...sm.locs.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a))).slice(0, 5))
        else sitemapUrls.push(...sm.locs)
      } catch (e) {
        if (!(e instanceof FetchRefused)) throw e
      }
    }
    const homeLinks = ctx.home ? links(ctx.home.html, ctx.home.url) : []
    const all = [...sitemapUrls, ...homeLinks]
    // Product-looking paths first; when there are some, the rest of the site is left alone.
    const productish = all.filter((u) => PRODUCTISH.test(u))
    for (const u of productish.length ? productish : all) add(u)
    if (ctx.start.pathname !== "/") add(ctx.start.toString())

    const products: RawProduct[] = []
    const byUrl = new Set<string>()
    const keep = (p: RawProduct) => {
      const k = p.sourceUrl.replace(/[?#].*$/, "")
      if (byUrl.has(k) || products.length >= ctx.maxProducts) return
      byUrl.add(k)
      products.push(p)
      ctx.progress({ productsFound: products.length })
    }
    if (ctx.home) for (const p of productsFromPage(ctx.home.html, ctx.home.url).products) keep(p)
    // Pages read: at most twice the product cap (some pages won't be products).
    const budget = ctx.maxProducts * 2
    let read = 0
    while (read < candidates.length && read < budget && products.length < ctx.maxProducts) {
      const batch = candidates.slice(read, Math.min(candidates.length, budget, read + 20))
      read += batch.length
      ctx.progress({ phase: "products", productPages: Math.min(candidates.length, budget) })
      await eachLimit(batch, 2, async (url) => {
        if (products.length >= ctx.maxProducts) return
        if (ctx.skipPage?.(url)) return
        try {
          const page = await ctx.fetch.get(url, { accept: "text/html" })
          if (!page.contentType.includes("html")) return
          const got = productsFromPage(page.text, page.url)
          for (const p of got.products) keep(p)
          for (const l of got.listed) add(l, page.url)
        } catch (e) {
          if (!(e instanceof FetchRefused)) throw e
          if (e.reason !== "status") warnings.push(`${url}: ${e.message}`)
        }
      })
    }
    if (candidates.length > read) warnings.push(`Read ${read} pages of ${candidates.length}; the site may have more products.`)
    if (!products.length) return { brand: ctx.home ? brandFromHtml(ctx.home.html, ctx.home.url) : emptyBrand(), products, warnings: [...warnings, "No product data (schema.org Product, microdata or OpenGraph) was found on this site."] }
    return { brand: ctx.home ? brandFromHtml(ctx.home.html, ctx.home.url) : emptyBrand(), products, warnings }
  },
}

const emptyBrand = () => ({ name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } })
