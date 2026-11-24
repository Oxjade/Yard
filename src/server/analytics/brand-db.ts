/**
 * Studio › Analytics and Studio › Customers for one brand, from the database only. Every query is
 * scoped by `brand_id = $brand` first, so a brand only ever reads its own orders, buyers and
 * signals. Days are UTC days, like every other chart in Studio and the Control Center.
 *
 * Cost: a handful of grouped reads on (brand_id, placed_at) and (brand_id, day) indexes; the
 * server wrapper memoises each brand and period for two minutes, so a busy page costs the
 * database the same as an idle one.
 */
import { sql } from "drizzle-orm"
import { addDays, capturedSql, dayRange, dayStart, imageSrc, isSampleBrandId, num, realUser, rowsOf, utcDay, type Db, type Guards } from "./common"

export type AnalyticsDays = 7 | 30 | 90

export type DailyPoint = {
  date: string
  orders: number
  /** Item subtotal of the day's paid orders, minor units (the brand's currency). */
  revenue: number
  /** Distinct visitors that day (storefront or product pages, one per shopper or browser). */
  visits: number
  /** Distinct visitors that day who opened at least one product page. */
  productVisitors: number
  productViews: number
  storefrontViews: number
  postOpens: number
  wishlists: number
  follows: number
}

export type Totals = Omit<DailyPoint, "date"> & { aov: number; conversion: number }

export type ProductStat = { productId: string; title: string; image: { src: string; alt: string } | null; units: number; revenue: number; views: number; saves: number; soldOut: number; live: boolean }

export type DropStat = { id: string; name: string; slug: string; image: string | null; status: string; startsAt: string; endsAt: string; totalUnits: number; sold: number; reminders: number; revenue: number }

export type BrandAnalytics = {
  days: AnalyticsDays
  currency: string
  /** The last day of the period (today, UTC) and the first. */
  today: string
  from: string
  /** The first day any paid order was placed with the brand, or null: no comparison reaches back before it. */
  historyStart: string | null
  /** 2 × days points, oldest first: the period before, then the period. */
  series: DailyPoint[]
  now: Totals
  prev: Totals
  /** Paid orders placed in another currency in the period (normally none). */
  otherCurrencies: { currency: string; orders: number; revenue: number }[]
  returning: { now: { customers: number; returning: number }; prev: { customers: number; returning: number } }
  bestSellers: ProductStat[]
  /** Live products with views or saves in the period, most viewed first (up to 24). */
  traffic: ProductStat[]
  locations: { country: string; orders: number }[]
  followers: number
  drops: DropStat[]
}

const zero = (): Omit<DailyPoint, "date"> => ({ orders: 0, revenue: 0, visits: 0, productVisitors: 0, productViews: 0, storefrontViews: 0, postOpens: 0, wishlists: 0, follows: 0 })

export function sumPoints(points: DailyPoint[]): Totals {
  const t = zero()
  for (const p of points) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += p[k]
  return { ...t, aov: t.orders ? Math.round(t.revenue / t.orders) : 0, conversion: t.visits ? t.orders / t.visits : 0 }
}

/** The empty answer: a new brand, or a sample brand in production. */
export function emptyAnalytics(days: AnalyticsDays, currency: string, now = Date.now()): BrandAnalytics {
  const today = utcDay(now)
  const from = addDays(today, -(days - 1))
  const series = dayRange(addDays(from, -days), today).map((date) => ({ date, ...zero() }))
  const blank = sumPoints([])
  return { days, currency, today, from, historyStart: null, series, now: blank, prev: blank, otherCurrencies: [], returning: { now: { customers: 0, returning: 0 }, prev: { customers: 0, returning: 0 } }, bestSellers: [], traffic: [], locations: [], followers: 0, drops: [] }
}

/** Drop state at `now`, in the words Studio's Drops page uses. */
function dropStatus(status: string, startsAt: Date, endsAt: Date, sold: number, totalUnits: number, now: number) {
  if (status === "draft" || status === "cancelled") return status
  if (status === "ended" || endsAt.getTime() <= now) return totalUnits > 0 && sold >= totalUnits ? "sold_out" : "ended"
  if (startsAt.getTime() > now) return "scheduled"
  return totalUnits > 0 && sold >= totalUnits ? "sold_out" : "live"
}

