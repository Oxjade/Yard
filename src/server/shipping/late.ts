import "server-only"
import { and, asc, eq, inArray, lt } from "drizzle-orm"
import { complaintKindLabels } from "@/lib/api/contracts/shipping"
import { addBusinessDays, businessDaysBetween, dateIn, makeCalendar, WEEKDAYS } from "@/lib/shipping/calendar"
import { formatShortRange } from "@/lib/shipping/format"
import { db, withTx } from "../db"
import { deliveryComplaints, deliveryEstimates, orderRefs } from "../db/schema"
import { notifyAdmins } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { notifyLateOnce, recomputeOrder, toEstimateDto, type EstimateCache } from "./orders"
import { loadBrandShipping } from "./profile"
import { destTimeZone } from "./quote"

const MON_FRI = makeCalendar(WEEKDAYS, [])

/**
 * Hourly (§6.5): re-reads every paid order that hasn't been delivered.
 * - Unshipped past its ship-by date, or shipped past its arrival window: a `late` estimate is
 *   stored, the shopper is told (at most once a day per order), and an order more than 2 business days late becomes an
 *   admin delivery issue (shipping.view).
 * - Unpaid orders are never late: no payment provider is connected, so no brand should ship them.
 * - Sample (seeded) orders get fresh estimates but no notifications.
 * - A delivery problem the brand hasn't answered within 2 business days goes to Yard's support team.
 */
export async function checkLate(now = Date.now()) {
  const d = await db()
  const open = await d
    .select({ id: orderRefs.id, source: orderRefs.source, customerId: orderRefs.customerId, brandId: orderRefs.brandId, reference: orderRefs.reference, shipToCountry: orderRefs.shipToCountry })
    .from(orderRefs)
    // Paid orders only: the shipment route refuses events on unpaid ones, and this keeps it that way
    // for any row that got there another way.
    .where(and(inArray(orderRefs.status, ["paid", "processing", "shipped"]), eq(orderRefs.paid, true)))
    .orderBy(asc(orderRefs.placedAt))
    .limit(2000)
  let late = 0
  const cache: EstimateCache = { brands: new Map(), calendars: new Map() }
  for (const o of open) {
    await withTx(async () => {
      const r = await recomputeOrder(o.id, "late_check", now, cache)
      if (!r.changed || !r.estimate.late) return
      late++
      if (o.source !== "browser") return
      const s = await loadBrandShipping(o.brandId)
      const brand = s?.brand.name ?? "The brand"
      const e = toEstimateDto(r.row)
      const range = e.arrivalFrom && e.arrivalTo ? formatShortRange(e.arrivalFrom, e.arrivalTo) : "soon"
      const { providerId: _p, reason: _r, computedAt: _c, ...estimate } = e
      void _p
      void _r
      void _c
      await publish(channels.user(o.customerId), "order.estimate", { orderId: o.id, estimate })
      await notifyLateOnce({ id: o.id, customerId: o.customerId }, brand, range, now)
      // More than 2 business days past the ship-by date (or the first arrival window): Yard's team looks.
      const [first] = await d.select().from(deliveryEstimates).where(eq(deliveryEstimates.orderRefId, o.id)).orderBy(asc(deliveryEstimates.computedAt)).limit(1)
      const due = first?.shipBy ?? first?.arrivalTo
      const today = dateIn(destTimeZone(o.shipToCountry), now)
      if (due && businessDaysBetween(due, today, MON_FRI) > 2) {
        await notifyAdmins("shipping.view", { key: `delivery-issue:${o.id}`, template: "delivery.admin_issue", vars: { kind: "late order", reference: o.reference, brand }, href: `/admin/delivery?order=${o.id}` })
      }
    })
  }

  // Unanswered delivery problems older than 2 business days.
  const cutoff = new Date(now - 2 * 86_400_000)
  const waiting = await d.select().from(deliveryComplaints).where(and(inArray(deliveryComplaints.status, ["open", "waiting_brand"]), lt(deliveryComplaints.createdAt, cutoff))).limit(500)
  let escalated = 0
  for (const c of waiting) {
    const created = dateIn("UTC", c.createdAt.getTime())
    if (addBusinessDays(created, 2, MON_FRI) >= dateIn("UTC", now)) continue
    await withTx(async () => {
      const t = await db()
      const [row] = await t.update(deliveryComplaints).set({ status: "escalated" }).where(and(eq(deliveryComplaints.id, c.id), inArray(deliveryComplaints.status, ["open", "waiting_brand"]))).returning()
      if (!row) return
      escalated++
      const order = await t.query.orderRefs.findFirst({ where: (x, { eq }) => eq(x.id, c.orderRefId) })
      const s = await loadBrandShipping(c.brandId)
      await notifyAdmins("shipping.view", { key: `delivery-issue:${c.id}`, template: "delivery.admin_issue", vars: { kind: complaintKindLabels[c.kind as keyof typeof complaintKindLabels]?.toLowerCase() ?? "delivery problem", reference: order?.reference ?? "", brand: s?.brand.name ?? "" }, href: `/admin/delivery?complaint=${c.id}` })
    })
  }
  return { checked: open.length, late, escalated }
}
