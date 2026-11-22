/**
 * The product feed: Google Merchant Center's RSS 2.0 with the g: namespace (/feeds/google.xml) and
 * the same items as plain JSON (/feeds/products.json, for other shopping and AI programs). Pure:
 * the server reads the catalogue (src/server/seo/catalog.ts) and passes public facts in.
 *
 * One item per sellable variant, grouped by item_group_id (the product's public slug). Ids are
 * built from the brand's public handle and its SKU, never from internal ids.
 */
import { productPageVisibility, type VisibilityBrand, type VisibilityProduct } from "../page-visibility"
import { availabilityOf, categoryPath, decimalPrice, productDescription, productUrl, variantName, type SeoProductInput } from "./json-ld"
import { absoluteUrl, plainText } from "./url"

export type FeedAvailability = "in_stock" | "out_of_stock" | "preorder"

export type FeedShipping = { country: string; price: string; currency: string; minHandlingDays: number; maxHandlingDays: number; minTransitDays: number; maxTransitDays: number }

export type FeedItem = {
  id: string
  itemGroupId: string | null
  title: string
  description: string
  link: string
  imageLink: string
  additionalImageLinks: string[]
  availability: FeedAvailability
  availabilityDate: string | null
  price: { value: string; currency: string }
  salePrice: { value: string; currency: string } | null
  brand: string
  condition: "new"
  productType: string
  googleProductCategory: string | null
  size: string | null
  color: string | null
  material: string | null
  pattern: string | null
  shipping: FeedShipping[]
  /** Independent brands' own goods: no GTIN or MPN. */
  identifierExists: false
  /** Where the brand is based (custom label for campaigns; public on the brand page). */
  brandLocation: string | null
}

/**
 * Google product categories only where the mapping is safe for everything a Yard category can hold
 * (full taxonomy paths, which Merchant Center accepts in place of ids). A category that mixes
 * unrelated goods (technology, independent creative) gets none: Google infers it.
 */
export const GOOGLE_PRODUCT_CATEGORY: Record<string, string> = {
  fashion: "Apparel & Accessories",
  streetwear: "Apparel & Accessories > Clothing",
  sneakers: "Apparel & Accessories > Shoes",
  accessories: "Apparel & Accessories",
  jewelry: "Apparel & Accessories > Jewelry",
  beauty: "Health & Beauty",
  "art-design": "Home & Garden > Decor > Artwork",
  "home-lifestyle": "Home & Garden",
}

/** Feed limits (Merchant Center): ids and group ids 50 characters, titles 150, descriptions 5,000. */
const clamp = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n))

function stableHash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** An id of at most 50 characters: the readable form, or its head plus a hash when too long. */
export function feedId(readable: string) {
  const clean = readable.replace(/\s+/g, "-")
  if (clean.length <= 50) return clean
  const hash = stableHash(clean)
  return `${clean.slice(0, 49 - hash.length)}-${hash}`
}

/**
 * Whether a product may be in the feed, re-checked here on top of the SQL (productPublicWhere):
 * public (published or scheduled-and-due, moderation ok, brand listed and launched, not a refused
 * sample), its brand selling, at least one active variant and one photo. Drafts, hidden pieces,
 * opens-soon pieces of founding brands and anything of a restricted or suspended brand fail.
 */
export function feedEligible(p: { product: VisibilityProduct; brand: VisibilityBrand; forSale: boolean; variants: number; images: number }, now = new Date()) {
  return productPageVisibility(p.product, p.brand, now) === "public" && p.forSale && p.variants > 0 && p.images > 0
}

const optionValue = (options: Record<string, string>, ...names: string[]) => {
  for (const [k, v] of Object.entries(options)) if (names.includes(k.trim().toLowerCase())) return v
  return null
}

