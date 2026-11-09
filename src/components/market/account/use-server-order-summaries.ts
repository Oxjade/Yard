"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api/client"
import type { OrdersPageDto, OrderSummaryDto } from "@/lib/api/contracts/orders"
import type { MerchantOrderStatus } from "@/lib/data/types"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * The latest orders, plus totals over all of them (`counts`: checkouts, orders shipped now) from
 * the server; `failed` when they couldn't be loaded (counts unknown, no orders to show).
 */
type Summaries = { shopperId: string; items: OrderSummaryDto[]; hasMore: boolean; counts: { checkouts: number; shipped: number } | null; failed?: boolean }

// Shared by the Your World nav and the overview, so one page view makes one request; a later
// page view more than a few seconds on fetches again, so a new order shows up.
let cache: { shopperId: string; at: number; promise: Promise<Summaries> } | null = null
const FRESH_MS = 5_000

function load(shopperId: string) {
  if (cache?.shopperId !== shopperId || Date.now() - cache.at > FRESH_MS) {
    const promise = api<OrdersPageDto>("/api/orders", { query: { limit: 50 } }).then((page): Summaries => {
      const hasMore = !!page.nextCursor
      // Totals from the server; a single complete page can be counted here too.
      const counts = page.counts ?? (hasMore ? null : { checkouts: serverCheckoutGroups(page.items).length, shipped: page.items.filter((o) => o.states.merchant === "shipped").length })
      return { shopperId, items: page.items, hasMore, counts }
    })
    // A failed load is retried by the next caller rather than remembered.
    promise.catch(() => { if (cache?.promise === promise) cache = null })
    cache = { shopperId, at: Date.now(), promise }
  }
  return cache.promise
}

/**
 * A signed-in, non-demo shopper's latest orders from the server (GET /api/orders). Returns
 * `undefined` for the demo shopper and signed-out visitors, whose orders live in the local store,
 * and `null` while a real shopper's orders are loading (`failed` when they couldn't be loaded).
 */
export function useServerOrderSummaries(): Summaries | null | undefined {
  const shopper = useServerSession((s) => s.shopper)
  const shopperId = shopper && !shopper.demo ? shopper.id : null
  const [data, setData] = useState<Summaries | null>(null)

  useEffect(() => {
    if (!shopperId) return
    let active = true
    load(shopperId).then(
      (result) => { if (active) setData(result) },
      () => { if (active) setData({ shopperId, items: [], hasMore: false, counts: null, failed: true }) },
    )
    return () => { active = false }
  }, [shopperId])

  if (!shopperId) return undefined
  return data?.shopperId === shopperId ? data : null
}

/** Groups server orders by checkout, newest first (one checkout can hold several brands' orders). */
export function serverCheckoutGroups(items: OrderSummaryDto[]) {
  const groups = new Map<string, { id: string; reference: string; placedAt: string; currency: string; totalMinor: number; orders: OrderSummaryDto[] }>()
  for (const order of items) {
    const id = order.checkoutId ?? order.groupReference
    const group = groups.get(id)
    if (group) {
      group.orders.push(order)
      group.totalMinor += order.totalMinor
    } else groups.set(id, { id, reference: order.groupReference, placedAt: order.placedAt, currency: order.currency, totalMinor: order.totalMinor, orders: [order] })
  }
  return [...groups.values()].sort((a, b) => b.placedAt.localeCompare(a.placedAt))
}

const merchantStatuses: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]

/** The server's merchant state as a status the badges know, falling back to awaiting payment. */
export function merchantStatusOf(value: string): MerchantOrderStatus {
  return merchantStatuses.includes(value as MerchantOrderStatus) ? (value as MerchantOrderStatus) : "pending_payment"
}