export async function brandAnalyticsDb(d: Db, brandId: string, currency: string, days: AnalyticsDays, g: Guards = {}, now = Date.now()): Promise<BrandAnalytics> {
  if (isSampleBrandId(brandId, g)) return emptyAnalytics(days, currency, now)
  const today = utcDay(now)
  const from = addDays(today, -(days - 1))
  const prevFrom = addDays(from, -days)
  const fromTs = dayStart(from)
  const prevTs = dayStart(prevFrom)
  const endTs = dayStart(addDays(today, 1))
  const cap = capturedSql()
  const buyer = realUser(sql`r.customer_id`, g)
  const actor = g.realUsersOnly ? sql`(e.actor_kind <> 'shopper' or not exists (select 1 from users du where du.id = e.actor_id and du.demo = true))` : sql`true`
  const day = sql`to_char(r.placed_at at time zone 'UTC', 'YYYY-MM-DD')`

  const [sales, other, first, signals, products, traffic, locations, retNow, retPrev, followers, drops] = await Promise.all([
    d.execute(sql`
      select ${day} as day, count(*)::int as orders, coalesce(sum(r.subtotal_minor), 0)::bigint as revenue
      from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.placed_at >= ${prevTs} and r.placed_at < ${endTs} and r.currency = ${currency} and ${cap} and ${buyer}
      group by 1`),
    d.execute(sql`
      select r.currency, count(*)::int as orders, coalesce(sum(r.subtotal_minor), 0)::bigint as revenue
      from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.placed_at >= ${fromTs} and r.placed_at < ${endTs} and r.currency <> ${currency} and ${cap} and ${buyer}
      group by 1 order by 2 desc`),
    d.execute(sql`
      select min(r.placed_at) as first from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and ${cap} and ${buyer}`),
    d.execute(sql`
      select to_char(e.day, 'YYYY-MM-DD') as day,
        count(distinct e.actor_id) filter (where e.kind in ('storefront_view', 'product_view'))::int as visits,
        count(distinct e.actor_id) filter (where e.kind = 'product_view')::int as product_visitors,
        count(*) filter (where e.kind = 'product_view')::int as product_views,
        count(*) filter (where e.kind = 'storefront_view')::int as storefront_views,
        count(*) filter (where e.kind = 'post_open')::int as post_opens,
        count(*) filter (where e.kind = 'wishlist_add')::int as wishlists,
        count(*) filter (where e.kind = 'follow')::int as follows
      from chart_events e
      where e.brand_id = ${brandId} and e.day >= ${prevFrom}::date and e.day <= ${today}::date and e.verdict = 'counted' and ${actor}
      group by 1`),
    // Units and item revenue per product in the period (ordered, before refunds).
    d.execute(sql`
      select l.product_id, max(l.title) as title, sum(l.qty)::int as units, coalesce(sum(l.qty::bigint * l.unit_minor), 0)::bigint as revenue
      from order_lines l join order_refs r on r.id = l.order_ref_id left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.placed_at >= ${fromTs} and r.placed_at < ${endTs} and r.currency = ${currency} and ${cap} and ${buyer}
      group by 1`),
    // Views and saves per product in the period.
    d.execute(sql`
      select e.product_id, count(*) filter (where e.kind = 'product_view')::int as views, count(*) filter (where e.kind = 'wishlist_add')::int as saves
      from chart_events e
      where e.brand_id = ${brandId} and e.product_id is not null and e.day >= ${from}::date and e.day <= ${today}::date and e.verdict = 'counted' and e.kind in ('product_view', 'wishlist_add') and ${actor}
      group by 1`),
    d.execute(sql`
      select r.ship_to_country as country, count(*)::int as orders
      from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.placed_at >= ${fromTs} and r.placed_at < ${endTs} and ${cap} and ${buyer}
      group by 1 order by 2 desc, 1 limit 6`),
    returningIn(d, brandId, fromTs, endTs, g),
    returningIn(d, brandId, prevTs, fromTs, g),
    d.execute(sql`select count(*)::int as n from shopper_follows f where f.brand_id = ${brandId} and ${realUser(sql`f.user_id`, g)}`),
    d.execute(sql`
      select dr.id, dr.name, dr.slug, dr.image, dr.status, dr.starts_at, dr.ends_at, dr.total_units,
        (select count(*)::int from shopper_reminders sr where sr.drop_id = dr.id) as reminders,
        (select coalesce(sum(c.qty), 0)::int from drop_claims c where c.drop_id = dr.id and c.status = 'confirmed') as sold,
        (select coalesce(sum(c.qty::bigint * l.unit_minor), 0)::bigint from drop_claims c
           join order_states s on s.checkout_id = c.checkout_id and s.brand_id = dr.brand_id
           join order_lines l on l.order_ref_id = s.order_ref_id and l.variant_id = c.variant_id
           where c.drop_id = dr.id and c.status = 'confirmed') as revenue
      from drops dr where dr.brand_id = ${brandId} and dr.status <> 'cancelled'
      order by dr.starts_at desc limit 8`),
  ])

  /* Daily series */
  const byDay = new Map<string, Omit<DailyPoint, "date">>()
  const at = (k: string) => {
    let row = byDay.get(k)
    if (!row) byDay.set(k, (row = zero()))
    return row
  }
  for (const x of rowsOf<{ day: string; orders: number; revenue: unknown }>(sales)) {
    const row = at(x.day)
    row.orders = num(x.orders)
    row.revenue = num(x.revenue)
  }
  for (const x of rowsOf<Record<string, unknown> & { day: string }>(signals)) {
    const row = at(x.day)
    row.visits = num(x.visits)
    row.productVisitors = num(x.product_visitors)
    row.productViews = num(x.product_views)
    row.storefrontViews = num(x.storefront_views)
    row.postOpens = num(x.post_opens)
    row.wishlists = num(x.wishlists)
    row.follows = num(x.follows)
  }
  const series = dayRange(prevFrom, today).map((date) => ({ date, ...(byDay.get(date) ?? zero()) }))
  const firstAt = rowsOf<{ first: string | Date | null }>(first)[0]?.first

  /* Products: sales, traffic, names, images and stock in one lookup */
  const sold = new Map(rowsOf<{ product_id: string; title: string; units: number; revenue: unknown }>(products).map((x) => [x.product_id, { title: x.title, units: num(x.units), revenue: num(x.revenue) }]))
  const viewed = new Map(rowsOf<{ product_id: string; views: number; saves: number }>(traffic).map((x) => [x.product_id, { views: num(x.views), saves: num(x.saves) }]))
  const ids = [...new Set([...sold.keys(), ...viewed.keys()])]
  const info = new Map<string, { title: string; live: boolean; soldOut: number; mediaId: string | null; path: string | null; alt: string }>()
  if (ids.length) {
    const r = await d.execute(sql`
      select p.id, p.title, ((p.status = 'published' or (p.status = 'scheduled' and p.publish_at <= now())) and p.moderation_status = 'ok') as live,
        (select count(*)::int from catalog_variants v where v.product_id = p.id and v.status = 'active' and v.on_hand - v.held <= 0) as sold_out,
        i.media_id, i.path, i.alt
      from catalog_products p
      left join lateral (select ci.media_id, ci.path, ci.alt from catalog_product_images ci where ci.product_id = p.id order by ci.position limit 1) i on true
      where p.brand_id = ${brandId} and p.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`)
    for (const x of rowsOf<{ id: string; title: string; live: boolean; sold_out: number; media_id: string | null; path: string | null; alt: string }>(r))
      info.set(x.id, { title: x.title, live: !!x.live, soldOut: num(x.sold_out), mediaId: x.media_id, path: x.path, alt: x.alt })
  }
  const stat = (id: string): ProductStat => {
    const p = info.get(id)
    const s = sold.get(id)
    const v = viewed.get(id)
    const title = p?.title ?? s?.title ?? "Product"
    const src = imageSrc(p?.mediaId, p?.path)
    return { productId: id, title, image: src ? { src, alt: p?.alt || title } : null, units: s?.units ?? 0, revenue: s?.revenue ?? 0, views: v?.views ?? 0, saves: v?.saves ?? 0, soldOut: p?.soldOut ?? 0, live: p?.live ?? false }
  }
  const bestSellers = [...sold.keys()].map(stat).sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.title.localeCompare(b.title)).slice(0, 5)
  const trafficRows = [...viewed.keys()].map(stat).filter((p) => p.live).sort((a, b) => b.views - a.views || b.saves - a.saves).slice(0, 24)

  return {
    days,
    currency,
    today,
    from,
    historyStart: firstAt ? utcDay(new Date(firstAt).getTime()) : null,
    series,
    now: sumPoints(series.slice(days)),
    prev: sumPoints(series.slice(0, days)),
    otherCurrencies: rowsOf<{ currency: string; orders: number; revenue: unknown }>(other).map((x) => ({ currency: x.currency, orders: num(x.orders), revenue: num(x.revenue) })),
    returning: { now: retNow, prev: retPrev },
    bestSellers,
    traffic: trafficRows,
    locations: rowsOf<{ country: string; orders: number }>(locations).map((x) => ({ country: x.country, orders: num(x.orders) })),
    followers: num(rowsOf<{ n: number }>(followers)[0]?.n),
    drops: rowsOf<{ id: string; name: string; slug: string; image: string | null; status: string; starts_at: string | Date; ends_at: string | Date; total_units: number; reminders: number; sold: number; revenue: unknown }>(drops).map((x) => {
      const startsAt = new Date(x.starts_at)
      const endsAt = new Date(x.ends_at)
      const image = x.image ? (x.image.startsWith("/") ? x.image : imageSrc(x.image, null)) : null
      return { id: x.id, name: x.name, slug: x.slug, image, status: dropStatus(x.status, startsAt, endsAt, num(x.sold), num(x.total_units), now), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), totalUnits: num(x.total_units), sold: num(x.sold), reminders: num(x.reminders), revenue: num(x.revenue) }
    }),
  }
}

