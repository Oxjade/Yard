import type { ImportBrandDto } from "@/lib/api/contracts/imports"
import { htmlToText } from "../html"
import type { RawProduct } from "../normalize"
import { FetchRefused } from "../fetch"
import { socialsOf } from "./common"
import { eachLimit, type Adapter, type ScanContext } from "./types"

/**
 * Bumpa storefronts (getbumpa.com: <shop>.bumpa.shop, or the shop's own domain), a Next.js site
 * whose listing loads in the browser from the shop's own JSON API at /storefront:
 *  - the home page's __NEXT_DATA__ props.pageProps.storeData: name, currency, logo_url, the
 *    address (only city and country are used: never the phone, street or zip), image_path;
 *  - /storefront/products?limit=N&page=N: a Laravel page ({ current_page, last_page, per_page,
 *    total, data }) of products with price ("34800.00", major units of the store currency), sales
 *    (the sale price when > 0, price is then the regular one), compare_at_price, quantity with
 *    manage_stock, in_stock, images ([{ path }] under the CDN), options and variation_count;
 *  - /storefront/products/<id>?with_variations=1: one product with its variations (option_values
 *    by id, price, sales, quantity) and collections (tags), read only for products with variations.
 */

type BumpaImage = { name?: string | null; path?: string | null }
type BumpaOption = { id?: number | string; name?: string | null; values?: (string | { name?: string; value?: string } | null)[] | null; option_values_ids?: (number | string)[] | null }
type BumpaVariation = { id?: number | string; price?: string | number | null; sales?: string | number | null; compare_at_price?: string | number | null; quantity?: string | number | null; manage_stock?: boolean | number | string | null; option_values?: { id?: number | string; name?: string | null; option_id?: number | string | null }[] | null }
type BumpaProduct = {
  id: number | string
  slug?: string | null
  name?: string | null
  title?: string | null
  description?: string | null
  price?: string | number | null
  sales?: string | number | null
  compare_at_price?: string | number | null
  quantity?: string | number | null
  manage_stock?: boolean | number | string | null
  in_stock?: boolean | null
  status?: number | string | boolean | null
  type?: string | null
  tag?: string | null
  tags?: { tag?: string | null }[] | null
  options?: BumpaOption[] | null
  variation_count?: number | null
  variations_count?: number | null
  variationCount?: number | null
  variations?: BumpaVariation[] | null
  image_url?: string | null
  optimized_image_url?: string | null
  image_path?: string | null
  images?: BumpaImage[] | null
  url?: string | null
}
type BumpaPage = { products?: { current_page?: number; last_page?: number; per_page?: number; total?: number; data?: BumpaProduct[] } }

export type BumpaStore = {
  id?: number | string
  name?: string | null
  subtitle?: string | null
  description?: string | null
  currency?: string | null
  logo_url?: string | null
  image_path?: string | null
  meta_description?: string | null
  url_link?: string | null
  address?: { city?: string | null; state?: string | null; country?: string | null } | null
}
type NextData = { props?: { pageProps?: { storeData?: BumpaStore; themeData?: Record<string, unknown>; storeLayout?: Record<string, unknown> } } }

export const isBumpaHost = (host: string) => /(^|\.)bumpa\.shop$/i.test(host)

/** The home page's Next.js data, when it has one. */
function nextData(html: string): NextData | null {
  const m = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as NextData
  } catch {
    return null
  }
}

