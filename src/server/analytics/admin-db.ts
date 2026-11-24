/**
 * The Control Center's marketplace performance and Finance › Commission, from the ledger and
 * the order tables. Money stays in its ledger currency (never converted): each currency has its
 * own series and report. Days are UTC days, like Admin › Health and the activity charts.
 *
 * Cost: grouped reads over indexed date columns (ledger_order_money.captured_at,
 * payments.created_at, migration 0031), memoised five minutes by the server wrapper.
 */
import { sql } from "drizzle-orm"
import { addDays, dayRange, dayStart, notSampleBrand, num, realUser, rowsOf, utcDay, type Db, type Guards } from "./common"

/** Days of daily history every chart reads (90 days of buckets and the 90 before them). */
export const SERIES_DAYS = 180

export type AdminPoint = { date: string; gmv: number; orders: number; commission: number }

export type CommissionRow = {
  brandId: string
  name: string
  handle: string
  orders: number
  /** Order totals captured (minor units). */
  gross: number
  /** Commission assessed when the payment was captured. */
  assessed: number
  /** Commission given back by refunds. */
  reversed: number
  net: number
}

export type CurrencyPerformance = {
  currency: string
  series: AdminPoint[]
  /** The first day this currency took a payment, or null. */
  historyStart: string | null
  /** Per brand, in the selected period (every brand with a sale). */
  brands: CommissionRow[]
  payouts: { pendingMinor: number; brands: number }
}

export type AdminAnalytics = {
  days: 7 | 30 | 90
  today: string
  /** Currencies with sales in the last SERIES_DAYS, most GMV first. */
  currencies: string[]
  byCurrency: Record<string, CurrencyPerformance>
  payments: { provider: string; total: number; succeeded: number }[]
  counts: { users: number; products: number; brands: number }
}

