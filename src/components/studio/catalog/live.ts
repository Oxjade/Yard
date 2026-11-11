import { api } from "@/lib/api/client"
import type { StudioCollectionDto, StudioCollectionsResponse, StudioProductCreateBody, StudioProductDto, StudioProductsPage } from "@/lib/api/contracts/catalog"
import type { CategorySlug, Collection, Product, ProductBadge, ProductOption, ProductStatus } from "@/lib/data/types"

export type StudioProduct = Product & { version: number }

const productStatuses: ProductStatus[] = ["draft", "published", "scheduled", "archived"]
const productBadges: ProductBadge[] = ["new", "limited", "restock", "exclusive", "last-pieces"]

export function fromStudioProduct(dto: StudioProductDto): StudioProduct {
  const options: ProductOption[] = []
  for (const option of dto.options) {
    if (option.name === "Size") options.push({ name: "Size", values: option.values.map((value) => value.value) })
    if (option.name === "Colour") options.push({ name: "Colour", values: option.values.map((value) => ({ name: value.value, hex: value.hex ?? "#777777" })) })
  }
  const badges = dto.badges.filter((badge): badge is ProductBadge => productBadges.includes(badge as ProductBadge))
  return {
    id: dto.id,
    slug: dto.slug,
    brandId: dto.brandId,
    name: dto.title,
    description: dto.description,
    details: dto.details,
    category: dto.category as CategorySlug,
    subcategory: dto.subcategory ?? "",
    tags: dto.tags,
    price: dto.priceMinor,
    ...(dto.compareAtMinor != null ? { compareAt: dto.compareAtMinor } : {}),
    currency: dto.currency as Product["currency"],
    images: dto.images.map((image) => ({ src: image.src, alt: image.alt, width: image.width ?? 1200, height: image.height ?? 1500, imageId: image.id, ...(image.mediaId ? { mediaId: image.mediaId } : {}) })),
    options,
    variants: dto.variants
      .filter((variant) => variant.status === "active")
      .map((variant) => ({ id: variant.id, sku: variant.sku, options: variant.options, stock: variant.onHand, reserved: variant.held, priceOverrideMinor: variant.priceOverrideMinor })),
    badges,
    status: productStatuses.includes(dto.status as ProductStatus) ? dto.status as ProductStatus : "draft",
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...(dto.publishAt ? { publishAt: dto.publishAt } : {}),
    ...(dto.processingDays ? { processingDays: dto.processingDays } : {}),
    collectionIds: dto.collectionIds,
    ...(dto.dropId ? { dropId: dto.dropId } : {}),
    stats: { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
    version: dto.version,
  }
}

export async function loadStudioProductDtos() {
  const products: StudioProductDto[] = []
  let offset = 0
  for (;;) {
    const page = await api<StudioProductsPage>("/api/studio/catalog/products", { query: { status: "all", limit: 100, offset } })
    products.push(...page.products)
    if (page.nextOffset == null) return products
    offset = page.nextOffset
  }
}

function copyTitle(title: string, taken: Set<string>) {
  const base = title.replace(/ copy( \d+)?$/, "").slice(0, 70)
  let name = `${base} copy`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} copy ${n}`
  return name
}

function copySku(sku: string, taken: Set<string>) {
  const base = `${sku.slice(0, 55)}-COPY`
  let next = base
  for (let n = 2; taken.has(next.toUpperCase()); n++) next = `${base}${n}`
  taken.add(next.toUpperCase())
  return next
}

export function duplicateProductBody(dto: StudioProductDto, titles: Set<string>, skus: Set<string>): StudioProductCreateBody {
  return {
    title: copyTitle(dto.title, titles),
    description: dto.description,
    details: dto.details,
    categorySlug: dto.category,
    subcategory: dto.subcategory,
    tags: dto.tags,
    badges: ["new"],
    priceMinor: dto.priceMinor,
    compareAtMinor: dto.compareAtMinor,
    processingDays: dto.processingDays,
    dropId: null,
    options: dto.options,
    variants: dto.variants
      .filter((variant) => variant.status === "active")
      .map((variant) => ({ sku: copySku(variant.sku, skus), options: variant.options, priceMinor: variant.priceOverrideMinor })),
    images: dto.images.flatMap((image) => (image.mediaId ? [{ mediaId: image.mediaId, alt: image.alt }] : [])),
    collectionIds: dto.collectionIds,
  }
}

const COLLECTIONS_KEY = "studio.catalog.collections"

export function fromStudioCollection(dto: StudioCollectionDto, brandId: string): Collection {
  return {
    id: dto.id,
    brandId,
    handle: dto.handle,
    name: dto.name,
    description: dto.description,
    image: {
      src: dto.imageSrc ?? "/media/missing.svg",
      alt: dto.name,
      width: 1200,
      height: 1500,
      ...(dto.imageMediaId ? { mediaId: dto.imageMediaId } : {}),
    },
    productIds: dto.productIds,
    status: dto.status === "published" ? "published" : "draft",
    position: dto.position,
    version: dto.version,
  }
}

export const studioCollectionsKey = (brandId: string) => `${COLLECTIONS_KEY}:${brandId}`

export async function loadStudioCollections() {
  const result = await api<StudioCollectionsResponse>("/api/studio/catalog/collections")
  return result.collections
}
