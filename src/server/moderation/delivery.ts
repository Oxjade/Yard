import "server-only"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { abuseEvents, deliveryComplaints, holidays, orderRefs, shipmentEvents } from "../db/schema"
import { conflict, forbidden, notFound } from "../http/errors"
import { newId } from "../ids"
import { markFor, SCREEN_ACTION, screensFor } from "../shipping/screen"
import { canAdmin, needsRole } from "@/lib/permissions"
import { complaintKindLabels, type DeliveryIssueDto, type DeliveryListDto, type DeliveryTab, type HeldNoteViewResult, type HolidayDto } from "@/lib/api/contracts/admin"
import { assertState, audit, brandMap, brandRefOf, iso, kitMeta, nameOf, publishCountsAfterCommit, userMap, notify, type DecisionCtx } from "./shared"

/**
 * Admin › Delivery (§6.5, §8.1): late orders, complaints, carrier exceptions and the holiday
 * calendar the estimate engine reads. Estimates stay estimates; nothing here promises a date.
 */

const OPEN_COMPLAINT = ["open", "waiting_brand", "brand_responded", "escalated"]
const CLOSED_ORDER = ["delivered", "cancelled", "refunded", "returned"]

type Latest = { order_ref_id: string; basis: string; arrival_from: string | null; arrival_to: string | null; ship_by: string | null; first_from: string | null; first_to: string | null; first_ship_by: string | null; shipment: string | null }

/**
 * Per order: the current estimate, the promise (the first estimate that wasn't already a late
 * recompute: what the shopper was shown at checkout or on shipping) and the newest shipment status.
 * A sample order whose only estimates are late recomputes has no promise on record.
 */