export async function adminAnalyticsDb(d: Db, days: 7 | 30 | 90, g: Guards = {}, now = Date.now()): Promise<AdminAnalytics> {
  const today = utcDay(now)
  const seriesFrom = addDays(today, -(SERIES_DAYS - 1))
  const periodFrom = addDays(today, -(days - 1))
  const endTs = dayStart(addDays(today, 1))
  const nb = notSampleBrand(sql`m.brand_id`, g)
  const buyer = g.realUsersOnly ? sql`not exists (select 1 from order_states os join users du on du.id = os.customer_id where os.order_ref_id = m.order_id and du.demo = true)` : sql`true`

  const [daily, first, brands, payouts, payments, users, products, live] = await Promise.all([
    d.execute(sql`
      select m.currency, to_char(m.captured_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as orders,
        coalesce(sum(m.gross_minor), 0)::bigint as gmv, coalesce(sum(m.commission_minor - m.commission_refunded_minor), 0)::bigint as commission
      from ledger_order_money m
      where m.captured_at >= ${dayStart(seriesFrom)} and m.captured_at < ${endTs} and ${nb} and ${buyer}
      group by 1, 2`),
    d.execute(sql`select m.currency, min(m.captured_at) as first from ledger_order_money m where ${nb} and ${buyer} group by 1`),
    d.execute(sql`
      select m.currency, m.brand_id, b.name, b.handle, count(*)::int as orders, coalesce(sum(m.gross_minor), 0)::bigint as gross,
        coalesce(sum(m.commission_minor), 0)::bigint as assessed, coalesce(sum(m.commission_refunded_minor), 0)::bigint as reversed
      from ledger_order_money m join brands b on b.id = m.brand_id
      where m.captured_at >= ${dayStart(periodFrom)} and m.captured_at < ${endTs} and ${nb} and ${buyer}
      group by 1, 2, 3, 4`),
    d.execute(sql`
      select p.currency, coalesce(sum(p.amount_minor), 0)::bigint as pending, count(distinct p.brand_id)::int as brands
      from payouts p where p.status in ('requested', 'awaiting_second_approval', 'approved', 'sending', 'processing') and ${notSampleBrand(sql`p.brand_id`, g)}
      group by 1`),
    d.execute(sql`
      select p.provider, count(*)::int as total, count(*) filter (where p.status = 'succeeded')::int as succeeded
      from payments p
      where p.created_at >= ${dayStart(periodFrom)} and p.created_at < ${endTs} and p.status in ('succeeded', 'failed', 'abandoned') and ${realUser(sql`p.customer_id`, g)}
      group by 1 order by 2 desc`),
    d.execute(sql`select count(*)::int as n from users u where u.kind = 'shopper' and ${g.realUsersOnly ? sql`u.demo = false` : sql`true`}`),
    d.execute(sql`select count(*)::int as n from catalog_products p where p.status = 'published' and p.moderation_status = 'ok' and ${notSampleBrand(sql`p.brand_id`, g)}`),
    d.execute(sql`select count(*)::int as n from brands b where b.launched_at is not null and b.closed_at is null and ${notSampleBrand(sql`b.id`, g)}`),
  ])

  const days180 = dayRange(seriesFrom, today)
  const byCurrency: Record<string, CurrencyPerformance> = {}
  const cur = (c: string) =>
    (byCurrency[c] ??= { currency: c, series: [], historyStart: null, brands: [], payouts: { pendingMinor: 0, brands: 0 } })

  const points = new Map<string, Map<string, AdminPoint>>()
  for (const x of rowsOf<{ currency: string; day: string; orders: number; gmv: unknown; commission: unknown }>(daily)) {
    let m = points.get(x.currency)
    if (!m) points.set(x.currency, (m = new Map()))
    m.set(x.day, { date: x.day, orders: num(x.orders), gmv: num(x.gmv), commission: num(x.commission) })
  }
  for (const [c, m] of points) cur(c).series = days180.map((date) => m.get(date) ?? { date, gmv: 0, orders: 0, commission: 0 })
  for (const x of rowsOf<{ currency: string; first: string | Date | null }>(first)) if (byCurrency[x.currency] && x.first) byCurrency[x.currency].historyStart = utcDay(new Date(x.first).getTime())
  for (const x of rowsOf<{ currency: string; brand_id: string; name: string; handle: string; orders: number; gross: unknown; assessed: unknown; reversed: unknown }>(brands)) {
    const assessed = num(x.assessed)
    const reversed = num(x.reversed)
    cur(x.currency).brands.push({ brandId: x.brand_id, name: x.name, handle: x.handle, orders: num(x.orders), gross: num(x.gross), assessed, reversed, net: assessed - reversed })
  }
  for (const x of rowsOf<{ currency: string; pending: unknown; brands: number }>(payouts)) cur(x.currency).payouts = { pendingMinor: num(x.pending), brands: num(x.brands) }
  for (const c of Object.values(byCurrency)) {
    if (!c.series.length) c.series = days180.map((date) => ({ date, gmv: 0, orders: 0, commission: 0 }))
    c.brands.sort((a, b) => b.net - a.net || b.gross - a.gross || a.name.localeCompare(b.name))
  }
  const gmvOf = (c: CurrencyPerformance) => c.series.reduce((s, p) => s + p.gmv, 0)
  const currencies = Object.values(byCurrency)
    .filter((c) => gmvOf(c) > 0 || c.payouts.pendingMinor > 0)
    .sort((a, b) => gmvOf(b) - gmvOf(a) || a.currency.localeCompare(b.currency))
    .map((c) => c.currency)

  return {
    days,
    today,
    currencies,
    byCurrency,
    payments: rowsOf<{ provider: string; total: number; succeeded: number }>(payments).map((x) => ({ provider: x.provider, total: num(x.total), succeeded: num(x.succeeded) })),
    counts: { users: num(rowsOf<{ n: number }>(users)[0]?.n), products: num(rowsOf<{ n: number }>(products)[0]?.n), brands: num(rowsOf<{ n: number }>(live)[0]?.n) },
  }
}
