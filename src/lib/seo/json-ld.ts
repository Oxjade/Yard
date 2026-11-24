/**
 * schema.org JSON-LD for Yard's public pages: products, brand storefronts, collections (categories,
 * brand collections, drops, charts), breadcrumbs, and Yard itself on the home page. Pure and
 * isomorphic (relative imports only), so pages build it on the server and `tsx --test` checks its
 * shape. Every builder takes facts the page already shows; nothing is invented (no ratings without
 * reviews, no shipping without a brand's own rates). Category-neutral: nothing assumes fashion.
 *
 * Callers pass only public data: a product that is public (page-visibility.ts "public"), its listed
 * brand, public slugs and handles. Internal ids never go into the output.
 */
import { currencies } from "../../config/markets"
import { yardPolicies } from "./policies"
import { absoluteUrl, plainText } from "./url"

export type JsonLdNode = Record<string, unknown>

/** The <script> body: JSON with every "<" escaped (no "</script>" break-out), plus U+2028/2029. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/** One document for one script tag: every node of the page in a single @graph. */
export function jsonLdGraph(nodes: (JsonLdNode | null | undefined | false)[]): JsonLdNode {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) }
}

/* ---------- Money ---------- */

const minorDigits = (currency: string) => (currency in currencies ? currencies[currency as keyof typeof currencies].minor : 2)

/** Minor units as the decimal string schema.org and Merchant Center expect ("12500.00"). */
export function decimalPrice(minor: number, currency: string): string {
  const digits = minorDigits(currency)
  return (minor / 10 ** digits).toFixed(digits)
}

/* ---------- Inputs ---------- */

export type SeoVariant = {
  sku: string
  /** e.g. { Size: "M", Colour: "Black" } */
  options: Record<string, string>
  priceMinor: number
  /** Units that can be bought now (0 when sold out). */
  available: number
}

/** One delivery option of the brand for a set of countries, from the brand's own shipping rates. */
export type SeoShippingOption = {
  countries: string[]
  rateMinor: number
  currency: string
  /** Business days to dispatch. */
  handling: [number, number]
  /** Business days in transit. */
  transit: [number, number]
}

export type SeoBrandRef = { name: string; handle: string; city?: string | null; country?: string | null }

export type SeoProductInput = {
  slug: string
  name: string
  description: string
  images: { src: string; alt?: string }[]
  currency: string
  priceMinor: number
  compareAtMinor?: number | null
  category: { slug: string; name: string }
  subcategory?: string | null
  variants: SeoVariant[]
  brand: SeoBrandRef
  /** False while the brand isn't selling yet (founding brand not claimed / no payout account). */
  forSale: boolean
  /** ISO time an upcoming drop opens: the piece can't be bought before then. */
  releaseAt?: string | null
  shipping?: SeoShippingOption[]
}

export type Availability = "InStock" | "OutOfStock" | "PreOrder"

/* ---------- Shared facts ---------- */

export const productUrl = (base: string, slug: string) => absoluteUrl(base, `/products/${encodeURIComponent(slug)}`)
export const brandUrl = (base: string, handle: string) => absoluteUrl(base, `/brands/${encodeURIComponent(handle)}`)
export const categoryUrl = (base: string, slug: string) => absoluteUrl(base, `/categories/${encodeURIComponent(slug)}`)

/** "Fashion > Outerwear": the category path the page shows, as product_type / category. */
export function categoryPath(category: { name: string }, subcategory?: string | null) {
  return subcategory ? `${category.name} > ${subcategory}` : category.name
}

/**
 * The description a product falls back to when its brand left it empty, from facts alone:
 * "{Product} by {Brand}, {city}. {price}. {category}."
 */
export function fallbackProductDescription(p: { name: string; brand: SeoBrandRef; priceLabel?: string | null; category?: string | null }) {
  const where = p.brand.city ? `, ${p.brand.city}` : ""
  return [`${p.name} by ${p.brand.name}${where}.`, p.priceLabel ? `${p.priceLabel}.` : "", p.category ? `${p.category}.` : ""].filter(Boolean).join(" ")
}

/** A plain price label for descriptions: "NGN 12,500" (no locale symbols, readable by any agent). */
export function priceLabel(minor: number, currency: string) {
  const digits = minorDigits(currency)
  const major = minor / 10 ** digits
  return `${currency} ${major.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(major) ? 0 : digits, maximumFractionDigits: digits })}`
}

export function productDescription(p: SeoProductInput) {
  const own = plainText(p.description, 5000)
  if (own) return own
  return fallbackProductDescription({ name: p.name, brand: p.brand, priceLabel: priceLabel(p.priceMinor, p.currency), category: categoryPath(p.category, p.subcategory) })
}

/** Whether a piece (or one variant) can be bought: an upcoming drop is a pre-order, a brand not selling is out of stock. */
export function availabilityOf(p: Pick<SeoProductInput, "forSale" | "releaseAt">, available: number, now = new Date()): Availability {
  if (!p.forSale) return "OutOfStock"
  if (p.releaseAt && new Date(p.releaseAt).getTime() > now.getTime()) return "PreOrder"
  return available > 0 ? "InStock" : "OutOfStock"
}

