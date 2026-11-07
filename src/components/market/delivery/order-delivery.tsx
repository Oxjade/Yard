"use client"

import { useEffect, useState } from "react"
import { ChatCircleDotsIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import type { RealtimeStatus } from "@/lib/api/contracts/realtime"
import { complaintKindLabels, type DeliveryDto } from "@/lib/api/contracts/shipping"
import { isNotFound } from "@/lib/api/errors"
import { deliveryKey, getOrderDelivery } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { useRealtimeEvent, useRealtimeStatus } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { useOrders } from "@/lib/stores/orders"
import { formatDay, formatDayShort, formatRange, formatShortRange } from "@/lib/shipping/format"
import { cn } from "@/lib/utils"
import { orderEstimate } from "./browser-estimate"
import { ComplaintForm } from "./complaint-form"
import { DeliveryFlag, PaymentsNotice, RetryButton } from "./delivery-bits"
import { reconcileOrder } from "./reconcile"

export const shipmentStatusLabels: Record<DeliveryDto["events"][number]["status"], string> = {
  label_created: "Label created",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Delayed",
  returned: "Returned to the brand",
}

const live = (s: RealtimeStatus) => s === "open"

/** "Wed 11 – Mon 16 Nov" for an estimate, or null. */
const rangeOf = (e: { arrivalFrom?: string; arrivalTo?: string } | null | undefined) => (e?.arrivalFrom && e.arrivalTo ? formatRange(e.arrivalFrom, e.arrivalTo) : null)

/**
 * The shopper's delivery panel (§6.5): Yard's estimate for the order, why it changed, the
 * shipment timeline and "Problem with delivery?". It follows `order.estimate` events, so a
 * brand's update shows within a second; while live updates are off it re-reads every 30 s. An
 * order the server never saw (placed in this browser before v2) falls back to the same engine run
 * here, labelled "Estimated in this browser".
 */
export function OrderDelivery({ order, brand }: { order: MerchantOrder; brand: Brand }) {
  const hydrated = useHydrated()
  const signedIn = useServerSession((s) => s.status === "ready" && !!s.shopper)
  const status = useRealtimeStatus()
  const key = hydrated && signedIn ? deliveryKey(order.id) : null
  const q = useApi<DeliveryDto>(key, () => getOrderDelivery(order.id), { refreshInterval: live(status) ? undefined : 30_000 })
  useRealtimeEvent("order.estimate", (p) => {
    if (p.orderId !== order.id) return
    // Show the new estimate at once, then re-read for the shipment timeline and notes.
    q.mutate((cur) => (cur ? { ...cur, estimate: { ...p.estimate, providerId: cur.estimate.providerId, reason: cur.estimate.reason, computedAt: p.computedAt ?? cur.estimate.computedAt }, shippedOn: p.shippedOn !== undefined ? p.shippedOn : cur.shippedOn } : cur))
    void q.revalidate()
  })
  const [complaintOpen, setComplaintOpen] = useState(false)

  const d = q.data
  // Keep this browser's copy of the order in step with Yard's record: the estimate (so the orders
  // list shows the same range) and, when the brand shipped or delivered it from another device, the
  // status, tracking and timeline (so progress, returns and the list badge agree with this panel).
  useEffect(() => {
    if (!d) return
    const o = useOrders.getState().orders.find((x) => x.id === d.orderId)
    const next = o ? reconcileOrder(o, d) : null
    if (!next) return
    useOrders.setState({ orders: useOrders.getState().orders.map((x) => (x.id === d.orderId ? next : x)) })
  }, [d])
  const notOnServer = !d && isNotFound(q.error)
  const failed = !d && !!q.error && !notOnServer
  const loading = !hydrated || (signedIn && !d && !q.error)
  const local = hydrated && (!d || notOnServer) ? orderEstimate(order) : null

  if (loading) {
    return (
      <div role="status" aria-label="Loading the delivery estimate" className="grid gap-2">
        <Bone className="h-3.5 w-24" />
        <Bone className="h-5 w-48" />
      </div>
    )
  }

  // The server's view, or this browser's when the server never saw the order (or isn't reachable).
  const e = d?.estimate ?? local
  const delivered = e?.deliveredOn ?? null
  const late = !!e && (e.basis === "late" || e.basis === "exception")
  const range = rangeOf(e)
  const shippedOn = d?.shippedOn ?? null
  const lastException = d ? [...d.events].reverse().find((x) => x.status === "exception") : undefined
  const complaint = d?.complaint ?? null
  const terminal = order.status === "cancelled" || order.status === "refunded"
  const deliveredEvent = d ? [...d.events].reverse().find((x) => x.status === "delivered") : undefined

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-xs text-ink-3">{delivered ? "Delivered" : order.shippingMethod.toLowerCase().startsWith("pick") ? "Estimated ready for pickup" : "Estimated arrival"}</p>
        {terminal && !delivered ? (
          <p className="mt-1 text-sm text-ink-2">No delivery: this order was {order.status === "cancelled" ? "cancelled" : "refunded"}.</p>
        ) : delivered ? (
          <p className="mt-1 text-ink">{formatDay(delivered)}</p>
        ) : range ? (
          <p className="mt-1 text-ink tabular">{range}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-2">Not available yet</p>
        )}
        {late && !delivered && e?.arrivalFrom && e.arrivalTo ? <DeliveryFlag className="mt-2">Running late — new estimate {formatShortRange(e.arrivalFrom, e.arrivalTo)}</DeliveryFlag> : null}
        {d && !delivered ? (
          <p className="mt-1.5 text-xs text-ink-2">
            {lastException && e?.basis === "exception"
              ? `Updated when ${d.brand.name} reported a delay on ${formatDayShort(lastException.occurredAt.slice(0, 10))}.`
              : shippedOn
                ? `Updated when it shipped on ${formatDayShort(shippedOn)}.`
                : e?.shipBy
                  ? `${d.brand.name} usually ships it by ${formatDay(e.shipBy)}.`
                  : null}
          </p>
        ) : null}
        {local ? <p className="mt-1.5 text-xs text-ink-3">Estimated in this browser{notOnServer ? ": this order was placed before Yard's server kept orders" : ""}.</p> : null}
        {failed ? (
          <p role="status" className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
            Couldn&apos;t load delivery updates
            <span aria-hidden>·</span>
            <RetryButton onRetry={() => void q.revalidate()} retrying={q.isValidating} />
          </p>
        ) : null}
        {/* A delivery date is a recorded fact, not an estimate: the disclaimer is for dates still to come. */}
        {delivered ? (
          deliveredEvent ? <p className="mt-1.5 text-xs text-ink-3">{deliveredEvent.source === "merchant" ? `Marked delivered by ${d!.brand.name}.` : "Recorded as delivered."}</p> : null
        ) : !terminal ? (
          <p className="mt-1.5 text-xs text-ink-3">An estimate, not a guarantee. It skips weekends and public holidays.</p>
        ) : null}
      </div>

      {d && d.events.length ? (
        <ol className="relative grid gap-3 border-l border-line pl-4" aria-label="Shipment updates">
          {[...d.events].reverse().map((x, i) => (
            <li key={x.id} className="relative">
              <span className={cn("absolute top-1.5 -left-[1.3125rem] size-2 rounded-full", i === 0 ? "bg-violet" : "bg-line")} aria-hidden />
              <p className={cn("text-sm", i === 0 ? "text-ink" : "text-ink-2")}>
                {shipmentStatusLabels[x.status]}
                {x.carrier ? `, ${x.carrier}` : ""}
              </p>
              <p className="text-xs text-ink-3 tabular">
                {formatDay(x.occurredAt.slice(0, 10))}
                {x.trackingNumber ? `, tracking ${x.trackingNumber}` : ""}
              </p>
              {x.note && x.status === "exception" ? (
                <>
                  {x.noteNotice ? <PaymentsNotice className="mt-1" /> : null}
                  <p className="mt-0.5 text-xs text-ink-2">{x.note}</p>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {d ? (
        complaint ? (
          <div role="status" className="flex gap-3 rounded-md border border-line-soft bg-surface px-3 py-3">
            {complaint.status === "resolved" ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-violet" weight="fill" aria-hidden /> : <WarningIcon className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />}
            <div className="min-w-0 text-sm">
              <p className="text-ink">{complaint.status === "resolved" ? "Delivery problem resolved" : `You told ${d.brand.name}: ${complaintKindLabels[complaint.kind].toLowerCase()}`}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                {complaint.status === "escalated"
                  ? "Yard's support team is looking into it."
                  : complaint.status === "resolved"
                    ? (complaint.resolution ?? "Closed by Yard's support team.")
                    : `We've told ${d.brand.name}. Yard's support team steps in if it isn't sorted within 2 business days.`}
              </p>
              {complaint.brandResponse && complaint.responseNotice ? <PaymentsNotice className="mt-2" /> : null}
              {complaint.brandResponse ? (
                <p className="mt-2 flex gap-2 text-xs text-ink">
                  <ChatCircleDotsIcon className="mt-0.5 size-3.5 shrink-0 text-ink-2" aria-hidden />
                  <span>
                    <span className="text-ink-2">{d.brand.name} replied: </span>
                    {complaint.brandResponse}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        ) : !terminal ? (
          <Button variant="secondary" size="sm" className="w-full sm:w-auto" aria-haspopup="dialog" onClick={() => setComplaintOpen(true)}>
            Problem with delivery?
          </Button>
        ) : null
      ) : null}

      {d ? (
        <ComplaintForm
          open={complaintOpen}
          onOpenChange={setComplaintOpen}
          orderId={order.id}
          brandName={brand.name}
          onSent={(c) => q.mutate((cur) => (cur ? { ...cur, complaint: c } : cur))}
        />
      ) : null}
    </div>
  )
}
