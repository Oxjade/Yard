import "server-only"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "../db"
import { brands, catalogProducts, orderStates, users } from "../db/schema"
import { brandListedSql } from "../catalog/sellable"
import { notSampleBrandSql } from "../catalog/sample-guard"
import { getEnv } from "../env"

export type OverviewStats = {
  accounts: { total: number; today: number; last7: number; last30: number }
  brands: { listed: number; pendingReview: number; total: number }
  products: { published: number }
  orders: { total: number; last30: number; paid30: number }
  /** Paid sales in the last 30 days, per currency, in minor units. */
  sales30: { currency: string; minor: number }[]
  /** One point per day for the last 30 days (oldest first), dates as YYYY-MM-DD (UTC). */
  daily: { day: string; signups: number; orders: number }[]
}

const PAID = ["paid", "partially_refunded", "refunded"]

/** The Control Center's real figures, straight from the database (demo accounts and sample brands left out in production). */
export async function overviewStats(): Promise<OverviewStats> {
  const d = await db()
  const now = Date.now()
  const day = 86_400_000
  const startToday = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z")
  const since7 = new Date(now - 7 * day)
  const since30 = new Date(startToday.getTime() - 29 * day)
  const realUsers = getEnv().seedDemo ? sql`true` : eq(users.demo, false)

  const [acc, br, prod, ord, sales, signupDays, orderDays] = await Promise.all([
    d
      .select({
        total: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (where ${users.createdAt} >= ${startToday})::int`,
        last7: sql<number>`count(*) filter (where ${users.createdAt} >= ${since7})::int`,
        last30: sql<number>`count(*) filter (where ${users.createdAt} >= ${since30})::int`,
      })
      .from(users)
      .where(and(realUsers, eq(users.kind, "shopper"))),
    d
      .select({
        total: sql<number>`count(*)::int`,
        listed: sql<number>`count(*) filter (where ${brandListedSql()})::int`,
        pending: sql<number>`count(*) filter (where ${brands.reviewStatus} = 'pending_review')::int`,
      })
      .from(brands)
      .where(notSampleBrandSql(brands.id)),
    d.select({ n: sql<number>`count(*)::int` }).from(catalogProducts).where(and(eq(catalogProducts.status, "published"), notSampleBrandSql(catalogProducts.brandId))),
    d
      .select({
        total: sql<number>`count(*)::int`,
        last30: sql<number>`count(*) filter (where ${orderStates.createdAt} >= ${since30})::int`,
        paid30: sql<number>`count(*) filter (where ${orderStates.createdAt} >= ${since30} and ${orderStates.paymentStatus} in ('paid','partially_refunded','refunded'))::int`,
      })
      .from(orderStates)
      .where(notSampleBrandSql(orderStates.brandId)),
    d
      .select({ currency: orderStates.currency, minor: sql<number>`coalesce(sum(${orderStates.totalMinor}),0)::bigint` })
      .from(orderStates)
      .where(and(gte(orderStates.createdAt, since30), inArray(orderStates.paymentStatus, PAID), notSampleBrandSql(orderStates.brandId)))
      .groupBy(orderStates.currency),
    d
      .select({ day: sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(realUsers, eq(users.kind, "shopper"), gte(users.createdAt, since30)))
      .groupBy(sql`1`),
    d
      .select({ day: sql<string>`to_char(${orderStates.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(orderStates)
      .where(and(gte(orderStates.createdAt, since30), notSampleBrandSql(orderStates.brandId)))
      .groupBy(sql`1`),
  ])

  const s = new Map(signupDays.map((r) => [r.day, Number(r.n)]))
  const o = new Map(orderDays.map((r) => [r.day, Number(r.n)]))
  const daily = Array.from({ length: 30 }, (_, i) => {
    const key = new Date(since30.getTime() + i * day).toISOString().slice(0, 10)
    return { day: key, signups: s.get(key) ?? 0, orders: o.get(key) ?? 0 }
  })
  const a = acc[0]
  return {
    accounts: { total: Number(a.total), today: Number(a.today), last7: Number(a.last7), last30: Number(a.last30) },
    brands: { listed: Number(br[0].listed), pendingReview: Number(br[0].pending), total: Number(br[0].total) },
    products: { published: Number(prod[0].n) },
    orders: { total: Number(ord[0].total), last30: Number(ord[0].last30), paid30: Number(ord[0].paid30) },
    sales30: sales.map((r) => ({ currency: r.currency, minor: Number(r.minor) })),
    daily,
  }
}
