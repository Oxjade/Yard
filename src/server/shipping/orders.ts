import "server-only"
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm"
import { countries, type CountryCode, type CurrencyCode, shippingRatesUsd, shippingZone } from "@/config/markets"
import type { ComplaintBody, ComplaintDto, CurrentEstimateDto, DeliveryDto, DeliverySnapshotDto, EstimateDto, RegisterOrderBody, RegisterResponse, ShipmentEventBody, ShipmentEventDto } from "@/lib/api/contracts/shipping"
import { complaintKindLabels } from "@/lib/api/contracts/shipping"
import { productById } from "@/lib/data/products"
import { convert, formatMoney } from "@/lib/money"
import { dateIn, nextBusinessDay, addBusinessDays } from "@/lib/shipping/calendar"
import { estimateDelivery, groupHandling } from "@/lib/shipping/estimate"
import { formatShortRange } from "@/lib/shipping/format"
import type { Estimate } from "@/lib/shipping/types"
import type { BrandActor, ShopperActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { deliveryComplaints, deliveryEstimates, orderGroups, orderRefs, shipmentEvents } from "../db/schema"
import type { OrderRefItem } from "../db/schema/orders"
import { badRequest, conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { notify } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { loadBrandShipping, type BrandShipping } from "./profile"
import { zoneFor } from "./providers"
import { calendarsFor, citySlugFor, destTimeZone, isCountry, isCurrency, lineKey, quoteBrand, resolveLines, verifyQuote, type PricedLine } from "./quote"

export type OrderRefRow = typeof orderRefs.$inferSelect
type EventRow = typeof shipmentEvents.$inferSelect
type EstimateRow = typeof deliveryEstimates.$inferSelect
type ComplaintRow = typeof deliveryComplaints.$inferSelect

type Quoted = { price?: { amount: number; currency: string }; priceBrand?: { amount: number; currency: string }; transit?: [number, number]; providerId?: string; label?: string; methodId?: string }

const OPEN_COMPLAINT = ["open", "waiting_brand", "brand_responded", "escalated"] as const
const SHIPPED = new Set(["shipped", "in_transit", "out_for_delivery", "delivered"])

/* ---------- Estimates for an order ---------- */

/** Transit for an order: what the shopper was quoted, else the brand's current method, else the platform default. */
function transitFor(order: OrderRefRow, s: BrandShipping | null): [number, number] {
  const q = order.quoted as Quoted | null
  if (q?.transit) return q.transit
  if (s) {
    const zone = zoneFor(s.zones, order.shipToCountry)
    const m = zone?.methods.find((x) => x.service === order.service) ?? zone?.methods.find((x) => x.service === "standard")
    if (m) return order.service === "pickup" ? [0, 0] : [m.transitMin, m.transitMax]
  }
  const origin = (s?.profile.originCountry ?? "NG") as CountryCode
  const dest = (isCountry(order.shipToCountry) ? order.shipToCountry : "NG") as CountryCode
  return shippingRatesUsd[shippingZone(origin, dest)].days
}

/**
 * The estimate for an order as things stand: from the order (placed, or late when it hasn't shipped
 * by its ship-by date), then each shipment event in time order. Exceptions are read at the time they
 * happened, so recomputing never pushes them further; a window that has passed without delivery is
 * marked late with a fresh short window.
 */
export type EstimateCache = { brands: Map<string, BrandShipping | null>; calendars: Map<string, Awaited<ReturnType<typeof calendarsFor>>> }

export async function computeEstimate(order: OrderRefRow, events: EventRow[], now = Date.now(), cache?: EstimateCache): Promise<{ estimate: Estimate; providerId: string; s: BrandShipping | null }> {
  let s = cache?.brands.get(order.brandId)
  if (s === undefined) {
    s = await loadBrandShipping(order.brandId)
    cache?.brands.set(order.brandId, s)
  }
  if (!s) {
    // No profile (it hasn't been seeded): nothing to estimate from but the platform defaults.
    return { estimate: { basis: "placed", late: false, holidaysCrossed: [], guaranteed: false, isEstimate: true }, providerId: "manual", s: null }
  }
  const calKey = `${order.brandId}|${order.shipToCountry}`
  let cals = cache?.calendars.get(calKey)
  if (!cals) {
    cals = await calendarsFor(s, order.shipToCountry)
    cache?.calendars.set(calKey, cals)
  }
  const { H, T } = cals
  const items = (order.items ?? []) as OrderRefItem[]
  const handling = groupHandling([s.profile.handlingMin, s.profile.handlingMax], items.map((i) => ({ processingDays: productById.get(i.productId)?.processingDays })))
  const base = {
    handlingCal: H,
    transitCal: T,
    timeZone: s.profile.timeZone,
    destTimeZone: destTimeZone(order.shipToCountry),
    cutoffLocal: s.profile.cutoffLocal,
    handling,
    transit: transitFor(order, s),
  }
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const shipped = sorted.some((e) => SHIPPED.has(e.status))
  // Only a paid order can run late before it ships: an unpaid one shouldn't ship at all.
  let est = estimateDelivery({ ...base, anchor: { kind: "placed", at: order.placedAt.getTime() }, now, shipped: shipped || !order.paid })
  let shipAt: number | null = null
  for (const e of sorted) {
    const at = e.occurredAt.getTime()
    if (e.status === "shipped" || e.status === "in_transit") {
      shipAt ??= at
      est = estimateDelivery({ ...base, anchor: { kind: e.status === "in_transit" && shipAt !== at ? "in_transit" : "shipped", at: shipAt }, now })
    } else if (e.status === "out_for_delivery") {
      est = estimateDelivery({ ...base, anchor: { kind: "out_for_delivery", at }, now })
    } else if (e.status === "exception" || e.status === "returned") {
      est = estimateDelivery({ ...base, anchor: { kind: "exception", at, previous: { arrivalFrom: est.arrivalFrom, arrivalTo: est.arrivalTo } }, now: at })
    } else if (e.status === "delivered") {
      est = estimateDelivery({ ...base, anchor: { kind: "delivered", at }, now })
    }
  }
  // Past the window and still not delivered: running late, re-planned from today.
  const today = dateIn(base.destTimeZone, now)
  if (est.basis !== "delivered" && est.arrivalTo && est.arrivalTo < today && shipped) {
    est = { ...est, basis: "late", late: true, arrivalFrom: nextBusinessDay(today, T), arrivalTo: addBusinessDays(today, 2, T) }
  }
  return { estimate: est, providerId: (order.quoted as Quoted | null)?.providerId ?? "manual", s }
}

const sameEstimate = (a: EstimateRow | undefined, e: Estimate) =>
  !!a && a.basis === e.basis && a.dispatchFrom === (e.dispatchFrom ?? null) && a.shipBy === (e.shipBy ?? null) && a.arrivalFrom === (e.arrivalFrom ?? null) && a.arrivalTo === (e.arrivalTo ?? null) && a.deliveredOn === (e.deliveredOn ?? null)

/** The estimate as the API sends it (from a stored row). */
export function toEstimateDto(row: EstimateRow, crossed: Estimate["holidaysCrossed"] = []): CurrentEstimateDto {
  return {
    basis: row.basis as CurrentEstimateDto["basis"],
    dispatchFrom: row.dispatchFrom ?? undefined,
    shipBy: row.shipBy ?? undefined,
    arrivalFrom: row.arrivalFrom ?? undefined,
    arrivalTo: row.arrivalTo ?? undefined,
    deliveredOn: row.deliveredOn ?? undefined,
    late: row.basis === "late" || row.basis === "exception",
    holidaysCrossed: crossed,
    guaranteed: false,
    isEstimate: true,
    providerId: row.providerId,
    reason: row.reason,
    computedAt: row.computedAt.toISOString(),
  }
}

export function toSnapshot(row: EstimateRow, service: string): DeliverySnapshotDto {
  return {
    basis: row.basis as DeliverySnapshotDto["basis"],
    dispatchFrom: row.dispatchFrom ?? undefined,
    shipBy: row.shipBy ?? undefined,
    arrivalFrom: row.arrivalFrom ?? undefined,
    arrivalTo: row.arrivalTo ?? undefined,
    deliveredOn: row.deliveredOn ?? undefined,
    late: row.basis === "late" || row.basis === "exception",
    guaranteed: false,
    service: service as DeliverySnapshotDto["service"],
    source: "server",
    computedAt: row.computedAt.toISOString(),
  }
}

export const estimateValues = (orderRefId: string, e: Estimate, providerId: string, reason: string | null, id = newId("de"), computedAt = new Date()) => ({
  id,
  orderRefId,
  basis: e.basis === "quote" ? "placed" : e.basis,
  dispatchFrom: e.dispatchFrom ?? null,
  shipBy: e.shipBy ?? null,
  arrivalFrom: e.arrivalFrom ?? null,
  arrivalTo: e.arrivalTo ?? null,
  deliveredOn: e.deliveredOn ?? null,
  guaranteed: false,
  providerId,
  reason,
  computedAt,
})

async function latestEstimate(orderRefId: string) {
  const d = await db()
  const [row] = await d.select().from(deliveryEstimates).where(eq(deliveryEstimates.orderRefId, orderRefId)).orderBy(desc(deliveryEstimates.computedAt)).limit(1)
  return row
}

async function eventsOf(orderRefId: string) {
  const d = await db()
  return d.select().from(shipmentEvents).where(eq(shipmentEvents.orderRefId, orderRefId)).orderBy(asc(shipmentEvents.occurredAt))
}

/**
 * Recomputes an order's estimate and stores a new row when it changed (the newest row is the
 * current estimate). Runs inside the caller's transaction when there is one.
 */
export async function recomputeOrder(orderRefId: string, reason: string, now = Date.now(), cache?: EstimateCache) {
  const d = await db()
  const order = await d.query.orderRefs.findFirst({ where: (o, { eq }) => eq(o.id, orderRefId) })
  if (!order) throw notFound()
  const { estimate, providerId } = await computeEstimate(order, await eventsOf(order.id), now, cache)
  const prev = await latestEstimate(order.id)
  if (sameEstimate(prev, estimate)) return { order, row: prev!, estimate, changed: false }
  const [row] = await d.insert(deliveryEstimates).values(estimateValues(order.id, estimate, providerId, reason, newId("de"), new Date(Math.max(now, (prev?.computedAt.getTime() ?? 0) + 1)))).returning()
  return { order, row, estimate, changed: true }
}

/** After a profile change: open, unshipped orders follow the new handling time and closures. */
export async function recomputeOpenOrders(brandId: string, reason: string) {
  const d = await db()
  const open = await d.select({ id: orderRefs.id }).from(orderRefs).where(and(eq(orderRefs.brandId, brandId), inArray(orderRefs.status, ["pending_payment", "paid", "processing"]))).limit(500)
  // One profile and calendar load for the whole run, and one short transaction per order.
  const cache: EstimateCache = { brands: new Map(), calendars: new Map() }
  let changed = 0
  for (const o of open) {
    await withTx(async () => {
      const ev = await eventsOf(o.id)
      if (ev.some((e) => SHIPPED.has(e.status))) return
      if ((await recomputeOrder(o.id, reason, Date.now(), cache)).changed) changed++
    })
  }
  return { checked: open.length, changed }
}

/* ---------- POST /api/orders/register ---------- */

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
function mintReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `YRD-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`
}

async function groupResponse(groupId: string, duplicate: boolean): Promise<RegisterResponse> {
  const d = await db()
  const group = await d.query.orderGroups.findFirst({ where: (g, { eq }) => eq(g.id, groupId) })
  if (!group) throw notFound()
  const orders = await d.select().from(orderRefs).where(eq(orderRefs.groupId, groupId)).orderBy(asc(orderRefs.reference))
  const out: RegisterResponse["orders"] = []
  for (const o of orders) {
    const row = await latestEstimate(o.id)
    out.push({
      id: o.id,
      reference: o.reference,
      brandId: o.brandId,
      service: o.service as "standard" | "express" | "pickup",
      subtotal: o.subtotalMinor,
      shipping: o.shippingMinor,
      total: o.totalMinor,
      delivery: row ? toSnapshot(row, o.service) : { basis: "placed", late: false, guaranteed: false, service: o.service as "standard", source: "server", computedAt: o.createdAt.toISOString() },
    })
  }
  return { groupId: group.id, reference: group.reference, customerId: group.customerId, placedAt: (orders[0]?.placedAt ?? group.createdAt).toISOString(), currency: orders[0]?.currency ?? "USD", orders: out, duplicate }
}

/**
 * Registers a browser checkout (§6.5): no ids in the body; brands derived from the lines; each
 * quote token verified and re-quoted (409 on any change); idempotent per (shopper, key);
 * insert-only; server-minted group, order ids and references. Emits no chart signal: these orders
 * aren't paid (§6.3).
 */
export async function registerOrders(actor: ShopperActor, body: RegisterOrderBody): Promise<{ status: 200 | 201; body: RegisterResponse }> {
  const fields: Record<string, string> = {}
  if (!isCountry(body.shipTo.country)) fields["shipTo.country"] = "Choose one of Yard's markets."
  if (!isCurrency(body.currency)) fields.currency = "Choose one of Yard's currencies."
  if (Object.keys(fields).length) throw badRequest(fields)
  const to = body.shipTo.country as CountryCode
  const currency = body.currency as CurrencyCode

  // 1. Each group's brand comes from its lines (one brand per group, each brand once).
  const seen = new Set<string>()
  const groups = body.groups.map((g, i) => {
    const r = resolveLines(g.lines, `groups.${i}.lines`)
    if (seen.has(r.brandId)) throw badRequest({ [`groups.${i}`]: "This brand is already in another group." })
    seen.add(r.brandId)
    return { ...r, service: g.service, token: g.quoteToken, index: i }
  })

  // 2. Idempotent per shopper: a retry after a lost response returns the same group unchanged.
  const d0 = await db()
  const existing = await d0.query.orderGroups.findFirst({ where: (g, { and, eq }) => and(eq(g.customerId, actor.userId), eq(g.idempotencyKey, body.idempotencyKey)) })
  if (existing) return { status: 200, body: await groupResponse(existing.id, true) }

  // 3. Verify every quote token and re-quote (no I/O but the database; still outside the write).
  const now = Date.now()
  const citySlug = citySlugFor(body.shipTo.city, to)
  const priced: { brandId: string; lines: PricedLine[]; option: NonNullable<Awaited<ReturnType<typeof quoteBrand>>["options"][number]>; subtotal: number; service: string }[] = []
  for (const g of groups) {
    const s = await loadBrandShipping(g.brandId)
    const name = s?.brand.name ?? "this brand"
    const again = `Review shipping for ${name} and place your order again. Nothing was placed.`
    const p = verifyQuote(g.token)
    const keyLines = lineKey(g.lines.map((l) => ({ productId: l.product.id, variantId: l.variantId, qty: l.qty })))
    if (!p || p.b !== g.brandId || p.to !== to || p.c !== citySlug || p.cur !== currency || p.l.join("|") !== keyLines.join("|")) throw conflict(`Shipping for ${name} needs a fresh quote. ${again}`)
    if (p.exp < now) throw conflict(`The shipping quote for ${name} expired. ${again}`)
    const fresh = await quoteBrand({ brandId: g.brandId, lines: g.lines, to, city: body.shipTo.city, currency, now })
    const option = fresh.options.find((o) => o.service === g.service && o.available)
    if (!option) throw conflict(`${name} no longer offers ${g.service} delivery to ${countries[to].name}. ${again}`)
    const quotedPrice = p.o[g.service]
    if (quotedPrice === undefined || quotedPrice !== option.price.amount) throw conflict(`Shipping changed for ${name}: now ${option.price.amount === 0 ? "free" : formatMoney(option.price.amount, currency)}. Review and place your order again. Nothing was placed.`)
    if (p.sub !== fresh.subtotal.amount) throw conflict(`Prices changed for ${name}. ${again}`)
    priced.push({ brandId: g.brandId, lines: g.lines, option, subtotal: fresh.subtotal.amount, service: g.service })
  }

  // 4. One short transaction: mint ids and references, insert-only.
  const placedAt = new Date(now)
  try {
    const groupId = await withTx(async () => {
      const d = await db()
      const again = await d.query.orderGroups.findFirst({ where: (g, { and, eq }) => and(eq(g.customerId, actor.userId), eq(g.idempotencyKey, body.idempotencyKey)) })
      if (again) return again.id
      const id = newId("cg")
      const reference = mintReference()
      await d.insert(orderGroups).values({ id, customerId: actor.userId, idempotencyKey: body.idempotencyKey, reference, createdAt: placedAt })
      for (const [n, g] of priced.entries()) {
        const orderId = newId("or")
        const shipping = g.option.price.amount
        // Unit prices in the order currency, as the cart showed them.
        const items: OrderRefItem[] = g.lines.map((l) => ({ productId: l.product.id, variantId: l.variantId, name: l.product.name, qty: l.qty, unitMinor: convert(l.product.price, l.product.currency, currency) }))
        const quoted: Quoted = { price: g.option.price, priceBrand: g.option.priceBrand, transit: g.option.transit, providerId: g.option.providerId, label: g.option.label, methodId: g.option.methodId }
        const [order] = await d
          .insert(orderRefs)
          .values({
            id: orderId,
            groupId: id,
            reference: `${reference}-${n + 1}`,
            brandId: g.brandId,
            customerId: actor.userId,
            placedAt,
            status: "pending_payment",
            paid: false,
            currency,
            subtotalMinor: g.subtotal,
            shippingMinor: shipping,
            totalMinor: g.subtotal + shipping,
            items,
            shipToCountry: to,
            shipToCity: body.shipTo.city?.trim() || null,
            service: g.service,
            quoted,
            source: "browser",
            createdAt: placedAt,
          })
          .returning()
        const { estimate, providerId } = await computeEstimate(order, [], now)
        await d.insert(deliveryEstimates).values(estimateValues(order.id, estimate, providerId, "placed", newId("de"), placedAt))
      }
      return id
    })
    const res = await groupResponse(groupId, false)
    return { status: res.groupId === groupId && !res.duplicate ? 201 : 200, body: res }
  } catch (e) {
    // A concurrent duplicate lost the race on the unique index: answer with the winner's group.
    const d = await db()
    const won = await d.query.orderGroups.findFirst({ where: (g, { and, eq }) => and(eq(g.customerId, actor.userId), eq(g.idempotencyKey, body.idempotencyKey)) })
    if (won) return { status: 200, body: await groupResponse(won.id, true) }
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw conflict("That checkout couldn't be recorded. Try again; nothing was placed.")
    throw e
  }
}

/* ---------- Delivery views ---------- */

export function toEventDto(e: EventRow): ShipmentEventDto {
  return {
    id: e.id,
    status: e.status as ShipmentEventDto["status"],
    occurredAt: e.occurredAt.toISOString(),
    carrier: e.carrier,
    trackingNumber: e.trackingNumber,
    locationText: e.locationText,
    note: e.note,
    source: e.source as ShipmentEventDto["source"],
  }
}

export function toComplaintDto(c: ComplaintRow): ComplaintDto {
  return {
    id: c.id,
    kind: c.kind as ComplaintDto["kind"],
    details: c.details,
    status: c.status as ComplaintDto["status"],
    brandResponse: c.brandResponse,
    resolution: c.resolution,
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
  }
}

export async function deliveryFor(order: OrderRefRow): Promise<DeliveryDto> {
  const d = await db()
  const events = await eventsOf(order.id)
  const rows = await d.select().from(deliveryEstimates).where(eq(deliveryEstimates.orderRefId, order.id)).orderBy(asc(deliveryEstimates.computedAt))
  const computed = await computeEstimate(order, events)
  // The stored row is the current estimate; when there's none yet (an order the delivery seed
  // hasn't reached), the computed one stands in, unstored: a GET never writes.
  const latest = rows[rows.length - 1]
  const estimate = latest
    ? toEstimateDto(latest, computed.estimate.holidaysCrossed)
    : { ...computed.estimate, basis: computed.estimate.basis, holidaysCrossed: computed.estimate.holidaysCrossed, guaranteed: false as const, isEstimate: true as const, providerId: computed.providerId, reason: null, computedAt: new Date().toISOString() }
  const [complaint] = await d.select().from(deliveryComplaints).where(eq(deliveryComplaints.orderRefId, order.id)).orderBy(desc(deliveryComplaints.createdAt)).limit(1)
  const firstShip = events.find((e) => e.status === "shipped" || e.status === "in_transit")
  const brand = computed.s?.brand
  return {
    orderId: order.id,
    reference: order.reference,
    brand: { id: order.brandId, name: brand?.name ?? "The brand" },
    service: order.service as DeliveryDto["service"],
    shipTo: { country: order.shipToCountry, city: order.shipToCity },
    placedAt: order.placedAt.toISOString(),
    sample: order.source === "seed",
    estimate: estimate as CurrentEstimateDto,
    placedEstimate: rows[0] ? toEstimateDto(rows[0]) : null,
    shippedOn: firstShip ? dateIn(computed.s?.profile.timeZone ?? "UTC", firstShip.occurredAt.getTime()) : null,
    events: events.map(toEventDto),
    complaint: complaint ? toComplaintDto(complaint) : null,
  }
}

/** The shopper's own order, else 404 (another shopper's order never shows it exists). */
export async function shopperOrder(actor: ShopperActor, orderId: string) {
  const d = await db()
  const order = await d.query.orderRefs.findFirst({ where: (o, { and, eq }) => and(eq(o.id, orderId), eq(o.customerId, actor.userId)) })
  if (!order) throw notFound()
  return order
}

/** Loader for requireBrandResource: an order of the active brand only. */
export const brandOrderLoader = (orderId: string) => async (activeBrandId: string) => {
  const d = await db()
  return (await d.query.orderRefs.findFirst({ where: (o, { and, eq }) => and(eq(o.id, orderId), eq(o.brandId, activeBrandId)) })) ?? null
}

/* ---------- Shipment events (Studio) ---------- */

const estimateOnly = (row: EstimateRow): EstimateDto => {
  const { providerId: _p, reason: _r, computedAt: _c, ...rest } = toEstimateDto(row)
  void _p
  void _r
  void _c
  return rest
}

export async function recordShipment(actor: BrandActor, order: OrderRefRow, body: ShipmentEventBody, ipHash: string | null) {
  const now = Date.now()
  let at = now
  if (body.occurredAt) {
    at = Date.parse(body.occurredAt)
    if (!Number.isFinite(at) || at > now + 5 * 60_000) throw badRequest({ occurredAt: "That time is in the future." })
    if (at < order.placedAt.getTime() - 60_000 || at < now - 60 * 86_400_000) throw badRequest({ occurredAt: "That's before the order was placed." })
  }
  if (body.status === "shipped" && body.trackingNumber && !body.carrier) throw badRequest({ carrier: "Name the carrier for this tracking number." })
  const brandName = actor.brand.name
  return withTx(async () => {
    const d = await db()
    const before = await eventsOf(order.id)
    const firstShip = (body.status === "shipped" || body.status === "in_transit") && !before.some((e) => SHIPPED.has(e.status))
    const [event] = await d
      .insert(shipmentEvents)
      .values({ id: newId("se"), orderRefId: order.id, status: body.status, occurredAt: new Date(at), carrier: body.carrier || null, trackingNumber: body.trackingNumber?.toUpperCase() || null, note: body.note || null, source: "merchant", createdBy: actor.userId })
      .returning()
    const status = body.status === "delivered" ? "delivered" : SHIPPED.has(body.status) && ["pending_payment", "paid", "processing"].includes(order.status) ? "shipped" : null
    if (status) await d.update(orderRefs).set({ status }).where(eq(orderRefs.id, order.id))
    const r = await recomputeOrder(order.id, `event:${body.status}`)
    const estimate = estimateOnly(r.row)
    await publish(channels.user(order.customerId), "order.estimate", { orderId: order.id, estimate })
    const range = estimate.arrivalFrom && estimate.arrivalTo ? formatShortRange(estimate.arrivalFrom, estimate.arrivalTo) : "soon"
    if (firstShip) await notify({ kind: "shopper", id: order.customerId }, { key: `shipped:${order.id}`, template: "delivery.shipped", vars: { brand: brandName, range }, href: `/you/orders/${order.id}` })
    if (body.status === "exception" || body.status === "returned" || (r.changed && estimate.basis === "late")) await notify({ kind: "shopper", id: order.customerId }, { key: `late:${order.id}`, template: "delivery.late", vars: { brand: brandName, range }, href: `/you/orders/${order.id}` })
    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "order.shipment_recorded",
      target: `Order ${order.reference}`,
      subjectType: "order_ref",
      subjectId: order.id,
      brandId: order.brandId,
      ipHash,
      meta: { status: body.status, carrier: body.carrier ?? null, estimate: { basis: estimate.basis, arrivalFrom: estimate.arrivalFrom ?? null, arrivalTo: estimate.arrivalTo ?? null } },
    })
    return { event: toEventDto(event), estimate, delivery: await deliveryFor({ ...order, status: status ?? order.status }) }
  })
}

