import { createHash } from "node:crypto"
import { currencies } from "@/config/markets"
import { IMPORT_MAX_IMAGES, ONE_SIZE, type ImportAvailability, type ImportChoiceBody, type ImportOptionDto, type ImportProductDto, type ImportVariantDto } from "@/lib/api/contracts/imports"
import type { ProposalProductBody } from "../contracts"
import { htmlToText } from "./html"
import { cleanHref } from "./url"

/**
 * From what an adapter read off a site to Yard's shape (docs/IMPORTER.md): prices in minor units,
 * options and variants the product form accepts, warnings for what's missing or guessed, a
 * category guess, and the duplicate check. Pure: no database, no network, no server-only.
 */

/** What an adapter hands over: whatever the site showed, in the site's own terms. */
export type RawProduct = {
  sourceUrl: string
  sourceId?: string | null
  title: string | null
  /** Plain text or HTML (it's reduced to text). */
  description?: string | null
  /** Major units ("25.00", 17000). */
  price?: number | string | null
  compareAt?: number | string | null
  /** Already in minor units (WooCommerce Store API), with the source's own minor-unit count. */
  minorPrice?: { price: number; compareAt: number | null; digits: number } | null
  currency?: string | null
  images: string[]
  options?: ImportOptionDto[]
  variants?: { options: Record<string, string>; stock?: number | null; price?: number | string | null; priceMinorDelta?: number | null; available?: boolean | null }[]
  /** One count for the whole product (Labeld "global" stock). */
  sharedStock?: number | null
  availability?: ImportAvailability
  productType?: string | null
  tags?: string[]
  processingDays?: [number, number] | null
  notes?: string[]
}

export type CategoryRef = { slug: string; name?: string; subcategories: string[] }
export type NormalizeContext = { brandCurrency: string; brandCategory: string | null; categories: CategoryRef[] }

const isYardCurrency = (c: string): c is keyof typeof currencies => c in currencies
export const minorDigits = (currency: string | null | undefined) => (currency && isYardCurrency(currency) ? currencies[currency].minor : 2)

/** "₦17,000.00", "17000", 25.5 → minor units of `currency`; null when it isn't a price. */
export function priceToMinor(v: number | string | null | undefined, currency: string | null | undefined): number | null {
  if (v == null || v === "") return null
  let n: number
  if (typeof v === "number") n = v
  else {
    let s = v.replace(/[^\d.,-]/g, "")
    // "1.234,56" (comma decimals) vs "1,234.56": the last separator with 1–2 digits after it is the decimal point.
    const lastComma = s.lastIndexOf(",")
    const lastDot = s.lastIndexOf(".")
    if (lastComma > lastDot && /,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
    else s = s.replace(/,/g, "")
    n = Number(s)
  }
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 10 ** minorDigits(currency))
}

/** A minor amount from a source that uses `from` digits into Yard's digits for the currency. */
export function rescaleMinor(amount: number, from: number, currency: string | null | undefined) {
  const to = minorDigits(currency)
  return Math.round(amount * 10 ** (to - from))
}

const SIZE_NAMES = /^(size|sizes|taille|talla|größe|shoe size|ring size|waist)$/i
const COLOR_NAMES = /^(colou?r|colours?|colors|shade)$/i
const SIZE_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"]

export const isSizeOption = (name: string) => SIZE_NAMES.test(name.trim())
export const isColorOption = (name: string) => COLOR_NAMES.test(name.trim())

/** "size" → "Size", "colour" → "Colour". Other names keep their own capitalisation. */
function optionName(name: string) {
  const n = name.trim().replace(/^pa_/, "").replace(/[-_]+/g, " ")
  if (isSizeOption(n)) return "Size"
  if (isColorOption(n)) return "Colour"
  return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 30)
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() : s)

