import "server-only"
import { brandById } from "@/lib/data/brands"
import { drops } from "@/lib/data/catalog"
import { merchantOrders } from "@/lib/data/orders"
import { products } from "@/lib/data/products"
import { rand } from "@/lib/data/seed"
import { dropWindow } from "@/lib/drops"
import { convert } from "@/lib/money"

/**
 * The labelled sample baseline (§6.3 "Sample baseline"). A deterministic sampleDaily(brand, date)
 * that works for any date, so Charts stay alive whatever the clock; it mirrors brandDailySeries.
 * Counted live signals add on top. Everything that shows a chart says "Includes sample activity".
 */

export type DayCounts = {
  storefront_view: number
  product_view: number
  follow: number
  unfollow: number
  wishlist_add: number
  wishlist_remove: number
  reminder_set: number
  reminder_unset: number
  order_placed: number
  /** GMV of those orders in USD cents. */
  order_value: number
  message_started: number
  post_open: number
}

export const emptyDay = (): DayCounts => ({
  storefront_view: 0,
  product_view: 0,
  follow: 0,
  unfollow: 0,
  wishlist_add: 0,
  wishlist_remove: 0,
  reminder_set: 0,
  reminder_unset: 0,
  order_placed: 0,
  order_value: 0,
  message_started: 0,
  post_open: 0,
})

const DAY = 86_400_000
const EPOCH = Date.parse("2026-01-01T00:00:00Z")

/** Midnight UTC of a 'YYYY-MM-DD' date, in ms. */
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`)
export const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (date: string, n: number) => toDay(dayStart(date) + n * DAY)
export const todayUtc = (now = Date.now()) => toDay(now)

/**
 * Where the sample drops are placed from: the moment of the request, as /drops does with its demo
 * clock ("releasing in 3 h" stays 3 h away), to the minute so per-anchor caches hold.
 */
export const dropAnchor = (now = Date.now()) => Math.floor(now / 60_000) * 60_000

/** The brand's median product price in USD cents (the value of a sample order). */
const medianPriceUsd = (() => {
  const cache = new Map<string, number>()
  return (brandId: string) => {
    const hit = cache.get(brandId)
    if (hit !== undefined) return hit
    const prices = products
      .filter((p) => p.brandId === brandId && p.status === "published")
      .map((p) => convert(p.price, p.currency, "USD"))
      .sort((a, b) => a - b)
    const m = prices.length ? prices[Math.floor(prices.length / 2)] : 5_000
    cache.set(brandId, m)
    return m
  }
})()

/**
 * Every sample drop's release and end for an anchor. dropWindow resolves local release times
 * through Intl, so it is worth computing once per anchor rather than per brand and day.
 */
export const dropTimes = (() => {
  let cached: { anchor: number; map: Map<string, { release: number; end: number }> } | null = null
  return (anchor: number) => {
    if (cached?.anchor !== anchor) cached = { anchor, map: new Map(drops.map((d) => [d.id, dropWindow(d, anchor)])) }
    return cached.map
  }
})()

/** Whether a brand has a drop releasing within 7 days after `date` (by the day's anchor). */
function dropReleasingSoon(brandId: string, date: string, anchor: number) {
  const from = dayStart(date)
  const times = dropTimes(anchor)
  return drops.some((d) => {
    if (d.brandId !== brandId) return false
    const { release } = times.get(d.id)!
    return release > from && release <= from + 7 * DAY
  })
}

/**
 * One brand's sample activity on one UTC date. `hasPosts` says whether the brand has published
 * social posts (post opens only exist then). Unknown brands get an empty day.
 */
export function sampleDaily(brandId: string, date: string, opts: { hasPosts: boolean; anchor: number }): DayCounts {
  const brand = brandById.get(brandId)
  const out = emptyDay()
  if (!brand) return out
  const d = Math.round((dayStart(date) - EPOCH) / DAY)
  const g = brand.followerGrowth30d
  const b = Math.max(18, brand.followers / 1000)
  const w = 1 + 0.18 * Math.sin((2 * Math.PI * d) / 7)
  const n = 0.75 + 0.5 * rand(`${brandId}${date}v`)
  const n2 = 0.75 + 0.5 * rand(`${brandId}${date}f`)
  const n3 = 0.75 + 0.5 * rand(`${brandId}${date}w`)
  const n4 = 0.75 + 0.5 * rand(`${brandId}${date}o`)
  const sv = Math.round(b * w * n * (1 + g))
  out.storefront_view = sv
  out.product_view = Math.round(sv * (2.1 + rand(`${brandId}${date}pv`)))
  out.follow = Math.round(sv * (0.02 + 0.1 * g) * n2)
  out.wishlist_add = Math.round(sv * 0.06 * n3)
  out.reminder_set = dropReleasingSoon(brandId, date, opts.anchor) ? Math.round(sv * 0.04) : 0
  out.order_placed = Math.round(sv * 0.012 * n4)
  out.order_value = out.order_placed * medianPriceUsd(brandId)
  out.message_started = Math.round(out.order_placed * 0.3)
  out.post_open = opts.hasPosts ? Math.round(sv * 0.05) : 0
  return out
}

/** Every counted thing in a day (the baseline stands in for counted signals in Q_b's denominator). */
export const dayTotal = (c: DayCounts) => c.storefront_view + c.product_view + c.follow + c.unfollow + c.wishlist_add + c.wishlist_remove + c.reminder_set + c.reminder_unset + c.order_placed + c.message_started + c.post_open

/**
 * Repeat customers ÷ customers, from the brand's sample merchant orders (all time). The sample
 * orders are the only order history in this build; null when the brand has none.
 */
export const repeatRate = (() => {
  const cache = new Map<string, number | null>()
  return (brandId: string): number | null => {
    if (cache.has(brandId)) return cache.get(brandId)!
    const perCustomer = new Map<string, number>()
    for (const o of merchantOrders) if (o.brandId === brandId && o.status !== "cancelled") perCustomer.set(o.customerId, (perCustomer.get(o.customerId) ?? 0) + 1)
    const customers = perCustomer.size
    const value = customers ? [...perCustomer.values()].filter((n) => n > 1).length / customers : null
    cache.set(brandId, value)
    return value
  }
})()
