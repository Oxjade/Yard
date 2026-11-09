"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { OrderStatusBadge } from "@/components/market/account/order-status"
import { ApiError, api } from "@/lib/api/client"
import type { OrdersPageDto, OrderSummaryDto } from "@/lib/api/contracts/orders"
import type { CurrencyCode } from "@/config/markets"
import type { MerchantOrderStatus } from "@/lib/data/types"
import { formatDay, formatOrderMoney } from "./format"
import { YouNav } from "./you-nav"

type Filter = "all" | "open" | "closed"
type Group = { id: string; reference: string; placedAt: string; currency: string; totalMinor: number; orders: OrderSummaryDto[] }
const openStatuses = new Set<MerchantOrderStatus>(["pending_payment", "paid", "processing", "shipped", "refund_requested"])

function merchantStatus(value: string): MerchantOrderStatus {
  const statuses: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
  return statuses.includes(value as MerchantOrderStatus) ? value as MerchantOrderStatus : "pending_payment"
}

function groupsOf(items: OrderSummaryDto[]): Group[] {
  const groups = new Map<string, Group>()
  for (const order of items) {
    const id = order.checkoutId ?? order.groupReference
    const group = groups.get(id)
    if (group) {
      group.orders.push(order)
      group.totalMinor += order.totalMinor
    } else {
      groups.set(id, { id, reference: order.groupReference, placedAt: order.placedAt, currency: order.currency, totalMinor: order.totalMinor, orders: [order] })
    }
  }
  return [...groups.values()].sort((a, b) => b.placedAt.localeCompare(a.placedAt))
}

function ServerOrderGroup({ group }: { group: Group }) {
  const payment = group.orders.some((order) => order.states.payment === "failed")
    ? "Payment didn’t go through"
    : group.orders.every((order) => ["paid", "partially_refunded", "refunded"].includes(order.states.payment))
      ? "Payment confirmed"
      : "Awaiting payment confirmation"

  return (
    <article className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line-soft px-4 py-4 md:px-6">
        <div>
          <h2 className="text-base font-medium text-ink">Checkout {group.reference}</h2>
          <p className="mt-1 text-sm text-ink-2">Placed {formatDay(group.placedAt, { year: true })}, {group.orders.length === 1 ? "1 brand" : `${group.orders.length} brands shipping separately`}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-ink-3">{payment}</p>
          <p className="text-lg text-ink tabular">{formatOrderMoney(group.totalMinor, group.currency as CurrencyCode)}</p>
        </div>
      </header>
      <ul className="divide-y divide-line-soft">
        {group.orders.map((order) => {
          const first = order.previewItems[0]
          const title = first ? `${first.name}${order.itemCount > first.qty ? ` and ${order.itemCount - first.qty} more` : ""}` : `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`
          return (
            <li key={order.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-6">
              <div className="min-w-0">
                <Link href={order.brand.handle ? `/brands/${order.brand.handle}` : "/brands"} className="text-xs text-ink-2 transition-colors hover:text-violet">{order.brand.name}</Link>
                <Link href={`/you/orders/${encodeURIComponent(order.id)}`} className="mt-1 block truncate text-sm text-ink">{title}</Link>
                <p className="mt-1 text-xs text-ink-3 tabular">Order {order.reference}, {order.itemCount} {order.itemCount === 1 ? "item" : "items"}, {formatOrderMoney(order.totalMinor, order.currency as CurrencyCode)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2"><OrderStatusBadge status={merchantStatus(order.states.merchant)} /></div>
              </div>
              <Button asChild size="sm" variant="secondary" className="justify-self-start sm:justify-self-end"><Link href={`/you/orders/${encodeURIComponent(order.id)}`}>View order</Link></Button>
            </li>
          )
        })}
      </ul>
    </article>
  )
}

export function ServerOrdersList({ shopperId }: { shopperId: string }) {
  const [items, setItems] = useState<OrderSummaryDto[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api<OrdersPageDto>("/api/orders", { query: { limit: 50 } }).then((page) => {
      if (active) {
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setError(null)
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Couldn't load your orders.")
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [shopperId])

  async function loadOlder() {
    if (!nextCursor || loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await api<OrdersPageDto>("/api/orders", { query: { limit: 50, before: nextCursor } })
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn't load older orders.")
    } finally {
      setLoading(false)
    }
  }

  const groups = groupsOf(items)
  const isOpen = (group: Group) => group.orders.some((order) => openStatuses.has(merchantStatus(order.states.merchant)))
  const visible = groups.filter((group) => filter === "all" || (filter === "open" ? isOpen(group) : !isOpen(group)))

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">Orders</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">Orders from every brand you’ve checked out with, updated from your account.</p>
      </header>
      <YouNav className="mt-8" />
      {error ? <div role="alert" className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line-soft bg-card px-4 py-4 text-sm text-ink-2"><span>{error}</span><Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button></div> : null}
      {loading && items.length === 0 ? <div role="status" className="mt-8 grid gap-4" aria-busy="true"><div className="h-28 animate-pulse rounded-lg border border-line-soft bg-card" /><div className="h-36 animate-pulse rounded-lg border border-line-soft bg-card" /></div> : null}
      {!loading && !error && groups.length === 0 ? (
        <div className="mt-16 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <p className="text-base text-ink">No orders yet</p>
          <p className="mt-1 text-sm text-ink-2">When you check out, every brand order and its tracking appears here.</p>
          <Button asChild variant="primary" className="mt-5"><Link href="/shop">Start shopping</Link></Button>
        </div>
      ) : groups.length ? (
        <>
          <ChipRadioGroup label="Show orders" className="rail -mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {([
              { value: "all", label: "All", count: groups.length },
              { value: "open", label: "In progress", count: groups.filter(isOpen).length },
              { value: "closed", label: "Completed", count: groups.filter((group) => !isOpen(group)).length },
            ] as const).map((option) => <Chip key={option.value} radio selected={filter === option.value} onClick={() => setFilter(option.value)} count={option.count}>{option.label}</Chip>)}
          </ChipRadioGroup>
          <div className="mt-6 grid gap-6">{visible.map((group) => <ServerOrderGroup key={group.id} group={group} />)}</div>
          {visible.length === 0 ? <p className="mt-8 text-center text-sm text-ink-2">No orders match this filter.</p> : null}
          {nextCursor ? <Button variant="secondary" className="mt-8" loading={loading} disabled={loading} onClick={() => void loadOlder()}>Load older orders</Button> : null}
        </>
      ) : null}
    </>
  )
}