/** Yard's minimum returns policy (legal/refunds) as a MerchantReturnPolicy. */
export function returnPolicyJsonLd(base: string): JsonLdNode {
  const r = yardPolicies.returns
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: r.country,
    returnPolicyCountry: r.country,
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: r.days,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    merchantReturnLink: absoluteUrl(base, r.path),
  }
}

const days = ([min, max]: [number, number]) => ({ "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" })

export function shippingDetailsJsonLd(options: SeoShippingOption[] | undefined): JsonLdNode[] {
  return (options ?? []).map((o) => ({
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: decimalPrice(o.rateMinor, o.currency), currency: o.currency },
    shippingDestination: o.countries.map((c) => ({ "@type": "DefinedRegion", addressCountry: c })),
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: days(o.handling), transitTime: days(o.transit) },
  }))
}

/* ---------- Product ---------- */

/** Option names schema.org (and Google's variesBy) knows, by the names brands use. */
const VARIES_BY: Record<string, { key: string; property: string }> = {
  size: { key: "size", property: "https://schema.org/size" },
  colour: { key: "color", property: "https://schema.org/color" },
  color: { key: "color", property: "https://schema.org/color" },
  material: { key: "material", property: "https://schema.org/material" },
  pattern: { key: "pattern", property: "https://schema.org/pattern" },
}

const variesByOf = (name: string) => VARIES_BY[name.trim().toLowerCase()]

/** A variant's label: "Size M, Black". */
export const variantName = (options: Record<string, string>) =>
  Object.entries(options)
    .map(([k, v]) => (k.toLowerCase() === "size" && v !== "One size" ? `Size ${v}` : v))
    .join(", ")

/**
 * Product JSON-LD. One variant (or none): a Product with an Offer. Several variants whose options
 * schema.org can name (size, colour, material, pattern): a ProductGroup with hasVariant and
 * variesBy. Several variants with other option names: a Product with an Offer, or an AggregateOffer
 * when their prices differ.
 */
export function productJsonLd(base: string, p: SeoProductInput, now = new Date()): JsonLdNode {
  const url = productUrl(base, p.slug)
  const images = p.images.map((i) => absoluteUrl(base, i.src))
  const brand = { "@type": "Brand", name: p.brand.name, url: brandUrl(base, p.brand.handle) }
  const seller = { "@type": "Organization", name: p.brand.name, url: brandUrl(base, p.brand.handle) }
  const description = productDescription(p)
  const category = categoryPath(p.category, p.subcategory)
  const shippingDetails = shippingDetailsJsonLd(p.shipping)
  const returns = returnPolicyJsonLd(base)
  const offer = (priceMinor: number, available: number, offerUrl = url): JsonLdNode => {
    const availability = availabilityOf(p, available, now)
    return {
      "@type": "Offer",
      url: offerUrl,
      price: decimalPrice(priceMinor, p.currency),
      priceCurrency: p.currency,
      availability: `https://schema.org/${availability}`,
      ...(availability === "PreOrder" && p.releaseAt ? { availabilityStarts: new Date(p.releaseAt).toISOString() } : {}),
      itemCondition: "https://schema.org/NewCondition",
      seller,
      ...(shippingDetails.length ? { shippingDetails } : {}),
      hasMerchantReturnPolicy: returns,
    }
  }
  const common = { name: p.name, description, url, ...(images.length ? { image: images } : {}), brand, category }
  const variants = p.variants
  const optionNames = [...new Set(variants.flatMap((v) => Object.keys(v.options)))]
  const clean = variants.length > 1 && optionNames.length > 0 && optionNames.every((n) => variesByOf(n)) && new Set(variants.map((v) => variantName(v.options))).size === variants.length

  if (clean) {
    return {
      "@type": "ProductGroup",
      "@id": `${url}#product`,
      ...common,
      productGroupID: p.slug,
      variesBy: [...new Set(optionNames.map((n) => variesByOf(n)!.property))],
      hasVariant: variants.map((v) => {
        const props: Record<string, string> = {}
        for (const [k, value] of Object.entries(v.options)) props[variesByOf(k)!.key] = value
        return {
          "@type": "Product",
          name: `${p.name} (${variantName(v.options)})`,
          sku: v.sku,
          ...props,
          ...(images.length ? { image: images[0] } : {}),
          offers: offer(v.priceMinor, v.available),
        }
      }),
    }
  }

  const total = variants.reduce((n, v) => n + Math.max(0, v.available), 0)
  const prices = variants.length ? variants.map((v) => v.priceMinor) : [p.priceMinor]
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const offers: JsonLdNode =
    low === high
      ? offer(low, total)
      : {
          "@type": "AggregateOffer",
          url,
          lowPrice: decimalPrice(low, p.currency),
          highPrice: decimalPrice(high, p.currency),
          priceCurrency: p.currency,
          offerCount: variants.length,
          availability: `https://schema.org/${availabilityOf(p, total, now)}`,
          itemCondition: "https://schema.org/NewCondition",
          seller,
        }
  return { "@type": "Product", "@id": `${url}#product`, ...common, ...(variants.length === 1 ? { sku: variants[0].sku } : {}), offers }
}