export function feedItemsFor(base: string, p: SeoProductInput, now = new Date()): FeedItem[] {
  if (!p.images.length || !p.variants.length) return []
  const link = productUrl(base, p.slug)
  const images = p.images.map((i) => absoluteUrl(base, i.src))
  const description = clamp(productDescription(p), 5000)
  const productType = categoryPath(p.category, p.subcategory)
  const many = p.variants.length > 1
  const shipping: FeedShipping[] = (p.shipping ?? []).flatMap((o) =>
    o.countries.map((country) => ({
      country,
      price: decimalPrice(o.rateMinor, o.currency),
      currency: o.currency,
      minHandlingDays: o.handling[0],
      maxHandlingDays: o.handling[1],
      minTransitDays: o.transit[0],
      maxTransitDays: o.transit[1],
    })),
  )
  return p.variants.map((v) => {
    const availability = availabilityOf(p, v.available, now)
    const onSale = p.compareAtMinor != null && p.compareAtMinor > v.priceMinor
    const label = variantName(v.options)
    return {
      id: feedId(`${p.brand.handle}-${v.sku}`),
      itemGroupId: many ? feedId(p.slug) : null,
      title: clamp(plainText(many && label ? `${p.name} (${label})` : p.name, 150), 150),
      description,
      link,
      imageLink: images[0],
      additionalImageLinks: images.slice(1, 11),
      availability: availability === "InStock" ? "in_stock" : availability === "PreOrder" ? "preorder" : "out_of_stock",
      availabilityDate: availability === "PreOrder" && p.releaseAt ? new Date(p.releaseAt).toISOString() : null,
      price: { value: decimalPrice(onSale ? p.compareAtMinor! : v.priceMinor, p.currency), currency: p.currency },
      salePrice: onSale ? { value: decimalPrice(v.priceMinor, p.currency), currency: p.currency } : null,
      brand: p.brand.name,
      condition: "new",
      productType,
      googleProductCategory: GOOGLE_PRODUCT_CATEGORY[p.category.slug] ?? null,
      size: optionValue(v.options, "size"),
      color: optionValue(v.options, "colour", "color"),
      material: optionValue(v.options, "material"),
      pattern: optionValue(v.options, "pattern"),
      shipping,
      identifierExists: false,
      brandLocation: [p.brand.city, p.brand.country].filter(Boolean).join(", ") || null,
    }
  })
}

/* ---------- Pages ---------- */

export const FEED_PAGE_SIZE = 5000

export type FeedPage = { items: FeedItem[]; page: number; pages: number; total: number }

export function feedPage(all: FeedItem[], requested: string | null): FeedPage | null {
  const pages = Math.max(1, Math.ceil(all.length / FEED_PAGE_SIZE))
  const page = requested === null || requested === "" ? 1 : Number(requested)
  if (!Number.isInteger(page) || page < 1 || page > pages) return null
  return { items: all.slice((page - 1) * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE), page, pages, total: all.length }
}

/* ---------- XML ---------- */

/** XML text: escapes markup and drops characters XML 1.0 forbids. */
export function xmlText(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const el = (name: string, value: string | null | undefined) => (value === null || value === undefined || value === "" ? "" : `<${name}>${xmlText(value)}</${name}>`)

function itemXml(i: FeedItem) {
  const parts = [
    el("g:id", i.id),
    el("title", i.title),
    el("description", i.description),
    el("link", i.link),
    el("g:image_link", i.imageLink),
    ...i.additionalImageLinks.map((src) => el("g:additional_image_link", src)),
    el("g:availability", i.availability),
    el("g:availability_date", i.availabilityDate),
    el("g:price", `${i.price.value} ${i.price.currency}`),
    i.salePrice ? el("g:sale_price", `${i.salePrice.value} ${i.salePrice.currency}`) : "",
    el("g:brand", i.brand),
    el("g:condition", i.condition),
    el("g:identifier_exists", "no"),
    el("g:item_group_id", i.itemGroupId),
    el("g:product_type", i.productType),
    el("g:google_product_category", i.googleProductCategory),
    el("g:size", i.size),
    el("g:color", i.color),
    el("g:material", i.material),
    el("g:pattern", i.pattern),
    ...i.shipping.map(
      (s) =>
        `<g:shipping>${el("g:country", s.country)}${el("g:price", `${s.price} ${s.currency}`)}${el("g:min_handling_time", String(s.minHandlingDays))}${el("g:max_handling_time", String(s.maxHandlingDays))}${el("g:min_transit_time", String(s.minTransitDays))}${el("g:max_transit_time", String(s.maxTransitDays))}</g:shipping>`,
    ),
    el("g:custom_label_0", i.brandLocation),
  ]
  return `<item>${parts.join("")}</item>`
}

export function googleFeedXml(base: string, page: FeedPage, meta: { title: string; description: string; generatedAt: string }) {
  const self = absoluteUrl(base, `/feeds/google.xml${page.page > 1 ? `?page=${page.page}` : ""}`)
  const next = page.page < page.pages ? `<atom:link rel="next" href="${xmlText(absoluteUrl(base, `/feeds/google.xml?page=${page.page + 1}`))}"/>` : ""
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    el("title", meta.title),
    el("link", `${base}/`),
    el("description", meta.description),
    el("lastBuildDate", new Date(meta.generatedAt).toUTCString()),
    `<atom:link rel="self" type="application/rss+xml" href="${xmlText(self)}"/>`,
    next,
    ...page.items.map(itemXml),
    `</channel>`,
    `</rss>`,
    "",
  ].join("\n")
}

export function productsJson(base: string, page: FeedPage, meta: { title: string; generatedAt: string }) {
  return {
    title: meta.title,
    home: `${base}/`,
    generatedAt: meta.generatedAt,
    page: page.page,
    pages: page.pages,
    total: page.total,
    next: page.page < page.pages ? absoluteUrl(base, `/feeds/products.json?page=${page.page + 1}`) : null,
    items: page.items,
  }
}
