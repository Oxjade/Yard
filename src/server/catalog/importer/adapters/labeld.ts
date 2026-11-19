import { isType, jsonLd, jsonValuesAfter, links, nextFlight, sitemap, type LdNode } from "../html"
import type { RawProduct } from "../normalize"
import { FetchRefused } from "../fetch"
import { brandFromHtml, productFromLd } from "./common"
import { eachLimit, type Adapter, type ScanContext } from "./types"

/**
 * Labeld storefronts (<handle>.labeld.app, a Next.js site). The home page carries the brand's
 * Organization JSON-LD and links each product as /drops/<id>; /sitemap.xml lists every drop. Each
 * drop page has Product JSON-LD (name, images, description, price) and, in the App Router flight
 * payload, the product record itself: sizeOptions, colors (with hex), stockRemaining with
 * stockMode "global" (one count) or "variant" (variantStock), variantPriceAdjustmentsMinor,
 * galleryImages, fulfillment production days, and relatedProducts (more drops of the brand).
 * The listing on the home page loads in the browser, so the sitemap, the home links and the
 * related products are how every drop is found (no "load more" request is needed).
 */

const DROP = /\/drops\/([A-Za-z0-9_-]{6,64})\/?$/

export function isLabeldHost(host: string) {
  return /(^|\.)labeld\.app$/i.test(host)
}

/** shop.labeld.app/<handle> and shop.labeld.app/brands/<handle> are the same shop as <handle>.labeld.app. */
export function labeldShopUrl(u: URL): URL | null {
  if (!/^(shop\.|www\.)?labeld\.app$/i.test(u.hostname)) return null
  const parts = u.pathname.split("/").filter(Boolean)
  const handle = parts[0] === "brands" ? parts[1] : parts.length === 1 ? parts[0] : null
  if (!handle || !/^[a-z0-9-]{2,63}$/i.test(handle) || ["drops", "collections", "radar", "brands", "terms", "privacy", "auth"].includes(handle.toLowerCase())) return null
  return new URL(`https://${handle.toLowerCase()}.labeld.app/`)
}

const looksLabeld = (html: string) => html.includes("ik.imagekit.io/labeld/") || html.includes("labeld.app/#organization") || html.includes("Labeld Shop")

