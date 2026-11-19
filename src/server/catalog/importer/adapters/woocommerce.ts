import type { RawProduct } from "../normalize"
import { brandFromHtml } from "./common"
import type { Adapter, ScanContext } from "./types"

/**
 * WooCommerce: the public Store API, /wp-json/wc/store/v1/products?per_page=100&page=N. Prices
 * come in minor units with the currency and its minor-unit count; attributes with has_variations
 * are the options; variations name their attribute values by slug. Stock counts aren't public;
 * is_in_stock is.
 */

type WooTerm = { id?: number; name: string; slug?: string }
type WooProduct = {
  id: number
  name: string
  permalink: string
  type?: string
  description?: string
  short_description?: string
  prices?: { price?: string; regular_price?: string; sale_price?: string; currency_code?: string; currency_minor_unit?: number; price_range?: { min_amount?: string } | null }
  images?: { src: string }[]
  attributes?: { id?: number; name: string; taxonomy?: string; has_variations?: boolean; terms?: WooTerm[] }[]
  variations?: { id: number; attributes: { name: string; value: string | null }[] }[]
  is_in_stock?: boolean
  is_on_backorder?: boolean
  categories?: { name: string }[]
  tags?: { name: string }[]
}

export function wooProduct(p: WooProduct): RawProduct {
  const pr = p.prices ?? {}
  const digits = typeof pr.currency_minor_unit === "number" ? pr.currency_minor_unit : 2
  const price = Number(pr.price ?? pr.price_range?.min_amount ?? 0)
  const regular = Number(pr.regular_price ?? 0)
  const varying = (p.attributes ?? []).filter((a) => a.has_variations && a.terms?.length)
  const options = varying.map((a) => ({ name: a.name, values: (a.terms ?? []).map((t) => ({ value: t.name })) }))
  const termName = (attr: string, value: string) => {
    const a = varying.find((x) => x.name.toLowerCase() === attr.toLowerCase() || x.taxonomy?.toLowerCase() === attr.toLowerCase())
    const t = a?.terms?.find((x) => x.slug === value || x.name === value || x.name.toLowerCase() === value.toLowerCase())
    return { name: a?.name ?? attr, value: t?.name ?? value }
  }
  const variants = (p.variations ?? []).map((v) => {
    const options: Record<string, string> = {}
    for (const at of v.attributes ?? []) {
      if (!at.value) continue
      const t = termName(at.name, at.value)
      options[t.name] = t.value
    }
    return { options, available: null }
  })
  return {
    sourceUrl: p.permalink,
    sourceId: String(p.id),
    title: p.name,
    description: p.description || p.short_description || null,
    minorPrice: price > 0 ? { price, compareAt: regular > price ? regular : null, digits } : null,
    currency: pr.currency_code ?? null,
    images: (p.images ?? []).map((i) => i.src),
    options,
    variants,
    availability: p.is_in_stock === false ? (p.is_on_backorder ? "preorder" : "out_of_stock") : p.is_in_stock ? "in_stock" : "unknown",
    productType: p.categories?.map((c) => c.name).join(" ") ?? null,
    tags: (p.tags ?? []).map((t) => t.name),
  }
}

export const woocommerce: Adapter = {
  id: "woocommerce",
  detect: (ctx) => (ctx.home && /wp-content\/plugins\/woocommerce|woocommerce/i.test(ctx.home.html) ? "yes" : ctx.home && /cdn\.shopify\.com|ik\.imagekit\.io\/labeld/i.test(ctx.home.html) ? "no" : "maybe"),
  async scan(ctx: ScanContext) {
    const origin = ctx.start.origin
    const api = (page: number) => `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
    const first = await ctx.fetch.json<WooProduct[]>(api(1)).catch(() => null)
    if (!Array.isArray(first)) return null
    ctx.progress({ phase: "listing", note: "Reading the WooCommerce Store API" })
    const products: RawProduct[] = []
    const warnings: string[] = []
    let page = first
    for (let n = 1; page.length && products.length < ctx.maxProducts; n++) {
      for (const p of page) if (products.length < ctx.maxProducts && p && typeof p === "object" && p.permalink && p.name) products.push(wooProduct(p))
      ctx.progress({ productsFound: products.length })
      if (page.length < 100 || products.length >= ctx.maxProducts || n >= 20) break
      const next = await ctx.fetch.json<WooProduct[]>(api(n + 1)).catch(() => null)
      page = Array.isArray(next) ? next : []
    }
    if (products.length >= ctx.maxProducts) warnings.push(`Stopped at ${ctx.maxProducts} products; the shop may list more.`)
    return { brand: ctx.home ? brandFromHtml(ctx.home.html, ctx.home.url) : { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }, products, warnings }
  },
}
