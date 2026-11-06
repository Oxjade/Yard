"use client"

import { useMemo } from "react"
import { periodWindows } from "@/components/dashboard/insight/derive"
import { brandDailySeries, sumSeries, type DailyPoint } from "@/lib/data/analytics"
import type { MerchantOrder, Product } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"

/**
 * The one source for the brand's dashboards (Overview and Analytics), so both pages give the
 * same figures for the same days. Orders and revenue come from the orders in Studio (the sample
 * orders, the demo shopper's orders with this brand and any placed at checkout in this browser);
 * visits, product views, follows and saves are generated sample traffic, labelled as such.
 */

/** The orders the dashboards count: paid orders, before refunds. Cancelled and unpaid ones never count. */
export const countedOrder = (o: MerchantOrder) => o.status !== "cancelled" && o.status !== "pending_payment"

export type ProductSales = { id: string; name: string; image: MerchantOrder["lines"][number]["image"]; units: number; revenue: number }

export function useBrandSeries(brandId: string) {
  const orders = useStudio((s) => s.orders)
  const sample = useMemo(() => brandDailySeries(brandId, 180), [brandId])
  return useMemo(() => {
    const counted = orders.filter(countedOrder)
    const byDay = new Map<string, { orders: number; revenue: number }>()
    for (const o of counted) {
      const day = o.placedAt.slice(0, 10)
      const row = byDay.get(day) ?? { orders: 0, revenue: 0 }
      row.orders += 1
      row.revenue += o.subtotal
      byDay.set(day, row)
    }
    const series: DailyPoint[] = sample.map((p) => ({ ...p, orders: byDay.get(p.date)?.orders ?? 0, revenue: byDay.get(p.date)?.revenue ?? 0 }))
    const lastDay = series[series.length - 1].date
    // Order history starts with the first counted order, so no comparison reaches back before it.
    const historyStart = counted.reduce((m, o) => (o.placedAt.slice(0, 10) < m ? o.placedAt.slice(0, 10) : m), lastDay)
    return { series, counted, historyStart }
  }, [sample, orders])
}

/**
 * Everything a dashboard shows for one period: the totals and the period before, whether the two
 * compare (the earlier one lies inside the order history), and the counted orders placed in it.
 */
export function periodSummary({ series, counted, historyStart }: ReturnType<typeof useBrandSeries>, days: number) {
  const now = sumSeries(series, series.length - days)
  const prev = sumSeries(series, series.length - days * 2, series.length - days)
  const win = periodWindows(series, days, historyStart)
  const firstDay = series[series.length - days].date
  const lastDay = series[series.length - 1].date
  const orders = counted.filter((o) => {
    const d = o.placedAt.slice(0, 10)
    return d >= firstDay && d <= lastDay
  })
  return { now, prev, comparable: win.comparable, firstDay, lastDay, orders }
}

/** Units and item revenue per product across these orders. */
export function salesByProduct(orders: MerchantOrder[]) {
  const m = new Map<string, ProductSales>()
  for (const o of orders) {
    for (const l of o.lines) {
      const row = m.get(l.productId) ?? { id: l.productId, name: l.name, image: l.image, units: 0, revenue: 0 }
      row.units += l.quantity
      row.revenue += l.unitPrice * l.quantity
      m.set(l.productId, row)
    }
  }
  return m
}

/** The best sellers: most units, then most revenue. */
export function bestSellers(sales: Map<string, ProductSales>, limit = 5) {
  return [...sales.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, limit)
}

/**
 * Views and saves per live product: the period's sample totals shared out by how often each
 * product is opened and saved, so they add up to the period's product views and wishlist adds.
 */
export function productTraffic(products: Product[], productViews: number, wishlists: number) {
  const live = products.filter((p) => p.status === "published")
  const share = (total: number, weight: (p: Product) => number) => {
    const sum = live.reduce((s, p) => s + weight(p), 0)
    return new Map(live.map((p) => [p.id, sum ? Math.round((total * weight(p)) / sum) : 0]))
  }
  return { live, viewsBy: share(productViews, (p) => p.stats?.views7d ?? 0), savesBy: share(wishlists, (p) => p.stats?.wishlists ?? 0) }
}

/**
 * High views, low conversion: well-viewed live products (at or above the median) that aren't
 * best sellers, fewest orders per view first.
 */
export function lowConversion(traffic: ReturnType<typeof productTraffic>, sales: Map<string, ProductSales>, best: ProductSales[], limit = 3) {
  const { live, viewsBy, savesBy } = traffic
  const bestIds = new Set(best.map((b) => b.id))
  const viewCounts = live.map((p) => viewsBy.get(p.id) ?? 0).sort((a, b) => a - b)
  const medianViews = viewCounts[Math.floor(viewCounts.length / 2)] ?? 0
  return live
    .filter((p) => !bestIds.has(p.id) && (viewsBy.get(p.id) ?? 0) > 0 && (viewsBy.get(p.id) ?? 0) >= medianViews)
    .map((p) => {
      const views = viewsBy.get(p.id) ?? 0
      const units = sales.get(p.id)?.units ?? 0
      return { product: p, views, units, saves: savesBy.get(p.id) ?? 0, rate: units / views, soldOut: p.variants.filter((v) => v.stock <= 0).length }
    })
    .sort((a, b) => a.rate - b.rate || b.views - a.views)
    .slice(0, limit)
}
