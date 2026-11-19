import type { ImportAvailability, ImportBrandDto } from "@/lib/api/contracts/imports"
import { htmlToText, isType, jsonLd, ldImages, ldText, linkRel, meta, type LdNode } from "../html"
import type { RawProduct } from "../normalize"
import { sameSite } from "../url"

/** Instagram and TikTok handles from profile links; other links kept as they are. */
export function socialsOf(urls: string[]): ImportBrandDto["socials"] {
  let instagram: string | null = null
  let tiktok: string | null = null
  const links: string[] = []
  for (const raw of urls) {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      continue
    }
    const host = u.hostname.replace(/^www\./, "").toLowerCase()
    const first = u.pathname.split("/").filter(Boolean)[0] ?? ""
    if (host === "instagram.com" && /^[A-Za-z0-9._]{1,30}$/.test(first) && !["p", "reel", "explore", "stories"].includes(first)) instagram ??= first
    else if (host === "tiktok.com" && /^@[A-Za-z0-9._]{1,24}$/.test(first)) tiktok ??= first.slice(1)
    else if (/^https?:$/.test(u.protocol)) links.push(u.toString())
  }
  return { instagram, tiktok, links: [...new Set(links)].slice(0, 10) }
}

const ORG_TYPES = ["Organization", "Store", "OnlineStore", "Brand", "LocalBusiness", "ClothingStore", "Corporation"]

/**
 * The brand as the home page describes it: the Organization/Store JSON-LD node that belongs to
 * this site (a platform's own node, like Labeld's or Shopify's, is skipped), then OpenGraph and the
 * meta description, then the touch icon as a logo.
 */
export function brandFromHtml(html: string, pageUrl: string): ImportBrandDto {
  const nodes = jsonLd(html).filter((n) => isType(n, ...ORG_TYPES))
  const own = nodes.filter((n) => {
    const u = ldText(n.url) ?? ldText(n["@id"])
    return !u || sameSite(new URL(u, pageUrl), pageUrl)
  })
  const pick = (k: string) => {
    for (const n of own) {
      const v = k === "logo" || k === "image" ? (ldImages(n[k])[0] ?? null) : ldText(n[k])
      if (v) return v
    }
    return null
  }
  const sameAs = own.flatMap((n) => (Array.isArray(n.sameAs) ? n.sameAs : n.sameAs ? [n.sameAs] : [])).filter((x): x is string => typeof x === "string")
  const abs = (u: string | null) => {
    if (!u) return null
    try {
      return new URL(u, pageUrl).toString()
    } catch {
      return null
    }
  }
  const description = pick("description") ?? meta(html, "og:description") ?? meta(html, "description")
  return {
    name: pick("name") ?? meta(html, "og:site_name"),
    logo: abs(pick("logo") ?? linkRel(html, "apple-touch-icon")),
    banner: abs(pick("image") ?? meta(html, "og:image")),
    description: description ? htmlToText(description, 2000) : null,
    socials: socialsOf(sameAs),
  }
}

const AVAILABILITY: Record<string, ImportAvailability> = {
  instock: "in_stock",
  limitedavailability: "in_stock",
  onlineonly: "in_stock",
  instoreonly: "in_stock",
  outofstock: "out_of_stock",
  soldout: "out_of_stock",
  discontinued: "out_of_stock",
  preorder: "preorder",
  presale: "preorder",
  backorder: "preorder",
}

export function availabilityOf(v: unknown): ImportAvailability | undefined {
  const s = ldText(v)
  if (!s) return undefined
  return AVAILABILITY[s.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase()]
}

function offersOf(n: LdNode): LdNode[] {
  const o = n.offers
  const list = (Array.isArray(o) ? o : o ? [o] : []).filter((x): x is LdNode => !!x && typeof x === "object")
  // AggregateOffer: its own low price, or its listed offers.
  return list.flatMap((x) => (isType(x, "AggregateOffer") && Array.isArray(x.offers) ? (x.offers as LdNode[]) : [x]))
}

function priceOf(offer: LdNode | undefined) {
  if (!offer) return { price: null, currency: null }
  const spec = Array.isArray(offer.priceSpecification) ? (offer.priceSpecification[0] as LdNode) : (offer.priceSpecification as LdNode | undefined)
  const price = offer.price ?? offer.lowPrice ?? spec?.price ?? null
  const currency = ldText(offer.priceCurrency ?? spec?.priceCurrency)
  return { price: typeof price === "number" || typeof price === "string" ? price : null, currency }
}

/**
 * A schema.org Product (or ProductGroup with hasVariant) as a RawProduct. Variants' size and color
 * become Size and Colour options; offers give price, currency and availability.
 */
export function productFromLd(n: LdNode, pageUrl: string): RawProduct | null {
  const name = ldText(n.name)
  if (!name) return null
  const url = ldText(n.url) ?? pageUrl
  let sourceUrl = pageUrl
  try {
    sourceUrl = new URL(url, pageUrl).toString()
  } catch {
    /* keep the page */
  }
  const offers = offersOf(n)
  const first = priceOf(offers[0])
  const variantsLd = (Array.isArray(n.hasVariant) ? n.hasVariant : []).filter((x): x is LdNode => !!x && typeof x === "object")
  const sizes = new Map<string, true>()
  const colors = new Map<string, true>()
  const variants: NonNullable<RawProduct["variants"]> = []
  const images = ldImages(n.image)
  let currency = first.currency
  for (const v of variantsLd) {
    const size = ldText(v.size)
    const color = ldText(v.color)
    if (size) sizes.set(size, true)
    if (color) colors.set(color, true)
    const vo = offersOf(v)[0]
    const p = priceOf(vo)
    currency ??= p.currency
    const avail = availabilityOf(vo?.availability)
    variants.push({ options: { ...(size ? { Size: size } : {}), ...(color ? { Colour: color } : {}) }, price: p.price, available: avail ? avail !== "out_of_stock" : null })
    images.push(...ldImages(v.image))
  }
  // Offers named by size on a plain Product ("S", "M") are variants too.
  if (!variantsLd.length && offers.length > 1) {
    for (const o of offers) {
      const label = ldText(o.name) ?? ldText((o.itemOffered as LdNode | undefined)?.size)
      if (!label || label === name) continue
      sizes.set(label, true)
      const avail = availabilityOf(o.availability)
      variants.push({ options: { Size: label }, price: priceOf(o).price, available: avail ? avail !== "out_of_stock" : null })
    }
  }
  const options = [...(sizes.size ? [{ name: "Size", values: [...sizes.keys()].map((value) => ({ value })) }] : []), ...(colors.size ? [{ name: "Colour", values: [...colors.keys()].map((value) => ({ value })) }] : [])]
  const sizeOnly = ldText(n.size)
  if (!options.length && sizeOnly) options.push({ name: "Size", values: sizeOnly.split(/\s*[,/|]\s*/).map((value) => ({ value })) })
  const availability = availabilityOf(offers[0]?.availability)
  return {
    sourceUrl,
    sourceId: ldText(n.productID) ?? ldText(n.productGroupID) ?? ldText(n.sku) ?? null,
    title: name,
    description: ldText(n.description),
    price: first.price,
    currency,
    images,
    options,
    variants,
    availability,
    productType: ldText(n.category),
    tags: [],
  }
}