/** A Bumpa shop on any domain: Next.js storeData plus a Bumpa reference (getbumpa.com images, "Bumpa" keywords or theme). */
export const looksBumpa = (html: string) => html.includes("__NEXT_DATA__") && html.includes('"storeData"') && /getbumpa\.com|powered by bumpa|"theme_name"\s*:\s*"Bumpa"|<meta[^>]+name=["']keywords["'][^>]+content=["'][^"']*\bBumpa\b/i.test(html)

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
/** Bumpa's own test for a product or variation that doesn't count stock. */
const untracked = (v: unknown) => v === false || v === 0 || v === "0"

/** getbumpa.com/cdn-cgi/image/width=200/https://…cloudfront.net/x.jpeg → the CloudFront original. */
export function bumpaOriginal(u: string | null | undefined): string | null {
  if (!u) return null
  const m = /\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/.exec(u)
  return m ? m[1] : u
}

/** The sale price wins when there is one; the regular price is then the compare-at price. */
function pricesOf(x: { price?: unknown; sales?: unknown; compare_at_price?: unknown }) {
  const regular = num(x.price)
  const sale = num(x.sales)
  if (sale != null && sale > 0 && (regular == null || sale < regular)) return { price: sale, compareAt: regular }
  return { price: regular, compareAt: num(x.compare_at_price) }
}

function imagesOf(p: BumpaProduct): string[] {
  const out: string[] = []
  let cdn: string | null = null
  for (const base of [p.image_path, p.image_url]) {
    try {
      if (base) {
        cdn = new URL(base).origin
        break
      }
    } catch {
      /* not a URL */
    }
  }
  for (const img of p.images ?? []) {
    if (img?.path && cdn) out.push(new URL(img.path, cdn).toString())
    else if (img?.name && p.image_path) out.push(`${p.image_path.replace(/\/?$/, "/")}${img.name}`)
  }
  const main = str(p.image_url) ?? bumpaOriginal(str(p.optimized_image_url))
  if (main && !out.includes(main)) out.unshift(main)
  return out
}

const variationCount = (p: BumpaProduct) => Math.max(num(p.variation_count) ?? 0, num(p.variations_count) ?? 0, num(p.variationCount) ?? 0)
const hasVariants = (p: BumpaProduct) => variationCount(p) > 0 || (Array.isArray(p.options) && p.options.length > 0)

const optionValues = (o: BumpaOption) => (o.values ?? []).map((v) => (typeof v === "string" ? v : (v?.name ?? v?.value ?? ""))).map((v) => v.trim())

/** One product of the listing (with its detail record when it has variations) as a RawProduct. */
export function bumpaProduct(p: BumpaProduct, origin: string, currency: string | null, detail?: BumpaProduct | null, detailFailed = false): RawProduct {
  const src = detail ?? p
  const slug = str(src.slug) ?? String(src.id)
  const { price, compareAt } = pricesOf(src)
  const notes: string[] = []
  const options = (src.options ?? [])
    .map((o) => ({ name: str(o.name) ?? "", values: optionValues(o).filter(Boolean).map((value) => ({ value })) }))
    .filter((o) => o.name && o.values.length)
  const variants: NonNullable<RawProduct["variants"]> = []
  const productUntracked = untracked(src.manage_stock)
  for (const v of src.variations ?? []) {
    const opts: Record<string, string> = {}
    ;(v.option_values ?? []).forEach((ov, i) => {
      const value = str(ov?.name)
      if (!value) return
      // Which option a value belongs to: by its id in the option's list, its option id, its position, then by value.
      const raw = src.options ?? []
      const o =
        raw.find((x) => (x.option_values_ids ?? []).some((id) => ov.id != null && String(id) === String(ov.id))) ??
        raw.find((x) => ov.option_id != null && x.id != null && String(x.id) === String(ov.option_id)) ??
        (raw.length === (v.option_values ?? []).length ? raw[i] : undefined) ??
        raw.find((x) => optionValues(x).some((y) => y.toLowerCase() === value.toLowerCase()))
      const name = str(o?.name)
      if (name) opts[name] = value
    })
    const vp = pricesOf(v)
    const off = untracked(v.manage_stock) || (v.manage_stock == null && productUntracked)
    const q = num(v.quantity)
    const stock = off || q == null ? null : Math.max(0, Math.floor(q))
    variants.push({ options: opts, price: vp.price, stock, available: off ? true : stock != null ? stock > 0 : null })
  }
  if (hasVariants(src) && !variants.length) {
    if (detailFailed) notes.push(`The site lists ${variationCount(src) || "several"} variations for this product, which couldn't be read: check the sizes.`)
    else if (options.length) notes.push("Sizes come from the shop's listing; stock per size isn't shown.")
  }
  // A product without variations: one count (when the site tracks stock) or just in stock / sold out.
  const q = num(src.quantity)
  const stock = productUntracked || q == null ? null : Math.max(0, Math.floor(q))
  if (!variants.length && !options.length) variants.push({ options: {}, stock, available: productUntracked ? true : stock != null ? stock > 0 : (src.in_stock ?? null) })
  const availability: RawProduct["availability"] = variants.some((v) => v.available) ? "in_stock" : variants.length && variants.every((v) => v.available === false) ? "out_of_stock" : src.in_stock === false ? "out_of_stock" : src.in_stock ? "in_stock" : "unknown"
  if (src.type === "bundle") notes.push("A bundle of other products on the site.")
  const collections = (src.tags ?? []).map((t) => str(t?.tag)).filter((t): t is string => !!t)
  const tags = [...new Set([str(src.tag), ...collections].filter((t): t is string => !!t))]
  const type = str(src.type)
  return {
    sourceUrl: `${origin}/products/${encodeURIComponent(slug)}/${encodeURIComponent(String(src.id))}`,
    sourceId: String(src.id),
    title: str(src.name) ?? str(src.title),
    description: src.description ?? null,
    price,
    compareAt,
    currency,
    images: imagesOf(src),
    options,
    variants,
    availability,
    productType: [type && !/^(simple|variable|variant|bundle)$/i.test(type) ? type : null, ...tags].filter(Boolean).join(" ") || null,
    tags,
    notes,
  }
}

const PHONEISH = /\+?\d[\d\s().-]{7,}\d/g
const EMAILISH = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g

/**
 * The brand from storeData: name, logo (the CDN original, not the 200 px copy), the hero banner when
 * the theme has one, a description that is more than the shop's name, socials (no WhatsApp: that's a
 * phone number) and the place as "city, country". The phone, street and zip are never read.
 */
export function bumpaBrand(store: BumpaStore, pageProps: NonNullable<NextData["props"]>["pageProps"], origin: string): ImportBrandDto {
  const name = str(store.name)
  const clean = (s: string | null) => (s ? htmlToText(s, 2000).replace(EMAILISH, "").replace(PHONEISH, "").replace(/\s+/g, " ").trim() : null)
  const fold = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  const description = [str(store.description), str(store.subtitle), str(store.meta_description)].map(clean).find((d) => d && fold(d) !== fold(name)) ?? null
  const layout = pageProps?.storeLayout as { pages?: { index?: { content?: { sc_view?: string; sc_banner_image?: string }[] } }; config?: { social_links?: Record<string, unknown>; hero_banner?: { banner_image?: string } } } | undefined
  const theme = pageProps?.themeData as { social_links?: { links?: unknown[] }; homepage_hero?: { list?: { image?: string; image_url?: string }[] } } | undefined
  const abs = (u: string | null | undefined) => {
    const s = str(u)
    if (!s) return null
    try {
      return new URL(s, store.image_path ?? origin).toString()
    } catch {
      return null
    }
  }
  const banner =
    abs(layout?.pages?.index?.content?.find((c) => c?.sc_view?.startsWith("banner") && str(c.sc_banner_image))?.sc_banner_image) ??
    abs(layout?.config?.hero_banner?.banner_image) ??
    abs(theme?.homepage_hero?.list?.map((h) => h?.image_url ?? h?.image).find((x) => str(x)))
  const social: string[] = []
  const handleUrl: Record<string, string> = { instagram: "https://instagram.com/", tiktok: "https://www.tiktok.com/@", twitter: "https://x.com/", facebook: "https://facebook.com/" }
  for (const [k, v] of Object.entries(layout?.config?.social_links ?? {})) {
    const s = str(v)
    if (!s || !(k in handleUrl)) continue
    social.push(/^https?:\/\//i.test(s) ? s : `${handleUrl[k]}${s.replace(/^@/, "")}`)
  }
  for (const l of theme?.social_links?.links ?? []) {
    const u = typeof l === "string" ? l : str((l as { url?: string; link?: string } | null)?.url) ?? str((l as { link?: string } | null)?.link)
    if (u && /^https?:\/\//i.test(u)) social.push(u)
  }
  const socials = socialsOf(social.filter((u) => !/wa\.me|whatsapp|tel:/i.test(u)))
  const a = store.address
  const place = [str(a?.city), str(a?.country)].filter(Boolean).join(", ")
  return { name, logo: abs(bumpaOriginal(str(store.logo_url))), banner, description, socials, location: place || null }
}

export function bumpaStore(html: string) {
  const pp = nextData(html)?.props?.pageProps
  return pp?.storeData && typeof pp.storeData === "object" ? { store: pp.storeData, pageProps: pp } : null
}

/** Products per listing request (the API takes `limit`; it pages by `last_page` whatever it allows). */
const PER_PAGE = 200
const MAX_PAGES = 20

export const bumpa: Adapter = {
  id: "bumpa",
  detect: (ctx) => (isBumpaHost(ctx.start.hostname) || (ctx.home && looksBumpa(ctx.home.html)) ? "yes" : "no"),
  async scan(ctx: ScanContext) {
    const origin = ctx.start.origin
    const found = ctx.home ? bumpaStore(ctx.home.html) : null
    const currency = str(found?.store.currency)?.toUpperCase() ?? null
    const brand: ImportBrandDto = found ? bumpaBrand(found.store, found.pageProps, origin) : { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }
    const limit = Math.min(PER_PAGE, ctx.maxProducts)
    const api = (page: number) => `${origin}/storefront/products?limit=${limit}&page=${page}`
    const first = await ctx.fetch.json<BumpaPage>(api(1)).catch((e) => {
      if (e instanceof FetchRefused) return null
      throw e
    })
    if (!first?.products || !Array.isArray(first.products.data)) return null
    ctx.progress({ phase: "listing", note: "Reading the Bumpa shop's product list" })
    const warnings: string[] = []
    if (!currency) warnings.push("The shop's currency wasn't on its home page.")
    const listed: BumpaProduct[] = []
    let page = first.products
    const last = Math.min(MAX_PAGES, num(page.last_page) ?? 1)
    for (let n = 1; ; n++) {
      for (const p of page.data ?? []) if (listed.length < ctx.maxProducts && p && typeof p === "object" && p.id != null && (str(p.name) ?? str(p.title)) && p.status !== 0 && p.status !== "0" && p.status !== false) listed.push(p)
      ctx.progress({ productsFound: listed.length })
      if (n >= last || listed.length >= ctx.maxProducts || !(page.data ?? []).length) break
      const next = await ctx.fetch.json<BumpaPage>(api(n + 1)).catch((e) => {
        if (e instanceof FetchRefused) return null
        throw e
      })
      if (!next?.products || !Array.isArray(next.products.data)) {
        warnings.push(`Page ${n + 1} of the shop's products couldn't be read; ${listed.length} products were.`)
        break
      }
      page = next.products
    }
    const total = num(first.products.total)
    if (listed.length >= ctx.maxProducts && (total == null || total > listed.length)) warnings.push(`Stopped at ${ctx.maxProducts} products; the shop lists ${total ?? "more"}.`)

    // Products with variations: their detail record (options and variations). Pieces a watch already knows are left alone.
    const products: (RawProduct | null)[] = listed.map(() => null)
    const todo: number[] = []
    listed.forEach((p, i) => {
      const url = `${origin}/products/${encodeURIComponent(str(p.slug) ?? String(p.id))}/${encodeURIComponent(String(p.id))}`
      if (ctx.skipPage?.(url)) return
      if (hasVariants(p)) todo.push(i)
      else products[i] = bumpaProduct(p, origin, currency)
    })
    if (todo.length) ctx.progress({ phase: "products", productPages: todo.length })
    await eachLimit(todo, 2, async (i) => {
      const p = listed[i]
      let detail: BumpaProduct | null = null
      try {
        const got = await ctx.fetch.json<{ product?: BumpaProduct | null }>(`${origin}/storefront/products/${encodeURIComponent(String(p.id))}?with_variations=1`)
        detail = got?.product && typeof got.product === "object" ? got.product : null
      } catch (e) {
        if (!(e instanceof FetchRefused)) throw e
      }
      products[i] = bumpaProduct(p, origin, currency, detail ? { ...p, ...detail } : null, !detail)
    })
    return { brand, products: products.filter((p): p is RawProduct => !!p), warnings }
  },
}