/** The label a variant shows in the preview and the stock map is keyed by ("M / Black", or "One size"). */
export function variantLabel(options: Record<string, string>, order: string[]) {
  const vals = order.map((n) => options[n]).filter(Boolean)
  return vals.length ? vals.join(" / ") : ONE_SIZE
}

/** Splits one count across n variants: the remainder goes to the first ones. */
export function splitStock(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0))
}

/** Lower-case words only: "Eight-1-3 Molade Jorts!" → "eight 1 3 molade jorts". */
export function titleKey(t: string) {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** A source URL compared without protocol, www, trailing slash and query order. */
export function urlKey(u: string) {
  try {
    const x = new URL(u)
    x.searchParams.sort()
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase()
  } catch {
    return u.toLowerCase()
  }
}

/* ---------- category ---------- */

type Rule = { re: RegExp; to: Record<string, string | null>; fallback: [string, string | null] }
const garment = (fashion: string | null, streetwear: string | null): Record<string, string | null> => ({ fashion, streetwear })

/** Keyword → (category, subcategory). The brand's own category wins when it has a matching subcategory. */
const RULES: Rule[] = [
  { re: /\b(hoodie|hoody|sweatshirt|crewneck|crew neck|pullover|zip ?up)s?\b/, to: garment("Knitwear", "Hoodies"), fallback: ["streetwear", "Hoodies"] },
  { re: /\b(t-?shirt|tee|tees|tshirt|singlet|tank ?top|baby tee|jersey)s?\b/, to: garment(null, "T-shirts"), fallback: ["streetwear", "T-shirts"] },
  { re: /\b(jacket|coat|bomber|puffer|parka|gilet|vest|windbreaker|outerwear|varsity)s?\b/, to: garment("Outerwear", "Outerwear"), fallback: ["streetwear", "Outerwear"] },
  { re: /\b(shirt|polo|button[- ]?(up|down)|blouse|overshirt)s?\b/, to: garment("Shirts", "Shirts"), fallback: ["fashion", "Shirts"] },
  { re: /\b(pants|trousers?|jeans|denim|jorts|shorts|cargos?|joggers?|sweatpants|chinos|slacks)\b/, to: garment("Trousers", "Trousers"), fallback: ["streetwear", "Trousers"] },
  { re: /\b(dress|gown|kaftan|bubu|boubou)(es)?\b/, to: garment("Dresses", null), fallback: ["fashion", "Dresses"] },
  { re: /\b(skirt)s?\b/, to: garment("Skirts", null), fallback: ["fashion", "Skirts"] },
  { re: /\b(suit|blazer|agbada|senator|tuxedo)s?\b/, to: garment("Tailoring", null), fallback: ["fashion", "Tailoring"] },
  { re: /\b(knit|cardigan|sweater|jumper)s?\b/, to: garment("Knitwear", "Hoodies"), fallback: ["fashion", "Knitwear"] },
  { re: /\b(boot)s?\b/, to: {}, fallback: ["sneakers", "Boots"] },
  { re: /\b(sneaker|trainer|runner|kicks)s?\b/, to: {}, fallback: ["sneakers", "Low-tops"] },
  { re: /\b(slides?|sandals?|loafers?|heels|mules|shoes?|slippers?)\b/, to: garment("Footwear", null), fallback: ["fashion", "Footwear"] },
  { re: /\b(cap|hat|beanie|bucket hat|durag|balaclava|snapback|trucker)s?\b/, to: {}, fallback: ["accessories", "Headwear"] },
  { re: /\b(bag|tote|backpack|purse|clutch|pouch|wallet|crossbody)s?\b/, to: {}, fallback: ["accessories", "Bags"] },
  { re: /\b(sunglasses|shades|eyewear|glasses)\b/, to: {}, fallback: ["accessories", "Eyewear"] },
  { re: /\b(watch|watches)\b/, to: {}, fallback: ["accessories", "Watches"] },
  { re: /\b(chain|necklace|choker)s?\b/, to: {}, fallback: ["jewelry", "Chains"] },
  { re: /\b(ring)s?\b/, to: {}, fallback: ["jewelry", "Rings"] },
  { re: /\b(earring|stud|hoop)s?\b/, to: {}, fallback: ["jewelry", "Earrings"] },
  { re: /\b(bracelet|bangle|anklet)s?\b/, to: {}, fallback: ["jewelry", "Bracelets"] },
  { re: /\b(pendant|charm)s?\b/, to: {}, fallback: ["jewelry", "Pendants"] },
  { re: /\b(perfume|fragrance|cologne|parfum|eau de|body mist|oud)\b/, to: {}, fallback: ["beauty", "Fragrance"] },
  { re: /\b(serum|cream|moisturi[sz]er|cleanser|toner|soap|scrub|shea|lotion|body butter)s?\b/, to: {}, fallback: ["beauty", "Skin care"] },
  { re: /\b(lipstick|lip gloss|gloss|foundation|mascara|eyeliner|blush)\b/, to: {}, fallback: ["beauty", "Make-up"] },
  { re: /\b(print|poster|canvas|artwork)s?\b/, to: {}, fallback: ["art-design", "Prints"] },
  { re: /\b(candle)s?\b/, to: {}, fallback: ["home-lifestyle", "Candles"] },
  { re: /\b(vase)s?\b/, to: {}, fallback: ["home-lifestyle", "Vases"] },
  { re: /\b(lamp|light)s?\b/, to: {}, fallback: ["home-lifestyle", "Lighting"] },
  { re: /\b(zine|magazine)s?\b/, to: {}, fallback: ["creative", "Zines"] },
  { re: /\b(vinyl|record|lp)s?\b/, to: {}, fallback: ["creative", "Records"] },
  { re: /\b(skate ?deck|skateboard)s?\b/, to: {}, fallback: ["creative", "Skate"] },
]

/**
 * A category and subcategory for a product from its name, type and tags, only among Yard's
 * categories. A garment of a fashion or streetwear brand stays in the brand's category when that
 * category has the right subcategory. Nothing matched: the brand's category, no subcategory.
 */
export function guessCategory(text: string, ctx: Pick<NormalizeContext, "brandCategory" | "categories">): { slug: string; subcategory: string | null } | null {
  const t = ` ${titleKey(text)} `
  const known = new Map(ctx.categories.map((c) => [c.slug, c]))
  for (const r of RULES) {
    if (!r.re.test(t)) continue
    const own = ctx.brandCategory ? r.to[ctx.brandCategory] : undefined
    if (own && known.get(ctx.brandCategory!)?.subcategories.includes(own)) return { slug: ctx.brandCategory!, subcategory: own }
    const [slug, sub] = r.fallback
    const c = known.get(slug)
    if (c) return { slug, subcategory: sub && c.subcategories.includes(sub) ? sub : null }
  }
  if (ctx.brandCategory && known.has(ctx.brandCategory)) return { slug: ctx.brandCategory, subcategory: null }
  return ctx.categories[0] ? { slug: ctx.categories[0].slug, subcategory: null } : null
}

/* ---------- one product ---------- */

const keyOf = (r: RawProduct) => (r.sourceId ? `id:${r.sourceId}` : `url:${urlKey(r.sourceUrl)}`).slice(0, 400)

/** Absolute, http(s), tracking-free, de-duplicated image URLs, at most IMPORT_MAX_IMAGES. */
export function cleanImages(urls: string[], base: string) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    if (typeof raw !== "string" || !raw.trim() || raw.startsWith("data:")) continue
    const u = cleanHref(raw.startsWith("//") ? `https:${raw}` : raw, base)
    if (!u) continue
    const k = u.replace(/[?#].*$/, "")
    if (seen.has(k)) continue
    seen.add(k)
    out.push(u)
    if (out.length >= IMPORT_MAX_IMAGES) break
  }
  return out
}

export function normalizeProduct(raw: RawProduct, ctx: NormalizeContext): ImportProductDto | null {
  const title = clip((raw.title ?? "").replace(/\s+/g, " ").trim(), 120)
  if (!title) return null
  const warnings: string[] = [...(raw.notes ?? [])]
  const currency = raw.currency ? raw.currency.trim().toUpperCase() : null

  // Prices.
  let priceMinor: number | null
  let compareAtMinor: number | null
  if (raw.minorPrice) {
    priceMinor = raw.minorPrice.price > 0 ? rescaleMinor(raw.minorPrice.price, raw.minorPrice.digits, currency) : null
    compareAtMinor = raw.minorPrice.compareAt && raw.minorPrice.compareAt > 0 ? rescaleMinor(raw.minorPrice.compareAt, raw.minorPrice.digits, currency) : null
  } else {
    priceMinor = priceToMinor(raw.price, currency)
    compareAtMinor = priceToMinor(raw.compareAt, currency)
  }
  // Variants priced differently: the lowest becomes the product price.
  const variantPrices = (raw.variants ?? []).map((v) => priceToMinor(v.price, currency)).filter((x): x is number => x != null)
  if (priceMinor == null && variantPrices.length) priceMinor = Math.min(...variantPrices)
  if (compareAtMinor != null && (priceMinor == null || compareAtMinor <= priceMinor)) compareAtMinor = null
  if (priceMinor == null) warnings.push("Price missing: enter it before importing.")
  if (!currency) warnings.push(`The site doesn't say which currency it uses. Assumed ${ctx.brandCurrency}.`)
  else if (!isYardCurrency(currency)) warnings.push(`Priced in ${currency}, which Yard doesn't sell in. Enter the price in ${ctx.brandCurrency}.`)
  else if (currency !== ctx.brandCurrency) warnings.push(`Priced in ${currency}; this brand sells in ${ctx.brandCurrency}. Convert the price before importing.`)

  // Options: names Yard understands, values de-duplicated, at most 3 options of 40 values.
  const options: ImportOptionDto[] = []
  for (const o of raw.options ?? []) {
    const name = optionName(o.name)
    if (!name || options.some((x) => x.name === name) || options.length >= 3) continue
    const seen = new Set<string>()
    const values = o.values
      .map((v) => ({ value: clip(v.value.replace(/\s+/g, " ").trim(), 40), ...(v.hex && /^#[0-9a-f]{6}$/i.test(v.hex) ? { hex: v.hex.toUpperCase() } : {}) }))
      .filter((v) => v.value && !seen.has(v.value.toLowerCase()) && (seen.add(v.value.toLowerCase()), true))
      .slice(0, 40)
    if (values.length && !(values.length === 1 && /^default( title)?$/i.test(values[0].value))) options.push({ name, values })
  }
  // Sizes in the usual order when they're all letter sizes.
  for (const o of options) {
    if (o.name === "Size" && o.values.every((v) => SIZE_ORDER.includes(v.value.toUpperCase()))) o.values.sort((a, b) => SIZE_ORDER.indexOf(a.value.toUpperCase()) - SIZE_ORDER.indexOf(b.value.toUpperCase()))
  }
  const names = options.map((o) => o.name)
  const rename = (opts: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(opts)) {
      const n = optionName(k)
      if (names.includes(n)) out[n] = clip(String(v).replace(/\s+/g, " ").trim(), 40)
    }
    return out
  }

  // Variants: every combination the site listed, else the full grid of the options.
  let variants: ImportVariantDto[] = []
  const given = (raw.variants ?? []).map((v) => ({ ...v, options: rename(v.options) })).filter((v) => names.every((n) => options.find((o) => o.name === n)!.values.some((x) => x.value === v.options[n])))
  if (given.length) {
    const seen = new Set<string>()
    for (const v of given) {
      const label = variantLabel(v.options, names)
      if (seen.has(label)) continue
      seen.add(label)
      const own = priceToMinor(v.price, currency) ?? (v.priceMinorDelta && priceMinor != null ? priceMinor + v.priceMinorDelta : null)
      variants.push({ options: v.options, stock: v.stock ?? null, priceMinor: own != null && own !== priceMinor ? own : null, available: v.available ?? null })
    }
  } else {
    const grid = options.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v.value }))), [{}])
    variants = grid.slice(0, 200).map((options) => ({ options, stock: null, priceMinor: null, available: null }))
  }
  if (!options.length) {
    variants = [{ options: {}, stock: variants[0]?.stock ?? null, priceMinor: null, available: variants[0]?.available ?? null }]
    warnings.push(`No sizes found, defaulting to ${ONE_SIZE}.`)
  }

  // Stock: per variant when known; a shared count is split; otherwise unknown.
  const availability: ImportAvailability = raw.availability ?? (variants.some((v) => v.available) ? "in_stock" : variants.length && variants.every((v) => v.available === false) ? "out_of_stock" : "unknown")
  if (raw.sharedStock != null && variants.every((v) => v.stock == null)) {
    const parts = splitStock(Math.max(0, raw.sharedStock), variants.length)
    variants.forEach((v, i) => (v.stock = parts[i]))
    if (variants.length > 1) warnings.push(`The site counts ${raw.sharedStock} in stock across all sizes. Split evenly: check each size.`)
  }
  for (const v of variants) if (v.stock == null && (v.available === false || availability === "out_of_stock")) v.stock = 0
  if (variants.some((v) => v.stock == null)) warnings.push("Stock count not shown on the site: set it, or these sizes show as sold out.")
  if (availability === "out_of_stock") warnings.push("Sold out on the site.")

  const images = cleanImages(raw.images, raw.sourceUrl)
  if (!images.length) warnings.push("No photos found. Products need a photo to go live.")

  const description = htmlToText(raw.description ?? "", 4000)
  if (!description) warnings.push("No description on the site.")
  const cat = guessCategory([title, raw.productType ?? "", ...(raw.tags ?? [])].join(" "), ctx)
  const processingDays = raw.processingDays && raw.processingDays[0] >= 0 && raw.processingDays[1] >= raw.processingDays[0] ? ([Math.min(60, raw.processingDays[0]), Math.min(60, raw.processingDays[1])] as [number, number]) : null

  const sourceUrl = cleanHref(raw.sourceUrl) ?? raw.sourceUrl
  return {
    key: keyOf({ ...raw, sourceUrl }),
    sourceUrl,
    sourceId: raw.sourceId ?? null,
    title,
    description,
    priceMinor,
    compareAtMinor,
    currency,
    images,
    options,
    variants,
    availability,
    categorySlug: cat?.slug ?? null,
    subcategory: cat?.subcategory ?? null,
    processingDays,
    tags: [...new Set((raw.tags ?? []).map((t) => clip(t.trim(), 40)).filter(Boolean))].slice(0, 20),
    warnings,
    duplicate: null,
  }
}

