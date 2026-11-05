import { convert } from "@/lib/money"
import { brands } from "./brands"
import { merchantOrders } from "./orders"
import { products } from "./products"
import { daysAgo, rand } from "./seed"

/**
 * Development analytics. Order counts and revenue are derived from the sample orders;
 * visits and views are generated, and every screen that shows them labels the data as
 * sample data — never presented as production metrics.
 */

export type DailyPoint = {
  date: string
  visits: number
  productViews: number
  orders: number
  revenue: number
  followers: number
  wishlists: number
}

export function brandDailySeries(brandId: string, days = 90): DailyPoint[] {
  const brand = brands.find((b) => b.id === brandId)!
  const base = Math.max(18, Math.round(brand.followers / 1000))
  const orders = merchantOrders.filter((o) => o.brandId === brandId && o.status !== "cancelled")
  const out: DailyPoint[] = []
  for (let d = days - 1; d >= 0; d--) {
    const date = daysAgo(d).slice(0, 10)
    const dayOrders = orders.filter((o) => o.placedAt.slice(0, 10) === date)
    const weekly = 1 + 0.18 * Math.sin(((days - d) / 7) * Math.PI * 2)
    const growth = 1 + (days - d) / (days * 2.4)
    const noise = 0.75 + rand(`${brandId}-${date}-v`) * 0.5
    const visits = Math.round(base * weekly * growth * noise)
    out.push({
      date,
      visits,
      productViews: Math.round(visits * (2.1 + rand(`${brandId}-${date}-pv`))),
      orders: dayOrders.length,
      revenue: dayOrders.reduce((s, o) => s + o.subtotal, 0),
      followers: Math.round((brand.followers * brand.followerGrowth30d) / 30 * noise * weekly),
      wishlists: Math.round(visits * 0.06 * noise),
    })
  }
  return out
}

export function sumSeries(series: DailyPoint[], from: number, to = series.length) {
  const slice = series.slice(from, to)
  const sum = (k: keyof Omit<DailyPoint, "date">) => slice.reduce((s, p) => s + p[k], 0)
  const visits = sum("visits")
  const orders = sum("orders")
  const revenue = sum("revenue")
  return {
    visits,
    productViews: sum("productViews"),
    orders,
    revenue,
    followers: sum("followers"),
    wishlists: sum("wishlists"),
    conversion: visits ? orders / visits : 0,
    aov: orders ? Math.round(revenue / orders) : 0,
  }
}

/** Platform-wide GMV per day in USD cents, from every brand's sample orders. */
export function platformDailyGmvUsd(days = 30) {
  const out: { date: string; gmv: number; orders: number; commission: number }[] = []
  for (let d = days - 1; d >= 0; d--) {
    const date = daysAgo(d).slice(0, 10)
    const dayOrders = merchantOrders.filter((o) => o.placedAt.slice(0, 10) === date && o.status !== "cancelled")
    const gmv = dayOrders.reduce((s, o) => s + convert(o.total, o.currency, "USD"), 0)
    out.push({ date, gmv, orders: dayOrders.length, commission: dayOrders.reduce((s, o) => s + convert(o.commission, o.currency, "USD"), 0) })
  }
  return out
}

export function topProducts(brandId: string, by: "sales" | "views" | "wishlists" = "sales", limit = 5) {
  const key = by === "sales" ? "sales30d" : by === "views" ? "views7d" : "wishlists"
  return products
    .filter((p) => p.brandId === brandId)
    .sort((a, b) => b.stats[key] - a.stats[key])
    .slice(0, limit)
}

/** High attention, low conversion: lots of views, few sales. */
export function attentionGap(brandId: string) {
  return products
    .filter((p) => p.brandId === brandId)
    .map((p) => ({ product: p, ratio: p.stats.sales30d / Math.max(1, p.stats.views7d * 4) }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 3)
}
