import "server-only"
import { asc, inArray } from "drizzle-orm"
import { catalogCollectionProducts, catalogImages, catalogOptions, catalogProducts, catalogVariants } from "../db/schema/catalog"
import type { Executor } from "../db"
import { mediaSrc } from "../media"

/** "Size M, Black" — the same wording as src/lib/data/products.ts variantLabel. */
export function variantLabelOf(options: Record<string, string> | null | undefined) {
  return Object.entries(options ?? {})
    .map(([k, v]) => (k === "Size" && v !== "One size" ? `Size ${v}` : v))
    .join(", ")
}

export type ProductRow = typeof catalogProducts.$inferSelect

export type ImageDto = { id: string; src: string; alt: string; width: number | null; height: number | null; mediaId: string | null }
export type VariantDto = { id: string; sku: string; options: Record<string, string>; label: string; priceMinor: number; available: number; inStock: boolean }
export type StudioVariantDto = VariantDto & { status: string; onHand: number; held: number; priceOverrideMinor: number | null }

export type PublicProductDto = {
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
  images: ImageDto[]
  options: { name: string; values: { value: string; hex?: string }[] }[]
  variants: VariantDto[]
  available: number
  processingDays: [number, number] | null
  dropId: string | null
  collectionIds: string[]
  publishedAt: string | null
  createdAt: string
}

export type StudioProductDto = Omit<PublicProductDto, "variants"> & {
  status: string
  publishAt: string | null
  moderationStatus: string
  moderationReason: string | null
  version: number
  updatedAt: string
  variants: StudioVariantDto[]
}

type Loaded = {
  options: Map<string, (typeof catalogOptions.$inferSelect)[]>
  variants: Map<string, (typeof catalogVariants.$inferSelect)[]>
  images: Map<string, (typeof catalogImages.$inferSelect)[]>
  collections: Map<string, string[]>
}

function group<T, K>(rows: T[], key: (r: T) => K) {
  const m = new Map<K, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

/** Loads options, variants, images and collection links for many products in four queries. */
export async function loadChildren(d: Executor, productIds: string[]): Promise<Loaded> {
  if (!productIds.length) return { options: new Map(), variants: new Map(), images: new Map(), collections: new Map() }
  const [options, variants, images, links] = await Promise.all([
    d.select().from(catalogOptions).where(inArray(catalogOptions.productId, productIds)).orderBy(asc(catalogOptions.position)),
    d.select().from(catalogVariants).where(inArray(catalogVariants.productId, productIds)).orderBy(asc(catalogVariants.position), asc(catalogVariants.id)),
    d.select().from(catalogImages).where(inArray(catalogImages.productId, productIds)).orderBy(asc(catalogImages.position)),
    d.select().from(catalogCollectionProducts).where(inArray(catalogCollectionProducts.productId, productIds)),
  ])
  const collections = new Map<string, string[]>()
  for (const l of links) collections.set(l.productId, [...(collections.get(l.productId) ?? []), l.collectionId])
  return { options: group(options, (o) => o.productId), variants: group(variants, (v) => v.productId), images: group(images, (i) => i.productId), collections }
}

function imageDto(i: typeof catalogImages.$inferSelect, as?: "brand"): ImageDto {
  return { id: i.id, src: i.mediaId ? mediaSrc(i.mediaId, as) : (i.path ?? "/media/missing.svg"), alt: i.alt, width: i.width, height: i.height, mediaId: i.mediaId }
}

function base(p: ProductRow, kids: Loaded, as?: "brand") {
  return {
    id: p.id,
    slug: p.slug,
    brandId: p.brandId,
    title: p.title,
    description: p.description,
    details: p.details,
    category: p.categorySlug,
    subcategory: p.subcategory,
    tags: p.tags,
    badges: p.badges,
    priceMinor: p.priceMinor,
    compareAtMinor: p.compareAtMinor,
    currency: p.currency,
    images: (kids.images.get(p.id) ?? []).map((i) => imageDto(i, as)),
    options: (kids.options.get(p.id) ?? []).map((o) => ({ name: o.name, values: o.values })),
    processingDays: p.processingMin != null && p.processingMax != null ? ([p.processingMin, p.processingMax] as [number, number]) : null,
    dropId: p.dropId,
    collectionIds: kids.collections.get(p.id) ?? [],
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

export function toPublicProduct(p: ProductRow, kids: Loaded): PublicProductDto {
  const variants = (kids.variants.get(p.id) ?? [])
    .filter((v) => v.status === "active")
    .map((v) => {
      const available = Math.max(0, v.onHand - v.held)
      return { id: v.id, sku: v.sku, options: v.options, label: variantLabelOf(v.options), priceMinor: v.priceMinor ?? p.priceMinor, available, inStock: available > 0 }
    })
  return { ...base(p, kids), variants, available: variants.reduce((n, v) => n + v.available, 0) }
}

export function toStudioProduct(p: ProductRow, kids: Loaded): StudioProductDto {
  const variants = (kids.variants.get(p.id) ?? []).map((v) => {
    const available = Math.max(0, v.onHand - v.held)
    return { id: v.id, sku: v.sku, options: v.options, label: variantLabelOf(v.options), priceMinor: v.priceMinor ?? p.priceMinor, priceOverrideMinor: v.priceMinor, available, inStock: available > 0, status: v.status, onHand: v.onHand, held: v.held }
  })
  return {
    ...base(p, kids, "brand"),
    variants,
    available: variants.filter((v) => v.status === "active").reduce((n, v) => n + v.available, 0),
    status: p.status,
    publishAt: p.publishAt?.toISOString() ?? null,
    moderationStatus: p.moderationStatus,
    moderationReason: p.moderationReason,
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
  }
}