/* ---------- duplicates ---------- */

export type Existing = { titles: { title: string; what: string }[]; sourceUrls: { url: string; what: string }[] }

/**
 * Flags products that look like ones the brand already has (same source URL imported before, or
 * the same name on a product or suggestion) and repeats within the scan (same URL or name as an
 * earlier one). Flagged products are unticked in the preview.
 */
export function markDuplicates(products: ImportProductDto[], existing: Existing): ImportProductDto[] {
  const urls = new Map(existing.sourceUrls.map((s) => [urlKey(s.url), s.what]))
  const titles = new Map(existing.titles.map((t) => [titleKey(t.title), t.what]))
  const seenUrl = new Set<string>()
  const seenTitle = new Map<string, string>()
  return products.map((p) => {
    const u = urlKey(p.sourceUrl)
    const t = titleKey(p.title)
    let reason: string | null = null
    if (urls.has(u)) reason = `Imported before (${urls.get(u)}).`
    else if (titles.has(t)) reason = `Same name as ${titles.get(t)}.`
    else if (seenUrl.has(u)) reason = "Listed twice on the site."
    else if (seenTitle.has(t)) reason = `Same name as another product on the site (${seenTitle.get(t)}).`
    seenUrl.add(u)
    if (!seenTitle.has(t)) seenTitle.set(t, p.sourceUrl)
    return { ...p, duplicate: reason ? { reason } : null }
  })
}

