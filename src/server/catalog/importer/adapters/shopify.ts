import type { RawProduct } from "../normalize"
import { meta } from "../html"
import { brandFromHtml } from "./common"
import type { Adapter, ScanContext } from "./types"

/**
 * Shopify: the public /products.json?limit=250&page=N (every published product with its options,
 * variants, prices, availability and images). Prices are strings in the shop's currency, which
 * products.json doesn't state: it comes from the home page (Shopify.currency, og:price:currency)
 * or /cart.js. Stock counts aren't public; a variant's `available` is.
 */

type ShopifyVariant = { id: number | string; title?: string; option1?: string | null; option2?: string | null; option3?: string | null; price?: string | number; compare_at_price?: string | number | null; available?: boolean; inventory_quantity?: number; sku?: string }
type ShopifyProduct = {
  id: number | string
  title: string
  handle: string
  body_html?: string | null
  product_type?: string | null
  vendor?: string | null
  tags?: string[] | string
  options?: { name: string; position?: number; values?: string[] }[]
  variants?: ShopifyVariant[]
  images?: { src: string }[]
}

export const looksShopify = (html: string) => /cdn\.shopify\.com|Shopify\.theme|myshopify\.com|shopify-section/i.test(html)

export function shopifyCurrency(html: string): string | null {
  const m = /Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/.exec(html) ?? /"currencyCode"\s*:\s*"([A-Z]{3})"/.exec(html)
  return m?.[1] ?? meta(html, "og:price:currency") ?? meta(html, "product:price:currency")
}

export function shopifyProduct(p: ShopifyProduct, origin: string, currency: string | null): RawProduct {
  const optionNames = (p.options ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((o) => o.name)
  const variants = (p.variants ?? []).map((v) => {
    const vals = [v.option1, v.option2, v.option3]
    const options: Record<string, string> = {}
    optionNames.forEach((n, i) => {
      if (vals[i]) options[n] = String(vals[i])
    })
    return { options, price: v.price ?? null, available: typeof v.available === "boolean" ? v.available : null, stock: typeof v.inventory_quantity === "number" ? Math.max(0, v.inventory_quantity) : null }
  })
  const first = p.variants?.[0]
  const tags = Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",").map((t) => t.trim())
  return {
    sourceUrl: `${origin}/products/${encodeURIComponent(p.handle)}`,
    sourceId: String(p.id),
    title: p.title,
    description: p.body_html ?? null,
    price: first?.price ?? null,
    compareAt: first?.compare_at_price ?? null,
    currency,
    images: (p.images ?? []).map((i) => i.src),
    options: (p.options ?? []).map((o) => ({ name: o.name, values: (o.values ?? []).map((value) => ({ value })) })),
    variants,
    availability: variants.length && variants.every((v) => v.available === false) ? "out_of_stock" : variants.some((v) => v.available) ? "in_stock" : "unknown",
    productType: p.product_type ?? null,
    tags: tags.filter(Boolean),
  }
}

export const shopify: Adapter = {
  id: "shopify",
  detect: (ctx) => (ctx.home && looksShopify(ctx.home.html) ? "yes" : ctx.home && /ik\.imagekit\.io\/labeld|wp-content|woocommerce/i.test(ctx.home.html) ? "no" : "maybe"),
  async scan(ctx: ScanContext) {
    const origin = ctx.start.origin
    const first = await ctx.fetch.json<{ products?: ShopifyProduct[] }>(`${origin}/products.json?limit=250&page=1`).catch(() => null)
    if (!first || !Array.isArray(first.products)) return null
    ctx.progress({ phase: "listing", note: "Reading products.json" })
    let currency = ctx.home ? shopifyCurrency(ctx.home.html) : null
    if (!currency) {
      const cart = await ctx.fetch.json<{ currency?: string }>(`${origin}/cart.js`).catch(() => null)
      currency = typeof cart?.currency === "string" ? cart.currency : null
    }
    const products: RawProduct[] = []
    const warnings: string[] = []
    let page = first.products
    for (let n = 1; page.length && products.length < ctx.maxProducts; n++) {
      for (const p of page) if (products.length < ctx.maxProducts && p && typeof p === "object" && p.handle) products.push(shopifyProduct(p, origin, currency))
      ctx.progress({ productsFound: products.length })
      if (page.length < 250 || products.length >= ctx.maxProducts || n >= 20) break
      const next = await ctx.fetch.json<{ products?: ShopifyProduct[] }>(`${origin}/products.json?limit=250&page=${n + 1}`).catch(() => null)
      page = Array.isArray(next?.products) ? next!.products! : []
    }
    if (products.length >= ctx.maxProducts) warnings.push(`Stopped at ${ctx.maxProducts} products; the shop may list more.`)
    return { brand: ctx.home ? brandFromHtml(ctx.home.html, ctx.home.url) : { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }, products, warnings }
  },
}