async function estimates(orderIds?: string[]): Promise<Map<string, Latest>> {
  const d = await db()
  const filter = orderIds ? (orderIds.length ? sql`where e.order_ref_id in ${orderIds}` : sql`where false`) : sql``
  const promiseFilter = orderIds ? (orderIds.length ? sql`where e.order_ref_id in ${orderIds} and e.basis <> 'late'` : sql`where false`) : sql`where e.basis <> 'late'`
  const r = await d.execute(sql`
    with cur as (
      select distinct on (e.order_ref_id) e.order_ref_id, e.basis, e.arrival_from::text as arrival_from, e.arrival_to::text as arrival_to, e.ship_by::text as ship_by
      from delivery_estimates e ${filter} order by e.order_ref_id, e.computed_at desc
    ), firsts as (
      select distinct on (e.order_ref_id) e.order_ref_id, e.arrival_from::text as first_from, e.arrival_to::text as first_to, e.ship_by::text as first_ship_by
      from delivery_estimates e ${promiseFilter} order by e.order_ref_id, e.computed_at asc
    ), ship as (
      select distinct on (s.order_ref_id) s.order_ref_id, s.status as shipment from shipment_events s order by s.order_ref_id, s.occurred_at desc
    )
    select cur.*, firsts.first_from, firsts.first_to, firsts.first_ship_by, ship.shipment from cur
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

/**
 * Late orders, split by whether lateness can be measured: `late` have a promise on record (the
 * first estimate that wasn't a late recompute, with an arrival window or a ship-by date), so they
 * count as queue work; `unmeasured` were estimated only after they were already late (sample
 * orders) and are listed apart, never counted as work.
 */
export async function lateOrderCounts() {
  const d = await db()
  const r = await d.execute(sql`
    with cur as (select distinct on (order_ref_id) order_ref_id, basis, arrival_to from delivery_estimates order by order_ref_id, computed_at desc),
         firsts as (select distinct on (order_ref_id) order_ref_id, arrival_to as first_to, ship_by as first_ship_by from delivery_estimates where basis <> 'late' order by order_ref_id, computed_at asc),
         ship as (select distinct on (order_ref_id) order_ref_id, status from shipment_events order by order_ref_id, occurred_at desc)
    select count(*) filter (where firsts.first_to is not null or firsts.first_ship_by is not null)::int as late,
           count(*) filter (where firsts.first_to is null and firsts.first_ship_by is null)::int as unmeasured
    from cur join order_refs o on o.id = cur.order_ref_id left join ship on ship.order_ref_id = cur.order_ref_id left join firsts on firsts.order_ref_id = cur.order_ref_id
    where o.status not in ('delivered', 'cancelled', 'refunded', 'returned') and coalesce(ship.status, '') <> 'delivered' and cur.basis <> 'delivered'
      and (cur.basis = 'late' or (cur.arrival_to < current_date and cur.basis <> 'exception'))`)
  const row = (r.rows[0] ?? {}) as { late?: number; unmeasured?: number }
  return { late: Number(row.late ?? 0), unmeasured: Number(row.unmeasured ?? 0) }
}

/** For the queue counts: orders with a brand note held for review (a person must read it). */
export async function heldNoteCount() {
  const ids = await ordersWithHeldNotes()
  return ids.length
}

/** For the queue counts: late orders that can be measured against a promise. */
export async function lateOrderCount() {
  return (await lateOrderCounts()).late
}

type OrderRow = typeof orderRefs.$inferSelect
type ComplaintRow = typeof deliveryComplaints.$inferSelect
type BrandNote = DeliveryIssueDto["brandNotes"][number]

/** What D's screen held: the shopper never saw it. The list never carries its text (opened through an audited POST). */
const HELD_STATUS = "complaint_reply"

/**
 * The brand's notes on each order, newest first, with D's screen marks: its notes on shipment updates
 * and its replies to complaints (status "complaint_reply"). A held note never reached the shopper
 * (links or payment outside Yard, §5.2 scoring); a flagged one reached them under "Keep payments on
 * Yard". A held note's text is NOT in list responses: it's opened through POST
 * /api/admin/delivery/notes/{id}/view, audited as delivery_note.viewed (like held messages, §8.1).
 */
async function brandNotesFor(orderIds: string[]): Promise<Map<string, BrandNote[]>> {
  const out = new Map<string, BrandNote[]>()
  if (!orderIds.length) return out
  const d = await db()
  const ids = [...new Set(orderIds)]
  const events = await d
    .select({ id: shipmentEvents.id, orderId: shipmentEvents.orderRefId, status: shipmentEvents.status, at: shipmentEvents.occurredAt, note: shipmentEvents.note })
    .from(shipmentEvents)
    .where(and(inArray(shipmentEvents.orderRefId, ids), sql`${shipmentEvents.note} is not null and ${shipmentEvents.note} <> ''`))
    .orderBy(desc(shipmentEvents.occurredAt))
  const replies = await d
    .select({ id: deliveryComplaints.id, orderId: deliveryComplaints.orderRefId, at: deliveryComplaints.createdAt, note: deliveryComplaints.brandResponse })
    .from(deliveryComplaints)
    .where(and(inArray(deliveryComplaints.orderRefId, ids), sql`${deliveryComplaints.brandResponse} is not null and ${deliveryComplaints.brandResponse} <> ''`))
  const marks = await screensFor([...events.map((r) => r.id), ...replies.map((r) => r.id)])
  const rows = [...events, ...replies.map((r) => ({ ...r, status: HELD_STATUS }))].sort((a, b) => b.at.getTime() - a.at.getTime())
  for (const r of rows) {
    const list = out.get(r.orderId) ?? []
    const m = markFor(marks, r.id, r.note)
    // Six newest notes, but a held one is always listed (it's waiting on a person).
    if (list.length >= 6 && !m?.held) continue
    list.push({ id: r.id, status: r.status, at: r.at.toISOString(), text: m?.held ? null : (r.note ?? ""), held: !!m?.held, notice: !!m?.notice })
    out.set(r.orderId, list)
  }
  return out
}

/** Orders with a brand note D's screen held (abuse rows delivery.brand_text, held = true: a shipment update's note or a complaint reply). */
async function ordersWithHeldNotes(): Promise<string[]> {
  const d = await db()
  const rows = await d
    .selectDistinct({ orderId: sql<string>`${abuseEvents.detail}->>'orderRefId'` })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.action, SCREEN_ACTION), sql`${abuseEvents.detail}->>'subjectType' in ('shipment_event', 'delivery_complaint')`, sql`(${abuseEvents.detail}->>'held')::boolean is true`))
  const ids = rows.map((r) => r.orderId).filter(Boolean)
  if (!ids.length) return []
  // Only where the held text is still the note on record (a later edit with clean text isn't held).
  const notes = await brandNotesFor(ids)
  return ids.filter((id) => notes.get(id)?.some((n) => n.held))
}

async function issueDtos(items: { kind: DeliveryIssueDto["kind"]; order: OrderRow; complaint?: ComplaintRow }[]): Promise<DeliveryIssueDto[]> {
  const est = await estimates(items.map((i) => i.order.id))
  const notes = await brandNotesFor(items.map((i) => i.order.id))
  const brands = await brandMap(items.map((i) => i.order.brandId))
  const people = await userMap(items.map((i) => i.order.customerId))
  return items.map(({ kind, order: o, complaint: c }) => {
    const e = est.get(o.id)
    const reply = c ? (notes.get(o.id) ?? []).find((n) => n.id === c.id) : undefined
    // Late against the promise: unshipped past its ship-by date, or past its arrival window.
    const shipped = !!e?.shipment && e.shipment !== "label_created"
    const open = c?.status !== "resolved" && e?.basis !== "delivered" && e?.shipment !== "delivered"
    const measurable = !!(e?.first_to || e?.first_ship_by)
    const pastShipBy = !shipped && e?.first_ship_by ? daysBetween(e.first_ship_by, today()) : 0
    const pastArrival = e?.first_to ? daysBetween(e.first_to, today()) : 0
    // No promise on record: lateness can't be measured, so it's null rather than 0 ("on time").
    const late = !measurable ? null : open ? Math.max(0, pastShipBy, pastArrival) : 0
    return {
      id: c?.id ?? o.id,
      kind,
      orderId: o.id,
      reference: o.reference,
      brand: brandRefOf(brands, o.brandId),
      customer: { id: o.customerId, name: nameOf(people, o.customerId, "Unknown shopper") },
      city: o.shipToCity,
      country: o.shipToCountry,
      promised: e?.first_from || e?.first_to ? { from: e.first_from, to: e.first_to } : null,
      shipBy: e?.first_ship_by ?? null,
      current: e ? { from: e.arrival_from, to: e.arrival_to, basis: e.basis } : null,
      daysLate: late,
      measurable,
      complaintKind: (c?.kind as DeliveryIssueDto["complaintKind"]) ?? null,
      details: c?.details || null,
      // A held reply never reached the shopper: no text here, only the mark (opened through the audited view).
      brandResponse: reply?.held ? null : (c?.brandResponse ?? null),
      brandResponseHeld: !!reply?.held,
      brandResponseNotice: !!reply?.notice,
      resolution: c?.resolution ?? null,
      status: c?.status ?? (kind === "late" ? "late" : "exception"),
      shipment: e?.shipment ?? null,
      createdAt: (c?.createdAt ?? o.placedAt).toISOString(),
      resolvedAt: iso(c?.resolvedAt),
      brandNotes: notes.get(o.id) ?? [],
      heldNotes: (notes.get(o.id) ?? []).filter((n) => n.held).length,
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
  // Exceptions: carrier or brand-reported problems, plus every order with a brand note held for review.
  const held = which === "exception" ? new Set(await ordersWithHeldNotes()) : new Set<string>()
  const candidates = [...new Set([...[...est.values()].filter((e) => (which === "late" ? e.basis === "late" || (!!e.arrival_to && e.arrival_to < today()) : isException(e))).map((e) => e.order_ref_id), ...held])]
  if (!candidates.length) return []
  const orders = await d.select().from(orderRefs).where(inArray(orderRefs.id, candidates)).orderBy(asc(orderRefs.placedAt)).limit(300)
  const keep = orders.filter((o) => (which === "late" ? isLate(est.get(o.id), o.status) : isException(est.get(o.id)) || held.has(o.id)))
  const out = await issueDtos(keep.map((o) => ({ kind: which, order: o })))
  // Held notes first: they're the ones waiting on a person.
  return which === "exception" ? out.sort((a, b) => b.heldNotes - a.heldNotes) : out
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
    lateOrderCounts(),
    count(OPEN_COMPLAINT),
    orderIssues("exception").then((r) => r.length),
    count(["resolved"]),
    d.select({ n: sql<number>`count(*)::int` }).from(holidays).then((r) => Number(r[0]?.n ?? 0)),
  ])
  return { late: late.late, unmeasured: late.unmeasured, complaints, exceptions, resolved, holidays: hol }
}

export async function listDelivery(tab: DeliveryTab, country?: string): Promise<DeliveryListDto> {
  const items = tab === "late" ? await orderIssues("late") : tab === "exceptions" ? await orderIssues("exception") : tab === "complaints" ? await complaintIssues(OPEN_COMPLAINT) : tab === "resolved" ? await complaintIssues(["resolved"]) : []
  const all = tab === "holidays" ? await listHolidays(country) : []
  const d = await db()
  const countries = (await d.selectDistinct({ c: holidays.country }).from(holidays).orderBy(asc(holidays.country))).map((r) => r.c)
  // Late: only orders measured against a promise are queue rows; the rest are listed apart.
  const measured = tab === "late" ? items.filter((i) => i.measurable).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0)) : items
  const unmeasured = tab === "late" ? items.filter((i) => !i.measurable) : []
  return { tab, items: measured, unmeasured, holidays: all, countries, counts: await deliveryCounts() }
}

/**
 * POST /api/admin/delivery/notes/{id}/view: the text of a brand note D's screen held (a shipment
 * update's note, or a complaint reply by its complaint id), audited as delivery_note.viewed. Held
 * text may carry payment details outside Yard, so only the roles that act on it open it.
 */
export async function viewHeldNote(ctx: DecisionCtx, id: string): Promise<HeldNoteViewResult> {
  if (!canAdmin(ctx.actor.role, "shipping.resolve") && !canAdmin(ctx.actor.role, "messages.view_reports")) throw forbidden(`${needsRole("shipping.resolve")}.`)
  return withTx(async () => {
    const d = await db()
    let found: { orderId: string; text: string | null; at: Date; kind: "shipment_note" | "complaint_reply" } | null = null
    if (id.startsWith("dc_")) {
      const c = await d.query.deliveryComplaints.findFirst({ where: (x, { eq }) => eq(x.id, id) })
      if (c) found = { orderId: c.orderRefId, text: c.brandResponse, at: c.createdAt, kind: "complaint_reply" }
    } else {
      const e = await d.query.shipmentEvents.findFirst({ where: (x, { eq }) => eq(x.id, id) })
      if (e) found = { orderId: e.orderRefId, text: e.note, at: e.occurredAt, kind: "shipment_note" }
    }
    if (!found || !found.text) throw notFound()
    const mark = markFor(await screensFor([id]), id, found.text)
    if (!mark?.held) throw conflict("This note wasn't held, so it's already shown with the order.")
    const order = await d.query.orderRefs.findFirst({ where: (x, { eq }) => eq(x.id, found.orderId) })
    if (!order) throw notFound()
    const brands = await brandMap([order.brandId])
    const entry = await audit(ctx, {
      action: "delivery_note.viewed",
      target: `Held ${found.kind === "complaint_reply" ? "complaint reply" : "shipment note"} from ${brandRefOf(brands, order.brandId).name} on order ${order.reference}`,
      subjectType: found.kind === "complaint_reply" ? "delivery_complaint" : "shipment_event",
      subjectId: id,
      brandId: order.brandId,
      meta: { orderId: order.id, ...kitMeta(ctx) },
    })
    return { id, orderId: order.id, kind: found.kind, at: found.at.toISOString(), text: found.text, audit: entry }
  })
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
    meta: { orderId: order.id, kind: complaint?.kind ?? "late", from: complaint?.status ?? null },
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
    meta: { orderId: order.id, from: complaint!.status },
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
    meta: { orderId: order.id, from: complaint!.status },
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
