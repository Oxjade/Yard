import "server-only"
import { and, asc, desc, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm"
import { requestScope } from "../auth/dal"
import { memo } from "../cache"
import { db } from "../db"
import { brands } from "../db/schema"
import { catalogCategories, catalogCollectionProducts, catalogCollections, catalogProducts, catalogVariants, storefrontVersions } from "../db/schema/catalog"
import { notFound } from "../http/errors"
import { loadChildren, toPublicProduct } from "./dto"
import type { PublicProductsQuery } from "./contracts"
import { getSellableVariants, productPublicWhere } from "./sellable"

/**
 * Public catalogue reads. Every read goes through productPublicWhere (published, not hidden,
 * listed brand). Results are memoised in-process for 30 s (src/server/cache.ts) and dropped on any
 * catalog write, so cost scales with time, not traffic.
 */
const TTL = 30_000

const brandSummary = { id: brands.id, handle: brands.handle, name: brands.name, verified: brands.verified, city: brands.city, country: brands.country, currency: brands.currency }

export async function listPublicProducts(q: PublicProductsQuery) {
  await requestScope()
  const key = `catalog:list:${JSON.stringify(q)}`
  return memo(key, TTL, async () => {
    const d = await db()
    const where: (SQL | undefined)[] = [productPublicWhere()]
    if (q.brand) where.push(or(eq(catalogProducts.brandId, q.brand), eq(brands.handle, q.brand)))
    if (q.category) where.push(eq(catalogProducts.categorySlug, q.category))
    if (q.subcategory) where.push(eq(catalogProducts.subcategory, q.subcategory))
    if (q.tag) where.push(sql`${q.tag} = any(${catalogProducts.tags})`)
    if (q.drop) where.push(eq(catalogProducts.dropId, q.drop))
    if (q.ids?.length) where.push(inArray(catalogProducts.id, q.ids))
    if (q.collection)
      where.push(
        exists(
          d
            .select({ one: sql`1` })
            .from(catalogCollectionProducts)
            .innerJoin(catalogCollections, eq(catalogCollections.id, catalogCollectionProducts.collectionId))
            .where(and(eq(catalogCollectionProducts.productId, catalogProducts.id), eq(catalogCollections.status, "published"), or(eq(catalogCollections.id, q.collection), eq(catalogCollections.handle, q.collection)))),
        ),
      )
    if (q.inStock === "1")
      where.push(
        exists(
          d
            .select({ one: sql`1` })
            .from(catalogVariants)
            .where(and(eq(catalogVariants.productId, catalogProducts.id), eq(catalogVariants.status, "active"), sql`${catalogVariants.onHand} > ${catalogVariants.held}`)),
        ),
      )
    const order =
      q.sort === "price_asc"
        ? [asc(catalogProducts.priceMinor), asc(catalogProducts.id)]
        : q.sort === "price_desc"
          ? [desc(catalogProducts.priceMinor), asc(catalogProducts.id)]
          : q.sort === "title"
            ? [asc(catalogProducts.title), asc(catalogProducts.id)]
            : [desc(sql`coalesce(${catalogProducts.publishedAt}, ${catalogProducts.createdAt})`), asc(catalogProducts.id)]
    const rows = await d
      .select({ p: catalogProducts, brand: brandSummary, total: sql<number>`count(*) over ()`.mapWith(Number) })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(and(...where))
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset)
    const kids = await loadChildren(
      d,
      rows.map((r) => r.p.id),
    )
    const total = rows[0]?.total ?? 0
    return {
      products: rows.map((r) => ({ ...toPublicProduct(r.p, kids), brand: r.brand })),
      total,
      nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null,
    }
  })
}

/** One public product by slug or id; 404 for anything not public. */
export async function publicProduct(slugOrId: string) {
  await requestScope()
  return memo(`catalog:product:${slugOrId}`, TTL, async () => {
    const d = await db()
    const [row] = await d
      .select({ p: catalogProducts, brand: brandSummary })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(and(or(eq(catalogProducts.slug, slugOrId), eq(catalogProducts.id, slugOrId)), productPublicWhere()))
      .limit(1)
    if (!row) throw notFound("That piece isn't available.")
    const kids = await loadChildren(d, [row.p.id])
    return { product: { ...toPublicProduct(row.p, kids), brand: row.brand } }
  })
}

