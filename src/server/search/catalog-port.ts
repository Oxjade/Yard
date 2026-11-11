import "server-only"
import { productById } from "@/lib/data/products"

/**
 * How ENGAGEMENT reads the catalogue: only through CATALOG's contract functions (never its
 * tables). Loaded with a dynamic import, because CATALOG imports reindexProduct from search and a
 * static import both ways would be a cycle.
 *
 * `getProductForSearch` is OPTIONAL (not in the shared contract): when CATALOG exports it,
 * reindexProduct(productId) indexes the live product; otherwise the sample catalogue
 * (src/lib/data/products) is the fallback source, and CATALOG can pass the document itself as
 * reindexProduct's second argument.
 */
export type SellableVariant = { variantId: string; productId: string; brandId: string; title: string; variantLabel: string; priceMinor: number; currency: string; available: number; imagePath?: string }

/** What the search index needs about one product. */
export type SearchProductDoc = {
  productId: string
  brandId: string
  title: string
  slug?: string | null
  description?: string | null
  category?: string | null
  subcategory?: string | null
  sizes?: string[]
  tags?: string[]
  priceMinor: number
  compareAtMinor?: number | null
  currency: string
  available: number
  variantIds: string[]
  image?: string | null
  /** False when unpublished, archived or hidden by moderation. */
  visible: boolean
  publishedAt?: Date | string | null
}

type CatalogModule = {
  getSellableVariants: (variantIds: string[]) => Promise<SellableVariant[]>
  getProductForSearch?: (productId: string) => Promise<SearchProductDoc | null>
}

async function loadCatalog(): Promise<CatalogModule | null> {
  try {
    const mod = (await import("../catalog")) as unknown as Partial<CatalogModule>
    return typeof mod.getSellableVariants === "function" ? (mod as CatalogModule) : null
  } catch {
    return null
  }
}

/** Live prices and availability for variants (CATALOG contract). Empty when CATALOG isn't loaded. */
export async function sellableVariants(variantIds: string[]): Promise<SellableVariant[]> {
  if (!variantIds.length) return []
  const c = await loadCatalog()
  if (!c) return []
  const out: SellableVariant[] = []
  for (let i = 0; i < variantIds.length; i += 200) out.push(...(await c.getSellableVariants(variantIds.slice(i, i + 200))))
  return out
}

/** The sample catalogue's view of a product, or null. */
export function sampleProductDoc(productId: string): SearchProductDoc | null {
  const p = productById.get(productId)
  if (!p) return null
  return {
    productId: p.id,
    brandId: p.brandId,
    title: p.name,
    slug: p.slug,
    description: p.description,
    category: p.category,
    subcategory: p.subcategory,
    sizes: [...new Set(p.variants.filter((v) => Math.max(0, v.stock - v.reserved) > 0 && v.options.Size && v.options.Size !== "One size").map((v) => v.options.Size))],
    tags: p.tags,
    priceMinor: p.price,
    compareAtMinor: p.compareAt ?? null,
    currency: p.currency,
    available: p.variants.reduce((n, v) => n + Math.max(0, v.stock - v.reserved), 0),
    variantIds: p.variants.map((v) => v.id),
    image: p.images[0]?.src ?? null,
    visible: p.status === "published",
    publishedAt: p.createdAt,
  }
}

/**
 * The product as the search index should see it: CATALOG's getProductForSearch when exported,
 * else the sample catalogue. `undefined` means no source knows the product.
 */
export async function productDoc(productId: string): Promise<SearchProductDoc | null | undefined> {
  const c = await loadCatalog()
  if (c?.getProductForSearch) return c.getProductForSearch(productId)
  return sampleProductDoc(productId) ?? undefined
}

/** True when CATALOG's live product source is available. */
export async function hasLiveCatalog() {
  return !!(await loadCatalog())?.getProductForSearch
}