/* ---------- into a suggestion ---------- */

/** A SKU from the product's name and a short hash of its source: unique per product, readable. */
export function skuBase(p: Pick<ImportProductDto, "title" | "sourceUrl" | "sourceId">) {
  const words = titleKey(p.title).toUpperCase().replace(/\s+/g, "-").slice(0, 28).replace(/-+$/, "")
  const hash = createHash("sha256")
    .update(p.sourceId ?? urlKey(p.sourceUrl))
    .digest("hex")
    .slice(0, 5)
    .toUpperCase()
  return `${words || "ITEM"}-${hash}`
}

const skuPart = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10) || "X"

/**
 * The product form's body for one ticked product as the admin edited it: the scan's options (or
 * the edited sizes), one variant per combination with its opening stock, the photos already
 * copied into Yard (media ids), the brand's handling time when the site gave none.
 */
export function proposalBodyOf(p: ImportProductDto, choice: ImportChoiceBody, mediaIds: string[], opts: { defaultProcessing: [number, number] }): ProposalProductBody {
  let options = p.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ ...v })) }))
  let variants = p.variants.map((v) => ({ ...v, options: { ...v.options } }))
  if (choice.sizes) {
    // The admin's own size list replaces a single Size option (or adds one to a one-size product).
    const sizes = [...new Set(choice.sizes.map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== ONE_SIZE.toLowerCase()))]
    const others = options.filter((o) => o.name !== "Size")
    if (others.length === 0) {
      const before = new Map(variants.map((v) => [v.options.Size ?? "", v]))
      options = sizes.length ? [{ name: "Size", values: sizes.map((value) => ({ value })) }] : []
      variants = sizes.length ? sizes.map((s) => before.get(s) ?? { options: { Size: s }, stock: null, priceMinor: null, available: null }) : [{ options: {}, stock: variants.length === 1 ? variants[0].stock : null, priceMinor: null, available: null }]
    }
  }
  const order = options.map((o) => o.name)
  const base = skuBase(p)
  const body = {
    title: choice.title.trim(),
    description: p.description.slice(0, 4000),
    details: [] as string[],
    categorySlug: choice.categorySlug,
    subcategory: choice.subcategory ?? null,
    tags: p.tags.slice(0, 20),
    badges: [] as never[],
    priceMinor: choice.priceMinor,
    compareAtMinor: p.compareAtMinor != null && p.compareAtMinor > choice.priceMinor && choice.currency === p.currency ? p.compareAtMinor : null,
    processingDays: p.processingDays ?? opts.defaultProcessing,
    options,
    variants: variants.map((v) => {
      const label = variantLabel(v.options, order)
      const stock = choice.stock[label] ?? v.stock ?? 0
      return {
        sku: order.length ? `${base}-${order.map((n) => skuPart(v.options[n])).join("-")}`.slice(0, 64) : base,
        options: v.options,
        priceMinor: v.priceMinor != null && choice.currency === p.currency && v.priceMinor !== choice.priceMinor ? v.priceMinor : null,
        ...(stock > 0 ? { initialStock: Math.min(1_000_000, stock) } : {}),
      }
    }),
    images: mediaIds.map((mediaId) => ({ mediaId, alt: clip(choice.title.trim(), 200) })),
    collectionIds: [] as string[],
  }
  return body as ProposalProductBody
}