export async function publicCategories() {
  await requestScope()
  return memo("catalog:categories", 5 * 60_000, async () => {
    const d = await db()
    const rows = await d.select().from(catalogCategories).orderBy(asc(catalogCategories.position))
    const counts = await d
      .select({ slug: catalogProducts.categorySlug, n: sql<number>`count(*)`.mapWith(Number) })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(productPublicWhere())
      .groupBy(catalogProducts.categorySlug)
    const n = new Map(counts.map((c) => [c.slug, c.n]))
    return { categories: rows.map((c) => ({ slug: c.slug, name: c.name, description: c.description, imagePath: c.imagePath, subcategories: c.subcategories, productCount: n.get(c.slug) ?? 0 })) }
  })
}

async function listedBrandByHandle(handleOrId: string) {
  const d = await db()
  const [b] = await d
    .select()
    .from(brands)
    .where(and(or(eq(brands.handle, handleOrId), eq(brands.id, handleOrId)), sql`${brands.reviewStatus} not in ('restricted', 'suspended')`))
    .limit(1)
  return b ?? null
}

/** A brand's published collections (with product ids that are public). */
async function publicCollectionsOf(brandId: string) {
  const d = await db()
  const cols = await d
    .select()
    .from(catalogCollections)
    .where(and(eq(catalogCollections.brandId, brandId), eq(catalogCollections.status, "published")))
    .orderBy(asc(catalogCollections.position), asc(catalogCollections.name))
  if (!cols.length) return []
  const links = await d
    .select({ collectionId: catalogCollectionProducts.collectionId, productId: catalogCollectionProducts.productId })
    .from(catalogCollectionProducts)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogCollectionProducts.productId))
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(
      and(
        inArray(
          catalogCollectionProducts.collectionId,
          cols.map((c) => c.id),
        ),
        productPublicWhere(),
      ),
    )
    .orderBy(asc(catalogCollectionProducts.position))
  return cols.map((c) => ({
    id: c.id,
    handle: c.handle,
    name: c.name,
    description: c.description,
    imageSrc: c.imageMediaId ? `/api/media/${encodeURIComponent(c.imageMediaId)}` : c.imagePath,
    productIds: links.filter((l) => l.collectionId === c.id).map((l) => l.productId),
  }))
}

export async function publicCollection(brandHandle: string, collection: string) {
  await requestScope()
  return memo(`catalog:collection:${brandHandle}:${collection}`, TTL, async () => {
    const b = await listedBrandByHandle(brandHandle)
    if (!b) throw notFound("That brand isn't on Yard.")
    const c = (await publicCollectionsOf(b.id)).find((x) => x.id === collection || x.handle === collection)
    if (!c) throw notFound("That collection isn't available.")
    return { collection: c, brand: { id: b.id, handle: b.handle, name: b.name } }
  })
}

/** The live storefront: the latest published version, its brand and published collections. */
export async function publicStorefront(handle: string) {
  await requestScope()
  return memo(`catalog:storefront:${handle}`, TTL, async () => {
    const b = await listedBrandByHandle(handle)
    if (!b) throw notFound("That brand isn't on Yard.")
    const d = await db()
    const [v] = await d.select().from(storefrontVersions).where(eq(storefrontVersions.brandId, b.id)).orderBy(desc(storefrontVersions.version)).limit(1)
    const config = v ? { ...v.config } : null
    // Drop section product ids that aren't public any more (hidden, unpublished) at read time.
    if (config && Array.isArray(config.sections)) {
      const ids = new Set<string>()
      for (const s of config.sections as { productIds?: string[] }[]) for (const id of s.productIds ?? []) ids.add(id)
      if (ids.size) {
        const visible = await d
          .select({ id: catalogProducts.id })
          .from(catalogProducts)
          .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
          .where(and(inArray(catalogProducts.id, [...ids]), eq(catalogProducts.brandId, b.id), productPublicWhere()))
        const ok = new Set(visible.map((r) => r.id))
        config.sections = (config.sections as { productIds?: string[] }[]).map((s) => (s.productIds ? { ...s, productIds: s.productIds.filter((id) => ok.has(id)) } : s))
      }
    }
    return {
      brand: { ...b, joinedAt: b.joinedAt },
      storefront: v ? { version: v.version, publishedAt: v.publishedAt.toISOString(), config } : null,
      collections: await publicCollectionsOf(b.id),
    }
  })
}

/** Live price and availability for a cart or PDP (not memoised: availability must be current). */
export async function publicVariants(ids: string[]) {
  await requestScope()
  return { variants: await getSellableVariants(ids) }
}
