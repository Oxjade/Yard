import type { DeliveryDto } from "@/lib/api/contracts/shipping"
import type { DeliverySnapshot, MerchantOrder } from "@/lib/data/types"

/**
 * Yard's server holds the order's delivery record; this browser holds its own copy of the order
 * (§1.11). When the brand acts from another device, the server's shipment events are the only news
 * this browser gets, so the order's status, ship and delivery times, tracking and timeline follow
 * them here: the progress tracker, the returns window and the orders list then agree with the
 * Delivery panel. Only forward moves (paid → shipped → delivered); a cancelled or refunded order,
 * or one already further on, keeps its own state.
 */

const SHIPPED = new Set(["shipped", "in_transit", "out_for_delivery"])
const BEFORE_SHIPPING = new Set<MerchantOrder["status"]>(["pending_payment", "paid", "processing"])

export function deliverySnapshot(d: DeliveryDto): DeliverySnapshot {
  const e = d.estimate
  return { basis: e.basis, dispatchFrom: e.dispatchFrom, shipBy: e.shipBy, arrivalFrom: e.arrivalFrom, arrivalTo: e.arrivalTo, deliveredOn: e.deliveredOn, late: e.late, guaranteed: false, service: d.service, source: "server", computedAt: e.computedAt }
}

/** The order with the server's delivery record applied, or null when nothing changes. */
export function reconcileOrder(o: MerchantOrder, d: DeliveryDto, opts: { deliveredLabel?: string } = {}): MerchantOrder | null {
  if (o.id !== d.orderId) return null
  let next = o
  let changed = false
  if (!(o.delivery?.source === "server" && o.delivery.computedAt === d.estimate.computedAt)) {
    next = { ...next, delivery: deliverySnapshot(d) }
    changed = true
  }
  if (o.status === "cancelled" || o.status === "refunded") return changed ? next : null
  const added: MerchantOrder["timeline"] = []
  const firstShip = d.events.find((e) => SHIPPED.has(e.status))
  const delivered = d.events.find((e) => e.status === "delivered")
  const shipEvent = firstShip ?? delivered
  if (shipEvent && BEFORE_SHIPPING.has(next.status)) {
    const tracking = next.tracking ?? (shipEvent.carrier && shipEvent.trackingNumber ? { carrier: shipEvent.carrier, number: shipEvent.trackingNumber } : undefined)
    added.push({ at: shipEvent.occurredAt, label: tracking && !next.tracking ? `Shipped with ${tracking.carrier}, tracking ${tracking.number}` : `Shipped by ${d.brand.name}` })
    next = { ...next, status: "shipped", shippedAt: next.shippedAt ?? shipEvent.occurredAt, tracking }
    changed = true
  }
  if (delivered && next.status === "shipped") {
    added.push({ at: delivered.occurredAt, label: opts.deliveredLabel ?? `Marked delivered by ${d.brand.name}` })
    next = { ...next, status: "delivered", deliveredAt: next.deliveredAt ?? delivered.occurredAt }
    changed = true
  }
  if (added.length) next = { ...next, timeline: [...next.timeline, ...added].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) }
  return changed ? next : null
}