/* ---------- Breadcrumbs, lists, collections ---------- */

export type Crumb = { name: string; path: string }

export function breadcrumbJsonLd(base: string, crumbs: Crumb[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absoluteUrl(base, c.path) })),
  }
}

export type ListEntry = { name: string; path: string; image?: string | null }

/** An ItemList of links (the summary-page pattern: each entry is a URL on Yard). */
export function itemListJsonLd(base: string, entries: ListEntry[], opts: { name?: string; order?: "ascending" | "unordered" } = {}): JsonLdNode {
  return {
    "@type": "ItemList",
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.order === "ascending" ? { itemListOrder: "https://schema.org/ItemListOrderAscending" } : {}),
    numberOfItems: entries.length,
    itemListElement: entries.map((e, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(base, e.path), name: e.name, ...(e.image ? { image: absoluteUrl(base, e.image) } : {}) })),
  }
}

/** A CollectionPage (category, brand collection, drop, charts) with its ItemList as mainEntity. */
export function collectionPageJsonLd(base: string, page: { name: string; description?: string | null; path: string; entries: ListEntry[]; order?: "ascending" | "unordered" }): JsonLdNode {
  const url = absoluteUrl(base, page.path)
  return {
    "@type": "CollectionPage",
    "@id": `${url}#page`,
    name: page.name,
    url,
    ...(page.description ? { description: plainText(page.description, 500) } : {}),
    isPartOf: { "@type": "WebSite", "@id": `${base}/#website` },
    mainEntity: itemListJsonLd(base, page.entries, { name: page.name, order: page.order }),
  }
}

/* ---------- Brand storefront ---------- */

export type SeoBrandInput = {
  name: string
  handle: string
  description?: string | null
  logo?: string | null
  image?: string | null
  city?: string | null
  country?: string | null
  social?: { instagram?: string; tiktok?: string; x?: string; website?: string }
}

/** Public profile links from a brand's handles (handles only, as Studio stores them) or full URLs. */
export function sameAsLinks(social: SeoBrandInput["social"]): string[] {
  if (!social) return []
  const handle = (v: string) => v.trim().replace(/^@/, "")
  const out: string[] = []
  const add = (v: string | undefined, url: (h: string) => string) => {
    if (!v?.trim()) return
    out.push(/^https?:\/\//i.test(v.trim()) ? v.trim() : url(handle(v)))
  }
  add(social.instagram, (h) => `https://www.instagram.com/${encodeURIComponent(h)}`)
  add(social.tiktok, (h) => `https://www.tiktok.com/@${encodeURIComponent(h)}`)
  add(social.x, (h) => `https://x.com/${encodeURIComponent(h)}`)
  if (social.website?.trim() && /^https?:\/\//i.test(social.website.trim())) out.push(social.website.trim())
  return [...new Set(out)]
}

export function brandDescription(b: SeoBrandInput) {
  const own = plainText(b.description, 1000)
  if (own) return own
  const where = [b.city, b.country].filter(Boolean).join(", ")
  return `${b.name}${where ? `, from ${where},` : ""} sells on Yard.`
}

/** The brand as an Organization, plus an ItemList of its live products. */
export function brandJsonLd(base: string, b: SeoBrandInput, products: ListEntry[]): JsonLdNode[] {
  const url = brandUrl(base, b.handle)
  const sameAs = sameAsLinks(b.social)
  const org: JsonLdNode = {
    "@type": "Organization",
    "@id": `${url}#brand`,
    name: b.name,
    url,
    description: brandDescription(b),
    ...(b.logo ? { logo: absoluteUrl(base, b.logo) } : {}),
    ...(b.image ? { image: absoluteUrl(base, b.image) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(b.city || b.country ? { address: { "@type": "PostalAddress", ...(b.city ? { addressLocality: b.city } : {}), ...(b.country ? { addressCountry: b.country } : {}) } } : {}),
  }
  return [org, itemListJsonLd(base, products, { name: `Products from ${b.name}` })]
}

/* ---------- Yard itself (home) ---------- */

export function yardJsonLd(base: string, site: { name: string; description: string; logoPath: string; sameAs?: string[]; searchPath: string }): JsonLdNode[] {
  return [
    {
      "@type": "Organization",
      "@id": `${base}/#organization`,
      name: site.name,
      url: `${base}/`,
      logo: absoluteUrl(base, site.logoPath),
      description: site.description,
      ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: yardPolicies.supportEmail },
    },
    {
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: site.name,
      url: `${base}/`,
      description: site.description,
      publisher: { "@id": `${base}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(base, site.searchPath)}?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ]
}
