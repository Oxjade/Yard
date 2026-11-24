import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { AdminBrandRowDto, AdminBrandsDto, AdminBrandsQuery } from "../../lib/api/contracts/admin-brands"
import { brands } from "../db/schema/brands"
import { brandOnboardings, catalogProducts, storefrontVersions } from "../db/schema/catalog"
import { storefrontLive } from "../../lib/admin-storefront"
import { brandLogoSrc, publicLogoIdSql } from "../media/brand-logo"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

/**
 * A founding brand its owner has claimed that isn't live yet (Admin › Brands › Make live): never
 * launched, or launched without a storefront version. Not closed, restricted or suspended, and not
 * one Yard unpublished on purpose. Brands with "Go live when they claim" on are live already.
 */
export function claimedNotLiveSql() {
  return sql`(${brands.founding} and ${brands.claimStatus} = 'claimed' and ${brands.closedAt} is null and ${brands.reviewStatus} not in ('restricted', 'suspended') and ${brands.unpublishedAt} is null and (${brands.launchedAt} is null or not exists (select 1 from ${storefrontVersions} where ${storefrontVersions.brandId} = ${brands.id})))`
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

/**
 * Admin › Brands › All brands: one page of the brands table, by name. No server-only, so the
 * tests run this exact query on PGlite with the migrations applied. Each brand carries its latest
 * application (by last update; null when it never had one) and its product count. The route adds
 * the permission and the rate limit.
 */
export async function listAdminBrandsDb(d: Db, query: Partial<AdminBrandsQuery> = {}): Promise<AdminBrandsDto> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200)
  const status = query.status ?? "all"

  // The latest application per brand (a resubmission is the same row; a brand can still have older ones).
  const app = d
    .selectDistinctOn([brandOnboardings.brandId], {
      brandId: brandOnboardings.brandId,
      appId: sql<string>`${brandOnboardings.id}`.as("app_id"),
      appStatus: sql<string>`${brandOnboardings.status}`.as("app_status"),
      appSubmittedAt: sql<Date | null>`${brandOnboardings.submittedAt}`.as("app_submitted_at"),
      appCreatedAt: sql<Date>`${brandOnboardings.createdAt}`.as("app_created_at"),
    })
    .from(brandOnboardings)
    .where(isNotNull(brandOnboardings.brandId))
    .orderBy(brandOnboardings.brandId, desc(brandOnboardings.updatedAt), desc(brandOnboardings.createdAt))
    .as("app")

  const where: SQL[] = []
  const q = query.q?.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(or(ilike(brands.name, like), ilike(brands.handle, like), ilike(brands.city, like), ilike(brands.country, like))!)
  }
  if (status === "closed") where.push(isNotNull(brands.closedAt))
  else if (status === "founding") where.push(eq(brands.founding, true))
  else if (status === "claimed_not_live") where.push(claimedNotLiveSql())
  else if (status === "no_application") where.push(isNull(app.appId))
  else if (status === "draft" || status === "rejected") where.push(sql`${app.appStatus} = ${status}`)
  else if (status !== "all") where.push(and(eq(brands.reviewStatus, status), isNull(brands.closedAt))!)
  const cond = where.length ? and(...where) : undefined

  const products = sql<number>`(select count(*)::int from ${catalogProducts} where ${catalogProducts.brandId} = ${brands.id})`
  const [rows, [{ total }]] = await Promise.all([
    d
      .select({
        id: brands.id,
        handle: brands.handle,
        name: brands.name,
        country: brands.country,
        city: brands.city,
        categories: brands.categories,
        reviewStatus: brands.reviewStatus,
        closedAt: brands.closedAt,
        founding: brands.founding,
        claimStatus: brands.claimStatus,
        joinedAt: brands.joinedAt,
        launchedAt: brands.launchedAt,
        unpublishedAt: brands.unpublishedAt,
        claimedNotLive: sql<boolean>`${claimedNotLiveSql()}`,
        hasVersion: sql<boolean>`exists (select 1 from ${storefrontVersions} where ${storefrontVersions.brandId} = ${brands.id})`,
        products,
        logo: publicLogoIdSql(brands.logoMediaId),
        appId: app.appId,
        appStatus: app.appStatus,
        appSubmittedAt: app.appSubmittedAt,
        appCreatedAt: app.appCreatedAt,
      })
      .from(brands)
      .leftJoin(app, eq(app.brandId, brands.id))
      .where(cond)
      .orderBy(asc(sql`lower(${brands.name})`), asc(brands.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    d.select({ total: sql<number>`count(*)::int` }).from(brands).leftJoin(app, eq(app.brandId, brands.id)).where(cond),
  ])

  const items = rows.map<AdminBrandRowDto>((r) => ({
    id: r.id,
    handle: r.handle,
    name: r.name,
    country: r.country,
    city: r.city,
    logoSrc: brandLogoSrc(r.logo),
    category: r.categories[0] ?? null,
    reviewStatus: r.reviewStatus as AdminBrandRowDto["reviewStatus"],
    closedAt: iso(r.closedAt),
    founding: r.founding,
    claimStatus: r.claimStatus,
    products: Number(r.products),
    since: iso(r.joinedAt) ?? iso(r.appSubmittedAt) ?? iso(r.appCreatedAt) ?? iso(r.launchedAt),
    application: r.appId ? { id: r.appId, status: r.appStatus as NonNullable<AdminBrandRowDto["application"]>["status"], submittedAt: iso(r.appSubmittedAt) } : null,
    storefront: {
      live: storefrontLive({ name: r.name, founding: r.founding, claimStatus: r.claimStatus, reviewStatus: r.reviewStatus, closed: !!r.closedAt, underReview: false, hasVersion: !!r.hasVersion, launched: !!r.launchedAt, unpublished: !!r.unpublishedAt, liveProducts: 0, payoutAccount: false }),
      unpublished: !!r.unpublishedAt,
      claimedNotLive: !!r.claimedNotLive,
    },
  }))
  return { items, total: Number(total), page, pageSize }
}
