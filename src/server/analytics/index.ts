import "server-only"
import { z } from "zod"
import { SAMPLE_BRAND_IDS } from "@/lib/data/sample-ids"
import { memo } from "../cache"
import { db } from "../db"
import { getEnv } from "../env"
import { adminAnalyticsDb } from "./admin-db"
import { brandAnalyticsDb, brandCustomersDb, type AnalyticsDays } from "./brand-db"
import type { Db, Guards } from "./common"

/**
 * The analytics reads behind Studio › Analytics, Studio › Customers, the Control Center's
 * marketplace performance and Finance › Commission. Cost scales with time, not traffic: each
 * answer is memoised in this process (per brand and period for Studio, per period for the
 * Control Center), so a page refreshed by every member of a team costs one set of queries per
 * window. Production (the demo switch off) leaves sample brands and demo accounts out.
 */

export const analyticsDaysQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) })

const STUDIO_TTL = 2 * 60_000
const ADMIN_TTL = 5 * 60_000

const guards = (): Guards => (getEnv().seedDemo ? {} : { sampleBrandIds: SAMPLE_BRAND_IDS, realUsersOnly: true })
const handle = async () => (await db()) as unknown as Db

export function studioAnalytics(brandId: string, currency: string, days: AnalyticsDays) {
  return memo(`analytics:brand:${brandId}:${currency}:${days}`, STUDIO_TTL, async () => brandAnalyticsDb(await handle(), brandId, currency, days, guards()))
}

export function studioCustomers(brandId: string, currency: string) {
  return memo(`analytics:customers:${brandId}:${currency}`, STUDIO_TTL, async () => brandCustomersDb(await handle(), brandId, currency, guards()))
}

export function adminAnalytics(days: AnalyticsDays) {
  return memo(`analytics:admin:${days}`, ADMIN_TTL, async () => adminAnalyticsDb(await handle(), days, guards()))
}

export type { BrandAnalytics, BrandCustomers, BrandCustomerRow, CustomerOrder, DailyPoint, DropStat, ProductStat, Totals } from "./brand-db"
export type { AdminAnalytics, AdminPoint, CommissionRow, CurrencyPerformance } from "./admin-db"
