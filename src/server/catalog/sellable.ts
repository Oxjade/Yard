import "server-only"
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm"
import { brands } from "../db/schema"
import { catalogImages, catalogProducts, catalogVariants } from "../db/schema/catalog"
import { db, type Executor } from "../db"
import { mediaSrc } from "../media"
import { variantLabelOf } from "./dto"

/**
 * The one public-visibility predicate for products: published (or scheduled and due, before the
 * job flips it), not hidden by moderation, of a listed brand (not restricted or suspended).
 */
export function productPublicWhere(now = new Date()) {
  return and(
    or(eq(catalogProducts.status, "published"), and(eq(catalogProducts.status, "scheduled"), lte(catalogProducts.publishAt, now))),
    eq(catalogProducts.moderationStatus, "ok"),
    sql`${brands.reviewStatus} not in ('restricted', 'suspended')`,
  )
}

/** Which of `variantIds` can be sold right now (active variant of a public product). */
export async function isSellable(tx: Executor, variantIds: string[]): Promise<Set<string>> {
  if (!variantIds.length) return new Set()
  const rows = await tx
    .select({ id: catalogVariants.id })
    .from(catalogVariants)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(and(inArray(catalogVariants.id, variantIds), eq(catalogVariants.status, "active"), productPublicWhere()))
  return new Set(rows.map((r) => r.id))
}

export function imageSrc(img: { mediaId: string | null; path: string | null }, as?: "brand") {
  if (img.mediaId) return mediaSrc(img.mediaId, as)
  return img.path ?? undefined
}

/**
 * CATALOG contract: the sellable variants among `variantIds` with live price and availability.
 * Variants that don't exist or can't be sold (unpublished, hidden, archived, unlisted brand) are
 * left out, so the caller treats a missing id as unavailable. Joins the caller's transaction.
 */
export async function getSellableVariants(variantIds: string[]): Promise<
  { variantId: string; productId: string; brandId: string; title: string; variantLabel: string; priceMinor: number; currency: string; available: number; imagePath?: string }[]
> {
  const ids = [...new Set(variantIds.filter((v) => typeof v === "string" && v))].slice(0, 500)
  if (!ids.length) return []
  const d = await db()
  const rows = await d
    .select({
      variantId: catalogVariants.id,
      productId: catalogProducts.id,
      brandId: catalogProducts.brandId,
      title: catalogProducts.title,
      options: catalogVariants.options,
      variantPrice: catalogVariants.priceMinor,
      productPrice: catalogProducts.priceMinor,
      currency: catalogProducts.currency,
      onHand: catalogVariants.onHand,
      held: catalogVariants.held,
    })
    .from(catalogVariants)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(and(inArray(catalogVariants.id, ids), eq(catalogVariants.status, "active"), productPublicWhere()))
  if (!rows.length) return []
  const productIds = [...new Set(rows.map((r) => r.productId))]
  const imgs = await d
    .select({ productId: catalogImages.productId, mediaId: catalogImages.mediaId, path: catalogImages.path, position: catalogImages.position })
    .from(catalogImages)
    .where(inArray(catalogImages.productId, productIds))
    .orderBy(asc(catalogImages.productId), asc(catalogImages.position))
  const first = new Map<string, { mediaId: string | null; path: string | null }>()
  for (const i of imgs) if (!first.has(i.productId)) first.set(i.productId, i)
  return rows.map((r) => {
    const img = first.get(r.productId)
    const imagePath = img ? imageSrc(img) : undefined
    return {
      variantId: r.variantId,
      productId: r.productId,
      brandId: r.brandId,
      title: r.title,
      variantLabel: variantLabelOf(r.options),
      priceMinor: r.variantPrice ?? r.productPrice,
      currency: r.currency,
      available: Math.max(0, r.onHand - r.held),
      ...(imagePath ? { imagePath } : {}),
    }
  })
}

/**
 * Optional ENGAGEMENT hook (src/server/search/catalog-port.ts): the product as the search index
 * should see it. Null when the product doesn't exist; `visible` is false when it isn't public.
 */
export async function getProductForSearch(productId: string): Promise<{
  productId: string
  brandId: string
  title: string
  slug: string
  description: string
  category: string
  subcategory: string | null
  tags: string[]
  priceMinor: number
  compareAtMinor: number | null
  currency: string
  available: number
  variantIds: string[]
  image: string | null
  visible: boolean
  publishedAt: Date | null
} | null> {
  const d = await db()
  const [row] = await d
    .select({ p: catalogProducts, review: brands.reviewStatus })
    .from(catalogProducts)
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(eq(catalogProducts.id, productId))
    .limit(1)
  if (!row) return null
  const p = row.p
  const [variants, [img], [pub]] = await Promise.all([
    d.select({ id: catalogVariants.id, onHand: catalogVariants.onHand, held: catalogVariants.held }).from(catalogVariants).where(and(eq(catalogVariants.productId, p.id), eq(catalogVariants.status, "active"))),
    d.select({ mediaId: catalogImages.mediaId, path: catalogImages.path }).from(catalogImages).where(eq(catalogImages.productId, p.id)).orderBy(asc(catalogImages.position)).limit(1),
    d.select({ id: catalogProducts.id }).from(catalogProducts).innerJoin(brands, eq(brands.id, catalogProducts.brandId)).where(and(eq(catalogProducts.id, p.id), productPublicWhere())).limit(1),
  ])
  return {
    productId: p.id,
    brandId: p.brandId,
    title: p.title,
    slug: p.slug,
    description: p.description,
    category: p.categorySlug,
    subcategory: p.subcategory,
    tags: p.tags,
    priceMinor: p.priceMinor,
    compareAtMinor: p.compareAtMinor,
    currency: p.currency,
    available: variants.reduce((n, v) => n + Math.max(0, v.onHand - v.held), 0),
    variantIds: variants.map((v) => v.id),
    image: img ? (imageSrc(img) ?? null) : null,
    visible: !!pub,
    publishedAt: p.publishedAt,
  }
}
