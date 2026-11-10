import "server-only"
import { desc, eq, ne, sql } from "drizzle-orm"
import { db } from "../db"
import { brands } from "../db/schema"
import { catalogProducts } from "../db/schema/catalog"
import { mediaSrc } from "../media"
import { loadChildren } from "./dto"

/** Products the Control Center can moderate. Archived products aren't listed for sale, so they're left out. */
export async function listAdminCatalogProducts(limit = 200) {
  const d = await db()
  const rows = await d
    .select({ p: catalogProducts, brandName: brands.name, brandHandle: brands.handle, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(catalogProducts)
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(ne(catalogProducts.status, "archived"))
    .orderBy(desc(catalogProducts.updatedAt), catalogProducts.id)
    .limit(limit)
  const kids = await loadChildren(
    d,
    rows.map((r) => r.p.id),
  )
  return {
    products: rows.map(({ p, brandName, brandHandle }) => {
      const image = kids.images.get(p.id)?.[0]
      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        brandId: p.brandId,
        brandName,
        brandHandle,
        category: p.categorySlug,
        subcategory: p.subcategory,
        priceMinor: p.priceMinor,
        currency: p.currency,
        status: p.status,
        moderationStatus: p.moderationStatus,
        moderationReason: p.moderationReason,
        imageSrc: image ? (image.mediaId ? mediaSrc(image.mediaId, "admin") : (image.path ?? null)) : null,
        updatedAt: p.updatedAt.toISOString(),
      }
    }),
    total: rows[0]?.total ?? 0,
  }
}