type LabeldRecord = {
  id?: string
  brandId?: string
  dropName?: string | null
  price?: number | string | null
  currency?: { abbreviation?: string } | string | null
  mainVisualUrl?: string | null
  galleryImages?: (string | { url?: string; src?: string })[] | null
  description?: string | null
  styleTags?: string[] | null
  sizeOptions?: string[] | null
  colors?: { label?: string; hex?: string }[] | null
  stockRemaining?: number | null
  stockMode?: string | null
  variantStock?: Record<string, unknown> | null
  variantPriceAdjustmentsMinor?: Record<string, unknown> | null
  isAvailableNow?: boolean | null
  isPublished?: boolean | null
  fulfillment?: { method?: string; productionMinDays?: number; productionMaxDays?: number } | null
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/** A variant-keyed map's value for size and colour, whatever key style the site used ("M", "M|Black", "Black-M", "M_Black"). */
function lookup(map: Record<string, unknown> | null | undefined, size: string | null, color: string | null): unknown {
  if (!map) return undefined
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const want = new Set([size, color].filter((x): x is string => !!x).map(norm))
  for (const [k, v] of Object.entries(map)) {
    const parts = k.split(/[|/_:,-]+|\s+/).map(norm).filter(Boolean)
    if (parts.length === want.size && parts.every((p) => want.has(p))) return v
    if (norm(k) === [size, color].filter(Boolean).map((s) => norm(s!)).join("")) return v
  }
  return undefined
}

/** The flight record of the page's main product (the first "product": object with a dropName). */
export function labeldRecord(html: string): { product: LabeldRecord | null; related: LabeldRecord[] } {
  const flight = nextFlight(html)
  const product = (jsonValuesAfter(flight, '"product":', 10).find((v) => !!v && typeof v === "object" && "dropName" in (v as object)) as LabeldRecord | undefined) ?? null
  const related = (jsonValuesAfter(flight, '"relatedProducts":', 2).find(Array.isArray) as LabeldRecord[] | undefined) ?? []
  return { product, related: related.filter((r) => r && typeof r === "object" && typeof r.id === "string") }
}

/** One drop page → RawProduct, from the flight record with the JSON-LD as fallback. */
export function labeldProduct(html: string, pageUrl: string): { product: RawProduct | null; related: string[]; brandId: string | null } {
  const ld = jsonLd(html).find((n) => isType(n, "Product")) as LdNode | undefined
  const fromLd = ld ? productFromLd(ld, pageUrl) : null
  const { product: r, related } = labeldRecord(html)
  const id = DROP.exec(new URL(pageUrl).pathname)?.[1] ?? r?.id ?? null
  const relatedIds = related.filter((x) => !r?.brandId || x.brandId === r.brandId).map((x) => x.id!)
  if (!r) return { product: fromLd ? { ...fromLd, sourceId: id, notes: ["Sizes and stock weren't readable on this page."] } : null, related: relatedIds, brandId: null }

  const currency = typeof r.currency === "string" ? r.currency : (r.currency?.abbreviation ?? fromLd?.currency ?? null)
  const sizes = (r.sizeOptions ?? []).filter((s): s is string => typeof s === "string" && !!s.trim())
  const colors = (r.colors ?? []).filter((c) => c && typeof c.label === "string" && c.label.trim())
  const options = [
    ...(sizes.length ? [{ name: "Size", values: sizes.map((value) => ({ value })) }] : []),
    ...(colors.length ? [{ name: "Colour", values: colors.map((c) => ({ value: c.label!.trim(), ...(c.hex ? { hex: c.hex } : {}) })) }] : []),
  ]
  const variantMode = r.stockMode === "variant" && r.variantStock && typeof r.variantStock === "object"
  const variants: NonNullable<RawProduct["variants"]> = []
  const sizeList: (string | null)[] = sizes.length ? sizes : [null]
  const colorList: (string | null)[] = colors.length ? colors.map((c) => c.label!.trim()) : [null]
  for (const s of sizeList)
    for (const c of colorList) {
      const stock = variantMode ? num(lookup(r.variantStock, s, c)) : null
      const delta = num(lookup(r.variantPriceAdjustmentsMinor, s, c))
      variants.push({ options: { ...(s ? { Size: s } : {}), ...(c ? { Colour: c } : {}) }, stock: variantMode ? (stock ?? 0) : null, priceMinorDelta: delta, available: variantMode ? (stock ?? 0) > 0 : null })
    }
  const gallery = (r.galleryImages ?? []).map((g) => (typeof g === "string" ? g : (g?.url ?? g?.src ?? ""))).filter(Boolean)
  const images = [...(r.mainVisualUrl ? [r.mainVisualUrl] : []), ...gallery, ...(fromLd?.images ?? [])]
  const shared = !variantMode ? num(r.stockRemaining) : null
  const soldOut = r.isAvailableNow === false || (shared != null && shared <= 0) || (variantMode && variants.every((v) => !v.stock))
  const f = r.fulfillment
  const processing = f && num(f.productionMinDays) != null && num(f.productionMaxDays) != null ? ([num(f.productionMinDays)!, num(f.productionMaxDays)!] as [number, number]) : null
  const notes: string[] = []
  if (f?.method === "made_to_order") notes.push("Made to order on the site.")
  return {
    product: {
      sourceUrl: pageUrl,
      sourceId: id,
      title: r.dropName ?? fromLd?.title ?? null,
      description: r.description ?? fromLd?.description ?? null,
      price: num(r.price) ?? fromLd?.price ?? null,
      currency,
      images,
      options,
      variants,
      sharedStock: shared,
      availability: soldOut ? "out_of_stock" : r.isAvailableNow ? "in_stock" : (fromLd?.availability ?? "unknown"),
      tags: (r.styleTags ?? []).filter((t): t is string => typeof t === "string"),
      processingDays: processing,
      notes,
    },
    related: relatedIds,
    brandId: r.brandId ?? null,
  }
}

export const labeld: Adapter = {
  id: "labeld",
  detect: (ctx) => (isLabeldHost(ctx.start.hostname) || (ctx.home && looksLabeld(ctx.home.html)) ? "yes" : "no"),
  async scan(ctx: ScanContext) {
    const origin = ctx.start.origin
    const brand = ctx.home ? brandFromHtml(ctx.home.html, ctx.home.url) : { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }
    const warnings: string[] = []
    const queue: string[] = []
    const seen = new Set<string>()
    const add = (u: string) => {
      let url: URL
      try {
        url = new URL(u, origin)
      } catch {
        return
      }
      const m = DROP.exec(url.pathname)
      if (!m || url.origin !== origin) return
      const clean = `${origin}/drops/${m[1]}`
      if (seen.has(m[1])) return
      seen.add(m[1])
      queue.push(clean)
    }
    ctx.progress({ phase: "listing", note: "Reading the shop's product list" })
    if (ctx.home) for (const l of links(ctx.home.html, ctx.home.url)) add(l)
    try {
      const sm = await ctx.fetch.get(`${origin}/sitemap.xml`, { accept: "application/xml,text/xml" })
      for (const l of sitemap(sm.text).locs) add(l)
    } catch (e) {
      if (!(e instanceof FetchRefused)) throw e
      warnings.push("The shop's sitemap couldn't be read; products linked from its home page were used.")
    }
    const products: RawProduct[] = []
    let brandId: string | null = null
    let read = 0
    // Related products can add drops while we read: keep going until the queue is empty or the cap is reached.
    while (read < queue.length && products.length < ctx.maxProducts) {
      const batch = queue.slice(read, Math.min(queue.length, read + Math.max(1, ctx.maxProducts - products.length)))
      read += batch.length
      ctx.progress({ phase: "products", productPages: queue.length })
      await eachLimit(batch, 2, async (url) => {
        if (products.length >= ctx.maxProducts) return
        if (ctx.skipPage?.(url)) return
        let page
        try {
          page = await ctx.fetch.get(url, { accept: "text/html" })
        } catch (e) {
          if (!(e instanceof FetchRefused)) throw e
          warnings.push(`${url}: ${e.message}`)
          return
        }
        const got = labeldProduct(page.text, url)
        if (got.brandId) brandId ??= got.brandId
        if (got.brandId && brandId && got.brandId !== brandId) return
        if (got.product) {
          products.push(got.product)
          ctx.progress({ productsFound: products.length })
        }
        for (const id of got.related) add(`${origin}/drops/${id}`)
      })
    }
    if (queue.length > read) warnings.push(`Stopped at ${ctx.maxProducts} products; the shop lists more.`)
    // Keep the shop's own order (the queue order), not the order pages happened to finish in.
    const order = new Map(queue.map((u, i) => [u, i]))
    products.sort((a, b) => (order.get(a.sourceUrl) ?? 0) - (order.get(b.sourceUrl) ?? 0))
    return { brand, products, warnings }
  },
}
