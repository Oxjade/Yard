import "server-only"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "../db"
import { deliveryComplaints, holidays, orderRefs } from "../db/schema"
import { conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { notify } from "../notify"
import { complaintKindLabels, type DeliveryIssueDto, type DeliveryListDto, type DeliveryTab, type HolidayDto } from "@/lib/api/contracts/admin"
import { assertState, audit, brandMap, brandRefOf, iso, nameOf, publishCountsAfterCommit, userMap, type DecisionCtx } from "./shared"

/**
 * Admin › Delivery (§6.5, §8.1): late orders, complaints, carrier exceptions and the holiday
 * calendar the estimate engine reads. Estimates stay estimates; nothing here promises a date.
 */

const OPEN_COMPLAINT = ["open", "waiting_brand", "brand_responded", "escalated"]
const CLOSED_ORDER = ["delivered", "cancelled", "refunded", "returned"]

type Latest = { order_ref_id: string; basis: string; arrival_from: string | null; arrival_to: string | null; ship_by: string | null; first_from: string | null; first_to: string | null; first_ship_by: string | null; shipment: string | null }

/** Per order: the current estimate, the first (promised) one and the newest shipment status. */
async function estimates(orderIds?: string[]): Promise<Map<string, Latest>> {
  const d = await db()
  const filter = orderIds ? (orderIds.length ? sql`where e.order_ref_id in ${orderIds}` : sql`where false`) : sql``
  const r = await d.execute(sql`
    with cur as (
      select distinct on (e.order_ref_id) e.order_ref_id, e.basis, e.arrival_from::text as arrival_from, e.arrival_to::text as arrival_to, e.ship_by::text as ship_by
      from delivery_estimates e ${filter} order by e.order_ref_id, e.computed_at desc
    ), firsts as (
      select distinct on (e.order_ref_id) e.order_ref_id, e.arrival_from::text as first_from, e.arrival_to::text as first_to, e.ship_by::text as first_ship_by
      from delivery_estimates e ${filter} order by e.order_ref_id, e.computed_at asc
    ), ship as (
      select distinct on (s.order_ref_id) s.order_ref_id, s.status as shipment from shipment_events s order by s.order_ref_id, s.occurred_at desc
    )
    select cur.*, firsts.first_from, firsts.first_to, ship.shipment from cur
    left join firsts on firsts.order_ref_id = cur.order_ref_id
    left join ship on ship.order_ref_id = cur.order_ref_id`)
  const out = new Map<string, Latest>()
  for (const row of r.rows as Latest[]) out.set(row.order_ref_id, row)
  return out
}

const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

function isLate(e: Latest | undefined, status: string) {
  if (!e || CLOSED_ORDER.includes(status) || e.shipment === "delivered" || e.basis === "delivered") return false
  return e.basis === "late" || (!!e.arrival_to && e.arrival_to < today() && e.basis !== "exception")
}
const isException = (e: Latest | undefined) => !!e && (e.basis === "exception" || e.shipment === "exception" || e.shipment === "returned")

/** For the queue counts: orders past their estimate (or marked late) and not delivered. */
export async function lateOrderCount() {
  const d = await db()
  const r = await d.execute(sql`
    with cur as (select distinct on (order_ref_id) order_ref_id, basis, arrival_to from delivery_estimates order by order_ref_id, computed_at desc),
         ship as (select distinct on (order_ref_id) order_ref_id, status from shipment_events order by order_ref_id, occurred_at desc)
    select count(*)::int as n from cur join order_refs o on o.id = cur.order_ref_id left join ship on ship.order_ref_id = cur.order_ref_id
    where o.status not in ('delivered', 'cancelled', 'refunded', 'returned') and coalesce(ship.status, '') <> 'delivered' and cur.basis <> 'delivered'
      and (cur.basis = 'late' or (cur.arrival_to < current_date and cur.basis <> 'exception'))`)
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0)
}

type OrderRow = typeof orderRefs.$inferSelect
type ComplaintRow = typeof deliveryComplaints.$inferSelect

