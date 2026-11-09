"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { shippingMethodLabel, type ShippingMethod } from "@/components/market/checkout/shipping"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { ApiError, api } from "@/lib/api/client"
import type { OrderDetailDto } from "@/lib/api/contracts/orders"
import type { MerchantOrderStatus } from "@/lib/data/types"
import { formatDay, formatOrderMoney } from "./format"
import { OrderStatusBadge } from "./order-status"
import { AccountSkeleton } from "./skeletons"
import { YouNav } from "./you-nav"

function statusOf(value: string): MerchantOrderStatus {
  const statuses: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
  return statuses.includes(value as MerchantOrderStatus) ? value as MerchantOrderStatus : "pending_payment"
}

/**
 * Shopper copy for the order events the ORDERS module records (src/server/orders, addEvent).
 * Kinds missing here are internal (disputes, provider refund retries, settlement, fulfilment
 * syncs that another event already covers) and stay off the shopper's timeline.
 */
function eventLabel(event: OrderDetailDto["timeline"][number]): string | null {
  switch (event.kind) {
    case "order.placed": return "Order placed"
    case "payment.captured": return "Payment confirmed"
    case "payment.failed": return "Payment didn’t go through"
    case "fulfilment.processing": return "Order being prepared"
    case "fulfilment.shipped": return "Order shipped"
    case "fulfilment.delivered": return "Order delivered"
    case "fulfilment.returned_to_sender": return "Returned to the brand"
    case "order.cancelled": return event.data.by === "shopper" ? "You cancelled this order" : "Order cancelled"
    case "return.requested": return "Return requested"
    case "return.cancelled": return "Return request withdrawn"
    case "return.approved": return "Return approved"
    case "return.rejected": return "Return declined"
    case "return.received": return "Return received by the brand"
    case "return.expired": return "Return request expired"
    case "refund.requested": return "Refund started"
    case "refund.succeeded": return "Refund issued"
    default: return null
  }
}

const serviceLabel = (service: string) => shippingMethodLabel[service as ShippingMethod] ?? "Standard"

