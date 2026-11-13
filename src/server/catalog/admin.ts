import "server-only"
import { and, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm"
import { db } from "../db"
import { brands } from "../db/schema"
import { catalogProducts } from "../db/schema/catalog"
import { badRequest } from "../http/errors"
import { mediaSrc } from "../media"
import { loadChildren } from "./dto"
import { notSampleBrandSql } from "./sample-guard"

export type AdminCatalogProductsQuery = {
  limit?: number
  /** "<iso updatedAt>|<id>" from the previous page's nextCursor. */
  cursor?: string
  /** Matches the title, the brand's name or its handle. */
  q?: string
  /** hidden: restricted by Yard; ok: not restricted. */
  moderation?: "hidden" | "ok"
  category?: string
}

// Postgres keeps microseconds; a cursor carries milliseconds. Paging on the truncated time keeps the keyset exact.
const updatedMs = sql`date_trunc('milliseconds', ${catalogProducts.updatedAt})`
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Products the Control Center can moderate, newest edit first, one keyset page at a time.
 * Archived products aren't listed for sale, so they're left out. `total` and `hidden` count every
 * non-archived product (not just this page or this filter); `matching` counts the filter.
 */
export async function listAdminCatalogProducts(query: AdminCatalogProductsQuery = {}) {
  const limit = query.limit ?? 100
  const d = await db()
  let cursor: { at: Date; id: string } | null = null
  if (query.cursor) {
    const at = query.cursor.slice(0, query.cursor.indexOf("|"))
    const id = query.cursor.slice(query.cursor.indexOf("|") + 1)
    const t = new Date(at)
    if (!query.cursor.includes("|") || !id || Number.isNaN(t.getTime())) throw badRequest({ cursor: "This cursor isn't valid." })
    cursor = { at: t, id }
  }
  const q = query.q?.trim()
  const like = q ? `%${escapeLike(q)}%` : null
  // Production leaves out the bundled sample catalogue's rows (a database once booted with the demo
  // switch on still holds them), the same rule as every public catalogue read.
  const live = and(ne(catalogProducts.status, "archived"), notSampleBrandSql(catalogProducts.brandId))!
  const filter = and(
    live,
    like ? or(ilike(catalogProducts.title, like), ilike(brands.name, like), ilike(brands.handle, like)) : undefined,
    query.moderation === "hidden" ? eq(catalogProducts.moderationStatus, "hidden") : query.moderation === "ok" ? ne(catalogProducts.moderationStatus, "hidden") : undefined,
    query.category ? eq(catalogProducts.categorySlug, query.category) : undefined,
  )
  const after: SQL | undefined = cursor ? or(sql`${updatedMs} < ${cursor.at.toISOString()}::timestamptz`, and(sql`${updatedMs} = ${cursor.at.toISOString()}::timestamptz`, sql`${catalogProducts.id} > ${cursor.id}`)) : undefined
  const [rows, counts] = await Promise.all([
    d
      .select({ p: catalogProducts, brandName: brands.name, brandHandle: brands.handle, at: sql<string>`to_char(${updatedMs} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(and(filter, after))
      .orderBy(sql`${updatedMs} desc`, catalogProducts.id)
      .limit(limit + 1),
    d
      .select({
        total: sql<number>`count(*)::int`,
        hidden: sql<number>`count(*) filter (where ${catalogProducts.moderationStatus} = 'hidden')::int`,
        matching: sql<number>`count(*) filter (where ${filter ?? sql`true`})::int`,
      })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(live),
  ])
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const kids = await loadChildren(
    d,
    page.map((r) => r.p.id),
  )
  return {
    products: page.map(({ p, brandName, brandHandle }) => {
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
    total: Number(counts[0]?.total ?? 0),
    hidden: Number(counts[0]?.hidden ?? 0),
    matching: Number(counts[0]?.matching ?? 0),
    nextCursor: rows.length > limit && last ? `${last.at}|${last.p.id}` : null,
  }
}