async function issueDtos(items: { kind: DeliveryIssueDto["kind"]; order: OrderRow; complaint?: ComplaintRow }[]): Promise<DeliveryIssueDto[]> {
  const est = await estimates(items.map((i) => i.order.id))
  const brands = await brandMap(items.map((i) => i.order.brandId))
  const people = await userMap(items.map((i) => i.order.customerId))
  return items.map(({ kind, order: o, complaint: c }) => {
    const e = est.get(o.id)
    // Late against the promise: unshipped past its ship-by date, or past its arrival window.
    const shipped = !!e?.shipment && e.shipment !== "label_created"
    const open = c?.status !== "resolved" && e?.basis !== "delivered" && e?.shipment !== "delivered"
    const pastShipBy = !shipped && e?.first_ship_by ? daysBetween(e.first_ship_by, today()) : 0
    const pastArrival = e?.first_to ? daysBetween(e.first_to, today()) : 0
    const late = open ? Math.max(0, pastShipBy, pastArrival) : 0
    return {
      id: c?.id ?? o.id,
      kind,
      orderId: o.id,
      reference: o.reference,
      brand: brandRefOf(brands, o.brandId),
      customer: { id: o.customerId, name: nameOf(people, o.customerId, "Unknown shopper") },
      city: o.shipToCity,
      country: o.shipToCountry,
      promised: e ? { from: e.first_from, to: e.first_to } : null,
      shipBy: e?.first_ship_by ?? null,
      current: e ? { from: e.arrival_from, to: e.arrival_to, basis: e.basis } : null,
      daysLate: late,
      complaintKind: (c?.kind as DeliveryIssueDto["complaintKind"]) ?? null,
      details: c?.details || null,
      brandResponse: c?.brandResponse ?? null,
      resolution: c?.resolution ?? null,
      status: c?.status ?? (kind === "late" ? "late" : "exception"),
      shipment: e?.shipment ?? null,
      createdAt: (c?.createdAt ?? o.placedAt).toISOString(),
      resolvedAt: iso(c?.resolvedAt),
    }
  })
}

async function ordersByIds(ids: string[]) {
  const d = await db()
  const out = new Map<string, OrderRow>()
  if (!ids.length) return out
  for (const o of await d.select().from(orderRefs).where(inArray(orderRefs.id, [...new Set(ids)]))) out.set(o.id, o)
  return out
}

async function complaintIssues(statuses: string[]) {
  const d = await db()
  const rows = await d
    .select()
    .from(deliveryComplaints)
    .where(inArray(deliveryComplaints.status, statuses))
    .orderBy(statuses.includes("resolved") ? desc(deliveryComplaints.resolvedAt) : asc(deliveryComplaints.createdAt))
    .limit(300)
  const orders = await ordersByIds(rows.map((c) => c.orderRefId))
  return issueDtos(rows.filter((c) => orders.has(c.orderRefId)).map((c) => ({ kind: "complaint" as const, order: orders.get(c.orderRefId)!, complaint: c })))
}

async function orderIssues(which: "late" | "exception") {
  const d = await db()
  const est = await estimates()
  const candidates = [...est.values()].filter((e) => (which === "late" ? e.basis === "late" || (!!e.arrival_to && e.arrival_to < today()) : isException(e))).map((e) => e.order_ref_id)
  if (!candidates.length) return []
  const orders = await d.select().from(orderRefs).where(inArray(orderRefs.id, candidates)).orderBy(asc(orderRefs.placedAt)).limit(300)
  const keep = orders.filter((o) => (which === "late" ? isLate(est.get(o.id), o.status) : isException(est.get(o.id))))
  return issueDtos(keep.map((o) => ({ kind: which, order: o })))
}

function holidayDto(h: typeof holidays.$inferSelect): HolidayDto {
  return { id: h.id, country: h.country, date: h.date, name: h.name, kind: h.kind as HolidayDto["kind"], estimated: h.estimated, source: h.source as HolidayDto["source"] }
}

export async function listHolidays(country?: string) {
  const d = await db()
  const rows = await d
    .select()
    .from(holidays)
    .where(country ? eq(holidays.country, country) : undefined)
    .orderBy(asc(holidays.country), asc(holidays.date))
  return rows.map(holidayDto)
}