/**
 * Buyers in [start, end) and how many of them had ordered from the brand before (two or more
 * paid orders placed before `end`).
 */
async function returningIn(d: Db, brandId: string, start: Date, end: Date, g: Guards) {
  const r = await d.execute(sql`
    select count(*)::int as customers, count(*) filter (where x.n >= 2)::int as returning from (
      select r.customer_id,
        (select count(*) from order_refs r2 left join order_states s2 on s2.order_ref_id = r2.id
          where r2.brand_id = ${brandId} and r2.customer_id = r.customer_id and r2.placed_at < ${end} and ${capturedSql("r2", "s2")}) as n
      from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.placed_at >= ${start} and r.placed_at < ${end} and ${capturedSql()} and ${realUser(sql`r.customer_id`, g)}
      group by r.customer_id) x`)
  const x = rowsOf<{ customers: number; returning: number }>(r)[0]
  return { customers: num(x?.customers), returning: num(x?.returning) }
}

/* ── Customers ───────────────────────────────────────────────────────── */

export type CustomerOrder = { id: string; reference: string; placedAt: string; status: string; currency: string; totalMinor: number; refundedMinor: number; itemCount: number; items: string[] }

export type BrandCustomerRow = {
  /** A key for this brand only (not the account id): md5 of the brand and the account. */
  id: string
  name: string
  city: string | null
  country: string
  /** Paid orders (not cancelled, not awaiting payment). */
  orderCount: number
  cancelledCount: number
  /** What they've spent with the brand: paid orders' totals less refunds, in the brand's currency. */
  spentMinor: number
  firstOrderAt: string
  lastOrderAt: string
  /** Their latest orders with the brand (up to 10), newest first, including cancelled ones. */
  orders: CustomerOrder[]
}