export function ServerOrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderDetailDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState("unwanted")
  const [returnNote, setReturnNote] = useState("")
  const [returnLines, setReturnLines] = useState<Record<string, number>>({})
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(id)}`).then((result) => {
      if (active) {
        setOrder(result.order)
        setError(null)
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Couldn't load this order.")
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  // The page already provides the container (gutters and top padding), so every state renders bare, as OrderDetail does.
  if (loading) return <AccountSkeleton variant="detail" />
  if (error || !order) {
    return (
      <>
        <Link href="/you/orders" className="text-sm text-ink-2 transition-colors hover:text-ink">← All orders</Link>
        <h1 className="mt-6 font-display text-display-lg text-ink">Order unavailable</h1>
        <p role="alert" className="mt-4 text-sm text-ink-2">{error ?? "We couldn’t find this order."}</p>
        <Button asChild variant="primary" className="mt-6"><Link href="/you/orders">Back to orders</Link></Button>
      </>
    )
  }

  const shipTo = order.shipTo ?? {}
  const country = typeof shipTo.country === "string" ? shipTo.country : ""
  const countryName = countries[country as CountryCode]?.name ?? country
  const address = [shipTo.line1, shipTo.line2, [shipTo.city, shipTo.region, shipTo.postalCode || shipTo.postcode].filter((part) => typeof part === "string" && part).join(", "), countryName].filter((part) => typeof part === "string" && part).join("\n")
  const status = statusOf(order.states.merchant)
  const timeline = order.timeline.flatMap((event) => {
    const label = eventLabel(event)
    return label ? [{ ...event, label }] : []
  })
  const activeReturn = order.returns.find((item) => item.status === "requested" || item.status === "approved")

  async function submitReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!order) return
    const lines = order.lines.map((line) => ({ variantId: line.variantId, qty: returnLines[line.variantId] ?? 0 })).filter((line) => line.qty > 0)
    if (!lines.length) {
      setReturnError("Choose at least one item to return.")
      return
    }
    setReturnBusy(true)
    setReturnError(null)
    try {
      const response = await api<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(id)}/returns`, {
        body: { lines, reason: returnReason, note: returnNote.trim(), idempotencyKey: `return_${crypto.randomUUID()}` },
      })
      setOrder(response.order)
      setReturnOpen(false)
      setReturnLines({})
      setReturnNote("")
    } catch (cause) {
      setReturnError(cause instanceof ApiError ? cause.message : "Couldn't send your return request.")
    } finally {
      setReturnBusy(false)
    }
  }

  async function cancelOrder() {
    if (!order?.actions.canCancel || cancelBusy) return
    if (!window.confirm("Cancel this order? This can’t be undone.")) return
    setCancelBusy(true)
    setCancelError(null)
    try {
      const response = await api<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(id)}/cancel`, {
        body: { reason: "Cancelled by the shopper", idempotencyKey: `cancel_${crypto.randomUUID()}` },
      })
      setOrder(response.order)
    } catch (cause) {
      setCancelError(cause instanceof ApiError ? cause.message : "Couldn't cancel this order.")
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <>
      <Link href="/you/orders" className="text-sm text-ink-2 transition-colors hover:text-ink">← All orders</Link>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          {order.brand.handle ? <Link href={`/brands/${order.brand.handle}`} className="text-sm text-ink-2 hover:text-violet">{order.brand.name}</Link> : <p className="text-sm text-ink-2">{order.brand.name}</p>}
          <h1 className="mt-3 font-display text-display-lg text-ink">Order {order.reference}</h1>
          <p className="mt-2 text-sm text-ink-3">Placed {formatDay(order.placedAt, { year: true })}</p>
        </div>
        <OrderStatusBadge status={status} />
      </header>
      <YouNav className="mt-8" />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border border-line-soft bg-card p-4 md:p-6" aria-labelledby="server-order-items">
          <h2 id="server-order-items" className="text-base font-medium text-ink">Items ({order.itemCount})</h2>
          <ul className="mt-4 divide-y divide-line-soft">
            {order.lines.map((line) => (
              <li key={line.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <span className="relative h-28 w-22 shrink-0 overflow-hidden rounded-md bg-surface"><Image src={line.image.src} alt={line.image.alt} fill sizes="88px" className="object-cover" /></span>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm text-ink">{line.title}</p>{line.variantLabel ? <p className="mt-0.5 truncate text-xs text-ink-2">{line.variantLabel}</p> : null}<p className="mt-1 text-xs text-ink-3">Qty {line.qty}</p></div>
                  <p className="shrink-0 text-sm text-ink tabular">{formatOrderMoney(line.unitMinor * line.qty, order.currency as CurrencyCode)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <aside className="grid grid-cols-[minmax(0,1fr)] content-start gap-6">
          <section className="rounded-lg border border-line-soft bg-card p-4 md:p-6" aria-label="Order summary">
            <h2 className="text-base font-medium text-ink">Summary</h2>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex justify-between gap-4 text-ink-2"><dt>Subtotal</dt><dd className="text-ink tabular">{formatOrderMoney(order.subtotalMinor, order.currency as CurrencyCode)}</dd></div>
              <div className="flex justify-between gap-4 text-ink-2"><dt>Shipping</dt><dd className="text-ink tabular">{order.shippingMinor ? formatOrderMoney(order.shippingMinor, order.currency as CurrencyCode) : "Free"}</dd></div>
              <div className="mt-2 flex justify-between gap-4 border-t border-line-soft pt-3 text-base"><dt>Total</dt><dd className="tabular">{formatOrderMoney(order.totalMinor, order.currency as CurrencyCode)}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">{order.states.payment === "failed" ? "Payment didn’t go through; nothing was charged." : order.states.payment === "pending" ? "Payment confirmation is pending." : `Payment status: ${order.states.payment.replace(/_/g, " ")}.`}</p>
            {order.actions.canCancel ? (
              <div className="mt-5 border-t border-line-soft pt-4">
                {cancelError ? <p role="alert" className="mb-3 text-sm text-danger">{cancelError}</p> : null}
                <Button variant="secondary" onClick={cancelOrder} loading={cancelBusy} disabled={cancelBusy} className="w-full">Cancel order</Button>
              </div>
            ) : null}
          </section>
          <section className="rounded-lg border border-line-soft bg-card p-4 md:p-6" aria-label="Delivery address">
            <h2 className="text-base font-medium text-ink">Ship to</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-2">{[shipTo.name, address, shipTo.phone].filter((part) => typeof part === "string" && part).join("\n") || "Address unavailable"}</p>
            <p className="mt-3 text-xs text-ink-3">Shipping service: {serviceLabel(order.service)}</p>
          </section>
          <section className="rounded-lg border border-line-soft bg-card p-4 md:p-6" aria-label="Returns">
            <h2 className="text-base font-medium text-ink">Returns</h2>
            {activeReturn ? (
              <p className="mt-3 text-sm leading-relaxed text-ink-2">Return {activeReturn.status}: {activeReturn.reasonLabel}. {activeReturn.lines.reduce((sum, line) => sum + line.qty, 0)} {activeReturn.lines.reduce((sum, line) => sum + line.qty, 0) === 1 ? "item" : "items"} requested.</p>
            ) : order.actions.canRequestReturn ? (
              <>
                <p className="mt-2 text-sm text-ink-2">This order is within its return window.</p>
                {!returnOpen ? <Button variant="secondary" className="mt-4" onClick={() => setReturnOpen(true)}>Request a return</Button> : (
                  <form onSubmit={submitReturn} className="mt-4 grid gap-4">
                    <fieldset className="grid gap-3">
                      <legend className="text-sm font-medium text-ink">Items to return</legend>
                      {order.lines.map((line) => {
                        const remaining = line.qty - line.returnedQty
                        if (remaining <= 0) return null
                        return <label key={line.id} className="flex items-center justify-between gap-4 text-sm text-ink-2"><span className="min-w-0 truncate">{line.title} ({line.variantLabel}), up to {remaining}</span><input aria-label={`Quantity of ${line.title} to return`} type="number" min="0" max={remaining} value={returnLines[line.variantId] ?? 0} onChange={(change) => setReturnLines((current) => ({ ...current, [line.variantId]: Number(change.target.value) }))} className="h-9 w-20 rounded-md border border-line-soft bg-obsidian px-2 text-center text-ink tabular" /></label>
                      })}
                    </fieldset>
                    <label className="grid gap-1.5 text-sm text-ink-2">Reason<select value={returnReason} onChange={(change) => setReturnReason(change.target.value)} className="h-10 rounded-md border border-line-soft bg-obsidian px-3 text-ink"><option value="too_small">Too small</option><option value="too_large">Too large</option><option value="not_as_described">Not as described</option><option value="damaged">Arrived damaged or faulty</option><option value="wrong_item">Wrong item sent</option><option value="unwanted">Changed my mind</option><option value="other">Something else</option></select></label>
                    <label className="grid gap-1.5 text-sm text-ink-2">Note (optional)<textarea value={returnNote} onChange={(change) => setReturnNote(change.target.value)} maxLength={1000} rows={3} className="rounded-md border border-line-soft bg-obsidian px-3 py-2 text-ink" /></label>
                    {returnError ? <p role="alert" className="text-sm text-danger">{returnError}</p> : null}
                    <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={returnBusy} disabled={returnBusy}>Send request</Button><Button type="button" variant="secondary" disabled={returnBusy} onClick={() => { setReturnOpen(false); setReturnError(null) }}>Cancel</Button></div>
                  </form>
                )}
              </>
            ) : <p className="mt-3 text-sm text-ink-2">Returns are available after delivery while the return window is open.</p>}
          </section>
          <section className="rounded-lg border border-line-soft bg-card p-4 md:p-6" aria-label="Order timeline">
            <h2 className="text-base font-medium text-ink">Timeline</h2>
            <ol className="mt-4 grid gap-4 border-l border-line pl-4">{timeline.map((event) => <li key={event.id}><p className="text-sm text-ink">{event.label}</p><p className="mt-0.5 text-xs text-ink-3">{formatDay(event.at, { year: true })}</p></li>)}</ol>
          </section>
        </aside>
      </div>
    </>
  )
}