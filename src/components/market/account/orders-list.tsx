"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Image from "next/image"
import Link from "next/link"
import { FunnelSimpleIcon as Funnel, PackageIcon as Package } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { brandById } from "@/lib/data/brands"
import { formatMoney } from "@/lib/money"
import { useOrders } from "@/lib/stores/orders"
import type { CheckoutGroup, MerchantOrder } from "@/lib/data/types"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { formatDay } from "./format"
import { checkoutPayment, OrderStatusBadge, TrackingLink } from "./order-status"
import { YouNav } from "./you-nav"

type Filter = "all" | "open" | "closed"
const openStatuses = new Set<MerchantOrder["status"]>(["pending_payment", "paid", "processing", "shipped", "refund_requested"])

function itemsSummary(o: MerchantOrder) {
  const [first, ...rest] = o.lines
  if (!first) return "No items"
  return rest.length ? `${first.name} and ${rest.length} more` : first.name
}

/** One brand's part of a checkout: what's in it, where it is, and how to track it. */
export function OrderRow({ order, showCurrency = false }: { order: MerchantOrder; showCurrency?: boolean }) {
  const brand = brandById.get(order.brandId)
  const count = order.lines.reduce((n, l) => n + l.quantity, 0)
  return (
    <li className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-6">
      <div className="flex min-w-0 gap-4">
        <Link href={`/you/orders/${order.id}`} className="relative h-24 w-[4.75rem] shrink-0 overflow-hidden rounded-md bg-surface" aria-label={`Order ${order.reference}`}>
          {order.lines[0] ? <Image src={order.lines[0].image.src} alt={order.lines[0].image.alt} fill sizes="80px" className="object-cover" /> : null}
          {order.lines.length > 1 ? (
            <span className="glass absolute right-1 bottom-1 inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] text-ink tabular">+{order.lines.length - 1}</span>
          ) : null}
        </Link>
        <div className="min-w-0">
          {brand ? (
            <Link href={`/brands/${brand.handle}`} className="flex items-center gap-2 text-xs text-ink-2 transition-colors hover:text-violet">
              <BrandMark brand={brand} size="xs" />
              <span className="truncate">{brand.name}</span>
            </Link>
          ) : null}
          <Link href={`/you/orders/${order.id}`} className="mt-1.5 block truncate text-sm text-ink">{itemsSummary(order)}</Link>
          <p className="mt-0.5 text-xs text-ink-3 tabular">
            Order {order.reference}, {count} {count === 1 ? "item" : "items"}, {formatMoney(order.total, order.currency)}
            {showCurrency ? ` ${order.currency}` : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <OrderStatusBadge status={order.status} />
            {order.tracking ? <TrackingLink tracking={order.tracking} /> : null}
            {!order.tracking && openStatuses.has(order.status) ? <span className="text-xs text-ink-3">Tracking appears when it ships</span> : null}
          </div>
        </div>
      </div>
      <Button asChild size="sm" variant="secondary" className="ml-[5.75rem] justify-self-start sm:ml-0 sm:justify-self-end">
        <Link href={`/you/orders/${order.id}`}>View order</Link>
      </Button>
    </li>
  )
}

export function CheckoutGroupCard({ group, orders, highlighted = false }: { group: CheckoutGroup; orders: MerchantOrder[]; highlighted?: boolean }) {
  const payment = checkoutPayment(orders)
  return (
    <article
      className={cn("overflow-hidden rounded-lg border bg-card transition-colors duration-200", highlighted ? "border-violet/60" : "border-line-soft")}
      aria-labelledby={`g-${group.id}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line-soft px-4 py-4 md:px-6">
        <div>
          {/* Order pages link here as /you/orders#g-<id>: the heading takes focus so the checkout is announced. */}
          <h2 id={`g-${group.id}`} tabIndex={-1} className="scroll-mt-28 text-base font-medium text-ink tabular outline-none">
            Checkout {group.reference}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Placed {formatDay(group.placedAt, { year: true })}, {orders.length === 1 ? "1 brand" : `${orders.length} brands shipping separately`}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-ink-3">{payment.label}</p>
          <p className="text-lg text-ink tabular">{formatMoney(group.total, group.currency)}</p>
          {payment.note ? <p className={cn("mt-0.5 text-xs", payment.tone === "violet" ? "text-violet" : "text-ink-3")}>{payment.note}</p> : null}
        </div>
      </header>
      <ul className="divide-y divide-line-soft">
        {orders.map((o) => (
          <OrderRow key={o.id} order={o} showCurrency={o.currency !== group.currency} />
        ))}
      </ul>
    </article>
  )
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    window.removeEventListener("hashchange", onChange)
    window.removeEventListener("popstate", onChange)
  }
}

/** Order history: one card per checkout, one row per brand order inside it. */
export function OrdersList() {
  const groups = useOrders((s) => s.groups)
  const orders = useOrders((s) => s.orders)
  const [filter, setFilter] = useState<Filter>("all")
  // Arriving from an order page's "part of checkout" link: bring that checkout into view,
  // mark it, and move focus to its heading.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "")
  const target = hash.startsWith("#g-") ? hash.slice(3) : null
  useEffect(() => {
    const el = target ? document.getElementById(`g-${target}`) : null
    if (!el) return
    el.scrollIntoView({ block: "start" })
    el.focus({ preventScroll: true })
  }, [target])

  const rows = useMemo(() => {
    const byId = new Map(orders.map((o) => [o.id, o]))
    return [...groups]
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
      .map((g) => ({ group: g, orders: g.orderIds.map((id) => byId.get(id)).filter((o): o is MerchantOrder => !!o) }))
  }, [groups, orders])

  const isOpen = (r: (typeof rows)[number]) => r.orders.some((o) => openStatuses.has(o.status))
  const visible = rows.filter((r) => (filter === "all" ? true : filter === "open" ? isOpen(r) : !isOpen(r)))
  const onTheWay = orders.filter((o) => o.status === "shipped").length

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">Orders</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          One checkout can include several brands. Each brand ships its own order, with its own tracking and returns.
          {onTheWay ? ` ${onTheWay} ${onTheWay === 1 ? "parcel is" : "parcels are"} on the way.` : ""}
        </p>
      </header>
      <YouNav className="mt-8" />

      {rows.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <Package className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">No orders yet</p>
            <p className="mt-1 text-sm text-ink-2">When you check out, every brand&apos;s order and its tracking shows up here.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/shop">Start shopping</Link>
          </Button>
        </div>
      ) : (
        <>
          <ChipRadioGroup label="Show orders" className="rail -mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {(
              [
                { value: "all", label: "All", count: rows.length },
                { value: "open", label: "In progress", count: rows.filter(isOpen).length },
                { value: "closed", label: "Completed", count: rows.filter((r) => !isOpen(r)).length },
              ] as const
            ).map((o) => (
              <Chip key={o.value} radio selected={filter === o.value} onClick={() => setFilter(o.value)} count={o.count} layoutId="orders-filter">
                {o.label}
              </Chip>
            ))}
          </ChipRadioGroup>
          <div className="mt-6 grid gap-6">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((r) => (
                <motion.div key={r.group.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: duration.press, ease: ease.in } }} transition={spring.layout}>
                  <CheckoutGroupCard group={r.group} orders={r.orders} highlighted={r.group.id === target} />
                </motion.div>
              ))}
            </AnimatePresence>
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center">
                <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                  <Funnel className="size-6 text-ink-2" />
                </span>
                <div>
                  <p className="text-base text-ink">{filter === "open" ? "Nothing in progress" : "No completed orders yet"}</p>
                  <p className="mt-1 text-sm text-ink-2">{filter === "open" ? "Every order you've placed has arrived or been closed." : "Orders move here once they're delivered, refunded or cancelled."}</p>
                </div>
                <Button variant="secondary" onClick={() => setFilter("all")}>Show all orders</Button>
              </div>
            ) : null}
          </div>
          <p className="mt-8 text-xs text-ink-3">
            Checkout totals are in the currency you checked out in. Each brand order shows its amount in that brand&apos;s own currency. Returns are handled by each brand, within its own return window.
          </p>
        </>
      )}
    </>
  )
}
