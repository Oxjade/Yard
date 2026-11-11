import type { CurrencyCode, CountryCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import { brandByHandle } from "@/lib/data/brands"
import type { Brand, CategorySlug, Product, ProductBadge, ProductOption } from "@/lib/data/types"

export type PublicCatalogProduct = {
  id: string
  slug: string
  brandId: string
  title: string
  description: string
  details: string[]
  category: string
  subcategory: string | null
  tags: string[]
  badges: string[]
  priceMinor: number
  compareAtMinor: number | null
  currency: string
  images: { src: string; alt: string; width: number | null; height: number | null; mediaId?: string | null }[]
  options: { name: string; values: { value: string; hex?: string }[] }[]
  variants: { id: string; sku: string; options: Record<string, string>; priceMinor: number; available: number }[]
  processingDays: [number, number] | null
  dropId: string | null
  collectionIds: string[]
  createdAt: string
  brand: { id: string; handle: string; name: string; verified: boolean; city: string; country: string }
}

type PublicCatalogPage = { products: PublicCatalogProduct[]; total: number; nextOffset: number | null }

export function toCatalogProduct(row: PublicCatalogProduct): Product {
  return {
    id: row.id,
    slug: row.slug,
    brandId: row.brandId,
    brandSummary: { ...row.brand, country: row.brand.country as CountryCode },
    name: row.title,
    description: row.description,
    details: row.details,
    category: row.category as CategorySlug,
    subcategory: row.subcategory ?? "",
    tags: row.tags,
    price: row.priceMinor,
    ...(row.compareAtMinor == null ? {} : { compareAt: row.compareAtMinor }),
    currency: row.currency as CurrencyCode,
    images: row.images.map(({ mediaId, ...image }) => ({ ...image, ...(mediaId ? { mediaId } : {}), width: image.width ?? 1000, height: image.height ?? 1250 })),
    options: row.options.map((option) => ({ name: option.name, values: option.values.map(({ value, hex }) => (option.name === "Colour" ? { name: value, hex: hex ?? "#777777" } : value)) })) as ProductOption[],
    variants: row.variants.map((variant) => ({ ...variant, stock: variant.available, reserved: 0 })),
    badges: row.badges as ProductBadge[],
    status: "published",
    createdAt: row.createdAt,
    ...(row.processingDays ? { processingDays: row.processingDays } : {}),
    collectionIds: row.collectionIds,
    ...(row.dropId ? { dropId: row.dropId } : {}),
    stats: { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
  }
}

/**
 * The Brand a live product is shown with. A sample brand keeps its full profile; a brand that only
 * exists on the server gets a plain profile built from the product's brand summary.
 */
export function catalogBrand(product: Product, known?: Brand): Brand {
  const summary = product.brandSummary
  if (known) return summary ? { ...known, ...summary } : known
  const s = summary ?? { id: product.brandId, handle: "", name: "Independent brand", verified: false, city: "", country: "NG" as CountryCode }
  return {
    ...s,
    tagline: `Independent pieces from ${s.name}.`,
    description: "",
    story: [],
    mark: { text: s.name.slice(0, 2).toUpperCase(), style: "condensed" },
    cover: product.images[0] ?? { src: "/media/missing.svg", alt: s.name, width: 1000, height: 1250 },
    currency: product.currency,
    categories: [product.category],
    aesthetics: ["contemporary"],
    founded: new Date().getFullYear(),
    founder: { name: s.name, role: "Independent brand" },
    followers: 0,
    followerGrowth30d: 0,
    joinedAt: product.createdAt.slice(0, 10),
    social: {},
    storefront: { template: "editorial", accent: "ink", typePreset: "grotesk", intro: "", sections: [] },
    shipsFrom: s.country,
    processingDays: product.processingDays ?? [2, 5],
    returnsDays: 14,
  }
}

/**
 * Where a brand link goes. Storefront pages exist for the sample brands only, so a brand that only
 * exists on the server links to its pieces in the shop instead of a storefront that would 404.
 */
export function brandHref(handle: string) {
  return brandByHandle.has(handle) ? `/brands/${handle}` : `/shop?brands=${encodeURIComponent(handle)}`
}

/** Loads the complete public DB catalogue using the API's bounded page size. */
export async function loadPublicCatalog(): Promise<Product[]> {
  const products: Product[] = []
  let offset = 0

  do {
    const response = await fetch(`/api/catalog/products?limit=60&offset=${offset}`, { credentials: "same-origin" })
    if (!response.ok) throw new Error("The shop catalogue could not be loaded.")
    const page = (await response.json()) as PublicCatalogPage
    products.push(...page.products.map(toCatalogProduct))
    if (page.nextOffset === null || page.nextOffset <= offset) break
    offset = page.nextOffset
  } while (offset <= 5000)

  return products
}

/** Hydrate a bounded search page while preserving the search index's ranking order. */
export async function loadPublicProductsByIds(ids: string[], signal?: AbortSignal): Promise<Product[]> {
  if (!ids.length) return []
  const query = new URLSearchParams()
  ids.forEach((id) => query.append("ids", id))
  const page = await api<PublicCatalogPage>(`/api/catalog/products?${query}`, { signal })
  const productsById = new Map(page.products.map((product) => [product.id, toCatalogProduct(product)]))
  return ids.flatMap((id) => {
    const product = productsById.get(id)
    return product ? [product] : []
  })
}