/* ---------- Complaints ---------- */

export async function fileComplaint(actor: ShopperActor, order: OrderRefRow, body: ComplaintBody) {
  if (body.kind === "other" && !body.details.trim()) throw badRequest({ details: "Tell the brand what happened." })
  return withTx(async () => {
    const d = await db()
    const [open] = await d
      .select()
      .from(deliveryComplaints)
      .where(and(eq(deliveryComplaints.orderRefId, order.id), inArray(deliveryComplaints.status, [...OPEN_COMPLAINT])))
      .limit(1)
    const s = await loadBrandShipping(order.brandId)
    const brandName = s?.brand.name ?? "The brand"
    if (open) throw conflict(`You've already told ${brandName} about this order. Their reply shows here.`)
    const [row] = await d
      .insert(deliveryComplaints)
      // customer and brand come from the order, never from the request (SEC-6).
      .values({ id: newId("dc"), orderRefId: order.id, customerId: order.customerId, brandId: order.brandId, kind: body.kind, details: body.details.trim(), status: "waiting_brand" })
      .returning()
    await notify({ kind: "brand", id: order.brandId }, { key: `complaint:${row.id}`, template: "delivery.complaint_for_brand", vars: { reference: order.reference, kind: complaintKindLabels[body.kind] }, href: `/studio/orders/${order.id}` })
    const current = await latestEstimate(order.id)
    if (current) await publish(channels.brand(order.brandId), "order.estimate", { orderId: order.id, estimate: estimateOnly(current) })
    await writeAudit({ actor: { kind: "shopper", id: actor.userId, name: actor.name }, action: "delivery_complaint.created", target: `Order ${order.reference}`, subjectType: "delivery_complaint", subjectId: row.id, brandId: order.brandId, meta: { kind: body.kind } })
    return toComplaintDto(row)
  })
}

