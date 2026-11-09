import type { CurrencyCode, CountryCode } from "@/config/markets"
import type { CategorySlug, Product, ProductBadge, ProductOption } from "@/lib/data/types"

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
  images: { src: string; alt: string; width: number | null; height: number | null }[]
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
    price: row.priceMinor / 100,
    ...(row.compareAtMinor == null ? {} : { compareAt: row.compareAtMinor / 100 }),
    currency: row.currency as CurrencyCode,
    images: row.images.map((image) => ({ ...image, width: image.width ?? 1000, height: image.height ?? 1250 })),
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