export async function deliveryCounts() {
  const d = await db()
  const count = async (statuses: string[]) => Number((await d.select({ n: sql<number>`count(*)::int` }).from(deliveryComplaints).where(inArray(deliveryComplaints.status, statuses)))[0]?.n ?? 0)
  const [late, complaints, exceptions, resolved, hol] = await Promise.all([
    lateOrderCount(),
    count(OPEN_COMPLAINT),
    orderIssues("exception").then((r) => r.length),
    count(["resolved"]),
    d.select({ n: sql<number>`count(*)::int` }).from(holidays).then((r) => Number(r[0]?.n ?? 0)),
  ])
  return { late, complaints, exceptions, resolved, holidays: hol }
}

export async function listDelivery(tab: DeliveryTab, country?: string): Promise<DeliveryListDto> {
  const items = tab === "late" ? await orderIssues("late") : tab === "exceptions" ? await orderIssues("exception") : tab === "complaints" ? await complaintIssues(OPEN_COMPLAINT) : tab === "resolved" ? await complaintIssues(["resolved"]) : []
  const all = tab === "holidays" ? await listHolidays(country) : []
  const d = await db()
  const countries = (await d.selectDistinct({ c: holidays.country }).from(holidays).orderBy(asc(holidays.country))).map((r) => r.c)
  return { tab, items: tab === "late" ? items.sort((a, b) => b.daysLate - a.daysLate) : items, holidays: all, countries, counts: await deliveryCounts() }
}

/* ── Decisions ─────────────────────────────────────────────────────── */

async function issueFor(id: string) {
  const d = await db()
  if (id.startsWith("dc_")) {
    const c = await d.query.deliveryComplaints.findFirst({ where: (x, { eq }) => eq(x.id, id) })
    if (!c) throw notFound()
    const o = await d.query.orderRefs.findFirst({ where: (x, { eq }) => eq(x.id, c.orderRefId) })
    if (!o) throw notFound()
    return { complaint: c, order: o }
  }
  const o = await d.query.orderRefs.findFirst({ where: (x, { eq }) => eq(x.id, id) })
  if (!o) throw notFound()
  return { complaint: undefined, order: o }
}

async function dtoFor(order: OrderRow, complaint?: ComplaintRow) {
  const est = await estimates([order.id])
  const kind: DeliveryIssueDto["kind"] = complaint ? "complaint" : isException(est.get(order.id)) ? "exception" : "late"
  return (await issueDtos([{ kind, order, complaint }]))[0]
}

/** contact-brand-about-delivery: a template notification naming the order (no free text, §2.7). */
export async function contactBrand(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const { complaint, order } = await issueFor(body.id)
  assertState(!complaint || complaint.status !== "resolved", "This complaint is already resolved — refreshed.")
  let c = complaint
  if (complaint && complaint.status === "open") [c] = await d.update(deliveryComplaints).set({ status: "waiting_brand" }).where(eq(deliveryComplaints.id, complaint.id)).returning()
  const kindLabel = complaint ? complaintKindLabels[complaint.kind as keyof typeof complaintKindLabels] : "Running late"
  await notify({ kind: "brand", id: order.brandId }, { key: `delivery-contact:${complaint?.id ?? order.id}`, template: "delivery.complaint_for_brand", vars: { reference: order.reference, kind: kindLabel }, href: `/studio/orders/${order.id}` })
  const brands = await brandMap([order.brandId])
  const entry = await audit(ctx, {
    action: "delivery.contacted_brand",
    target: `Order ${order.reference}, ${brandRefOf(brands, order.brandId).name}`,
    subjectType: complaint ? "delivery_complaint" : "order_ref",
    subjectId: complaint?.id ?? order.id,
    brandId: order.brandId,
    reason: body.reason,
    meta: { orderId: order.id, kind: complaint?.kind ?? "late" },
  })
  publishCountsAfterCommit()
  return { item: await dtoFor(order, c), audit: entry }
}