export type BrandCustomers = { currency: string; customers: BrandCustomerRow[]; total: number; truncated: boolean }

/**
 * A brand's buyers, built from its orders only: the name on the account (else the name the
 * order ships to), the city and country of their latest order, their paid order count, what
 * they've spent and when. No email, phone or address: the order page shows what shipping needs.
 */
export async function brandCustomersDb(d: Db, brandId: string, currency: string, g: Guards = {}, limit = 500): Promise<BrandCustomers> {
  if (isSampleBrandId(brandId, g)) return { currency, customers: [], total: 0, truncated: false }
  const buyer = realUser(sql`r.customer_id`, g)
  const r = await d.execute(sql`
    with o as (
      select r.id, r.customer_id, r.reference, r.placed_at, r.status, r.currency, r.total_minor, r.ship_to_city, r.ship_to_country, r.items,
        coalesce(s.refunded_minor, 0) as refunded_minor, s.ship_to->>'name' as ship_name,
        (${capturedSql()}) as counted,
        row_number() over (partition by r.customer_id order by r.placed_at desc, r.id desc) as rn
      from order_refs r left join order_states s on s.order_ref_id = r.id
      where r.brand_id = ${brandId} and r.status <> 'pending_payment' and ${buyer}
    ), c as (
      select o.customer_id,
        count(*) filter (where o.counted)::int as order_count,
        count(*) filter (where o.status = 'cancelled')::int as cancelled_count,
        coalesce(sum(o.total_minor - o.refunded_minor) filter (where o.counted and o.currency = ${currency}), 0)::bigint as spent,
        min(o.placed_at) as first_at, max(o.placed_at) as last_at
      from o group by o.customer_id
    )
    select c.*, count(*) over ()::int as total, md5(${brandId} || ':' || c.customer_id) as key, u.name as account_name,
      l.ship_to_city as city, l.ship_to_country as country, l.ship_name,
      (select coalesce(json_agg(json_build_object('id', h.id, 'reference', h.reference, 'placedAt', h.placed_at, 'status', h.status, 'currency', h.currency, 'totalMinor', h.total_minor, 'refundedMinor', h.refunded_minor, 'items', h.items) order by h.placed_at desc, h.id desc), '[]'::json)
         from o h where h.customer_id = c.customer_id and h.rn <= 10) as history
    from c
    join o l on l.customer_id = c.customer_id and l.rn = 1
    left join users u on u.id = c.customer_id
    order by c.last_at desc
    limit ${limit}`)
  const rows = rowsOf<{ customer_id: string; order_count: number; cancelled_count: number; spent: unknown; first_at: string | Date; last_at: string | Date; total: number; key: string; account_name: string | null; city: string | null; country: string; ship_name: string | null; history: unknown }>(r)
  const total = num(rows[0]?.total)
  return {
    currency,
    total,
    truncated: total > rows.length,
    customers: rows.map((x) => {
      const history = (typeof x.history === "string" ? JSON.parse(x.history) : x.history) as { id: string; reference: string; placedAt: string; status: string; currency: string; totalMinor: number; refundedMinor: number; items: { name: string; qty: number }[] | null }[]
      return {
        id: x.key.slice(0, 16),
        name: x.account_name?.trim() || x.ship_name?.trim() || "Customer",
        city: x.city,
        country: x.country,
        orderCount: num(x.order_count),
        cancelledCount: num(x.cancelled_count),
        spentMinor: num(x.spent),
        firstOrderAt: new Date(x.first_at).toISOString(),
        lastOrderAt: new Date(x.last_at).toISOString(),
        orders: history.map((h) => ({
          id: h.id,
          reference: h.reference,
          placedAt: new Date(h.placedAt).toISOString(),
          status: h.status,
          currency: h.currency,
          totalMinor: num(h.totalMinor),
          refundedMinor: num(h.refundedMinor),
          itemCount: (h.items ?? []).reduce((s, i) => s + (i.qty || 0), 0),
          items: (h.items ?? []).map((i) => i.name).slice(0, 4),
        })),
      }
    }),
  }
}