export async function respondToComplaint(actor: BrandActor, order: OrderRefRow, message: string, ipHash: string | null) {
  return withTx(async () => {
    const d = await db()
    const [c] = await d
      .select()
      .from(deliveryComplaints)
      .where(and(eq(deliveryComplaints.orderRefId, order.id), eq(deliveryComplaints.brandId, actor.brandId), notInArray(deliveryComplaints.status, ["resolved"])))
      .orderBy(desc(deliveryComplaints.createdAt))
      .limit(1)
    if (!c) throw notFound("There's no open delivery problem on this order.")
    const [row] = await d.update(deliveryComplaints).set({ brandResponse: message.trim(), status: "brand_responded" }).where(eq(deliveryComplaints.id, c.id)).returning()
    // The shopper on the order, never one named by the request (SEC-6).
    await notify({ kind: "shopper", id: order.customerId }, { key: `complaint-reply:${c.id}`, template: "delivery.complaint_reply", vars: { brand: actor.brand.name }, href: `/you/orders/${order.id}` })
    const current = await latestEstimate(order.id)
    if (current) await publish(channels.user(order.customerId), "order.estimate", { orderId: order.id, estimate: estimateOnly(current) })
    await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "delivery_complaint.responded", target: `Order ${order.reference}`, subjectType: "delivery_complaint", subjectId: c.id, brandId: order.brandId, ipHash })
    return toComplaintDto(row)
  })
}