/** resolve-delivery-issue: a complaint with its resolution; the shopper and the brand hear it. */
export async function resolveIssue(ctx: DecisionCtx, body: { id: string; resolution: string; reason: string }) {
  const d = await db()
  if (!body.id.startsWith("dc_")) throw conflict("Only a complaint can be marked resolved. Contact the brand about a late order instead.")
  const { complaint, order } = await issueFor(body.id)
  assertState(complaint!.status !== "resolved")
  const [c] = await d
    .update(deliveryComplaints)
    .set({ status: "resolved", resolution: body.resolution, resolvedAt: new Date(), resolvedBy: ctx.actor.userId })
    .where(and(eq(deliveryComplaints.id, complaint!.id), inArray(deliveryComplaints.status, OPEN_COMPLAINT)))
    .returning()
  assertState(!!c)
  await notify({ kind: "shopper", id: order.customerId }, { key: `delivery-resolved:${c.id}`, template: "delivery.resolved", vars: { reference: order.reference }, href: `/you/orders/${order.id}` })
  await notify({ kind: "brand", id: order.brandId }, { key: `delivery-resolved:${c.id}`, template: "delivery.resolved", vars: { reference: order.reference }, href: `/studio/orders/${order.id}` })
  const brands = await brandMap([order.brandId])
  const entry = await audit(ctx, {
    action: "delivery.resolved",
    target: `Order ${order.reference}, ${brandRefOf(brands, order.brandId).name}: ${complaintKindLabels[c.kind as keyof typeof complaintKindLabels].toLowerCase()}`,
    subjectType: "delivery_complaint",
    subjectId: c.id,
    brandId: order.brandId,
    reason: body.reason,
    meta: { orderId: order.id },
  })
  publishCountsAfterCommit()
  return { item: await dtoFor(order, c), audit: entry }
}

/** escalate-delivery-issue: a complaint goes to the escalated list for a senior decision. */
export async function escalateIssue(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  if (!body.id.startsWith("dc_")) throw conflict("Only a complaint can be escalated.")
  const { complaint, order } = await issueFor(body.id)
  assertState(complaint!.status !== "resolved" && complaint!.status !== "escalated")
  const [c] = await d.update(deliveryComplaints).set({ status: "escalated" }).where(eq(deliveryComplaints.id, complaint!.id)).returning()
  const brands = await brandMap([order.brandId])
  const entry = await audit(ctx, {
    action: "delivery.escalated",
    target: `Order ${order.reference}, ${brandRefOf(brands, order.brandId).name}`,
    subjectType: "delivery_complaint",
    subjectId: c.id,
    brandId: order.brandId,
    reason: body.reason,
    meta: { orderId: order.id },
  })
  publishCountsAfterCommit()
  return { item: await dtoFor(order, c), audit: entry }
}

/** add-holiday: `id` is the country code. Estimates read the calendar when they're next computed. */
export async function addHoliday(ctx: DecisionCtx, body: { id: string; date: string; name: string; kind: "public" | "carrier"; estimated: boolean; reason: string }) {
  const country = body.id.toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw notFound("Choose a country.")
  const d = await db()
  const [row] = await d
    .insert(holidays)
    .values({ id: newId("hol"), country, date: body.date, name: body.name, kind: body.kind, estimated: body.estimated, source: "admin", createdBy: ctx.actor.userId })
    .onConflictDoNothing()
    .returning()
  if (!row) throw conflict(`${body.name} on ${body.date} is already in ${country}'s calendar.`)
  const entry = await audit(ctx, { action: "holiday.added", target: `${body.name}, ${country}, ${body.date}${body.estimated ? " (estimated)" : ""}`, subjectType: "holiday", subjectId: row.id, reason: body.reason, meta: { country, date: body.date, kind: body.kind } })
  return { item: holidayDto(row), audit: entry }
}

export async function removeHoliday(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const [row] = await d.delete(holidays).where(eq(holidays.id, body.id)).returning()
  if (!row) throw notFound()
  const entry = await audit(ctx, { action: "holiday.removed", target: `${row.name}, ${row.country}, ${row.date}`, subjectType: "holiday", subjectId: row.id, reason: body.reason, meta: { country: row.country, date: row.date, source: row.source } })
  return { item: holidayDto(row), audit: entry }
}
