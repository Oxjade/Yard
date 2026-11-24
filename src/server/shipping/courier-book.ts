import "server-only"
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import type { CurrencyCode } from "@/config/markets"
import type { StudioCourierDto } from "@/lib/api/contracts/shipping"
import { formatMoney } from "@/lib/money"
import type { BrandActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx, type Tx } from "../db"
import { orderRefs, shipmentEvents, users } from "../db/schema"
import { courierEvents, courierShipments } from "../db/schema/courier"
import { orderStates } from "../db/schema/orders-v3"
import { conflict, notConfigured, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { postCourierBooked } from "../ledger"
import { log } from "../log"
import { notify, notifyAdmins } from "../notify"
import { addEvent, announce, emailCustomer, lockOrder, orderUrl, syncFulfilment, type OrderActor } from "../orders/core"
import { absorbDecision, bookRefusal, eventForCourierStatus, shipmentStateFor, tokenUsable, type CourierChoice } from "./courier-core"
import { courierSettingsFor, invalidateCourierSettings, noteCourierFailure, quoteFor, storedQuote, type ShopperAddress } from "./courier-quote"
import { recordCarrierShipment } from "./orders"
import { loadBrandShipping } from "./profile"
import { courierConfig, getCourier } from "./providers"
import { CourierError, type CourierProvider, type CourierRate, type CourierTracking } from "./providers/courier-types"

/**
 * Booking couriers and following them (docs/SHIPPING.md).
 *
 * "Book pickup" (Studio): one courier_shipments row per order is claimed in its own transaction
 * before the provider is called, so a double click, a second tab or a second member never books
 * twice. The provider call runs outside any transaction; its outcome is written in a second one
 * (shipment booked, ledger: courier wallet → shipping spent, order shipped, shopper told).
 *
 * Updates (webhook, or the hourly tracking poll) move the shipment and the order along the
 * existing shipment states, and notify the shopper and the brand.
 */

type ShipmentRow = typeof courierShipments.$inferSelect
type OrderRow = typeof orderRefs.$inferSelect

const DONE = ["booked", "in_transit", "delivered"]
const STALE_BOOKING_MS = 3 * 60_000

const money = (minor: number, currency: string) => {
  try {
    return formatMoney(minor, currency as CurrencyCode)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

const choiceOf = (o: Pick<OrderRow, "quoted">) => ((o.quoted as { courier?: CourierChoice } | null)?.courier ?? null) as CourierChoice | null

/* ---------- Studio: the courier side of an order ---------- */

export function toStudioCourier(order: Pick<OrderRow, "id" | "status" | "paid" | "quoted">, shipment: ShipmentRow | null): StudioCourierDto {
  const choice = choiceOf(order)
  return {
    courierOrder: !!choice,
    choice: choice ? { name: choice.name, amountMinor: choice.amountMinor, currency: choice.currency, eta: choice.eta } : null,
    refusal: shipment && DONE.includes(shipment.status) ? null : bookRefusal(order, order.quoted as { courier?: unknown } | null) ?? (getCourier() ? null : "Courier booking isn't connected on Yard right now. Add tracking by hand."),
    shipment: shipment
      ? {
          id: shipment.id,
          status: shipment.status,
          courierName: shipment.courierName,
          trackingCode: shipment.trackingCode,
          trackingUrl: shipment.trackingUrl,
          labelUrl: shipment.labelUrl,
          printUrl: `/api/studio/orders/${encodeURIComponent(order.id)}/courier/label`,
          collectedMinor: shipment.collectedMinor,
          costMinor: shipment.costMinor,
          priceDiffMinor: shipment.priceDiffMinor,
          requoted: shipment.requoted,
          currency: shipment.currency,
          error: shipment.error,
          bookedAt: shipment.bookedAt?.toISOString() ?? null,
        }
      : null,
  }
}

async function brandOrder(brandId: string, orderRefId: string) {
  const d = await db()
  const [order] = await d
    .select()
    .from(orderRefs)
    .where(and(eq(orderRefs.id, orderRefId), eq(orderRefs.brandId, brandId)))
    .limit(1)
  if (!order) throw notFound()
  const [shipment] = await d.select().from(courierShipments).where(eq(courierShipments.orderRefId, order.id)).limit(1)
  return { order, shipment: shipment ?? null }
}

export async function studioCourier(actor: BrandActor, orderRefId: string): Promise<StudioCourierDto> {
  const { order, shipment } = await brandOrder(actor.brandId, orderRefId)
  return toStudioCourier(order, shipment)
}

/* ---------- Book pickup ---------- */

/** Claims the order's one booking (in its own transaction). Returns the row to book, or the finished one. */
async function claim(actor: BrandActor, orderRefId: string, provider: CourierProvider): Promise<{ row: ShipmentRow; order: OrderRow; done: boolean }> {
  return withTx(async (tx) => {
    const locked = await lockOrder(tx, orderRefId)
    if (!locked || locked.order.brandId !== actor.brandId) throw notFound()
    const { order } = locked
    const [existing] = await tx.select().from(courierShipments).where(eq(courierShipments.orderRefId, order.id)).for("update").limit(1)
    if (existing && DONE.includes(existing.status)) return { row: existing, order, done: true }
    if (existing?.status === "booking") {
      if (Date.now() - existing.updatedAt.getTime() < STALE_BOOKING_MS) throw conflict("This pickup is being booked right now. It shows here in a moment.")
      // The process stopped mid-call: the courier may have it. Never book blind a second time.
      await tx.update(courierShipments).set({ status: "needs_review", error: "The booking didn't finish. Yard is checking with the courier before booking again.", updatedAt: new Date() }).where(eq(courierShipments.id, existing.id))
      throw conflict("The last booking didn't finish, so Yard is checking with the courier before booking again. Yard's team has been told.")
    }
    if (existing?.status === "needs_review") throw conflict("Yard is checking this booking with the courier before trying again. Yard's team has been told; add tracking by hand if you ship it another way.")
    const refusal = bookRefusal(order, order.quoted as { courier?: unknown } | null)
    if (refusal) throw rule(refusal)
    const choice = choiceOf(order)!
    const now = new Date()
    if (existing) {
      const [row] = await tx
        .update(courierShipments)
        .set({ status: "booking", error: null, attempts: existing.attempts + 1, bookedBy: actor.userId, updatedAt: now })
        .where(and(eq(courierShipments.id, existing.id), inArray(courierShipments.status, ["failed", "cancelled"])))
        .returning()
      if (!row) throw conflict("This pickup is being booked right now. It shows here in a moment.")
      return { row, order, done: false }
    }
    const [row] = await tx
      .insert(courierShipments)
      .values({ id: newId("cs"), orderRefId: order.id, brandId: order.brandId, provider: provider.id, status: "booking", courierId: choice.courierId, serviceCode: choice.serviceCode, courierName: choice.name, currency: choice.currency, collectedMinor: choice.amountMinor, attempts: 1, bookedBy: actor.userId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning()
    if (!row) throw conflict("This pickup is being booked right now. It shows here in a moment.")
    return { row, order, done: false }
  })
}

/** The shopper's address for a re-quote, from the order (as checkout stored it) and the account email. */
async function receiverFor(order: OrderRow): Promise<ShopperAddress | null> {
  const d = await db()
  const [st] = await d.select({ shipTo: orderStates.shipTo }).from(orderStates).where(eq(orderStates.orderRefId, order.id)).limit(1)
  const [u] = await d.select({ email: users.email }).from(users).where(eq(users.id, order.customerId)).limit(1)
  const t = st?.shipTo as (Record<string, string | undefined> & { country: string }) | null
  if (!t || !t.phone || !t.line1 || !t.city || !t.name || !u?.email) return null
  return { name: t.name, email: u.email, phone: t.phone, line1: [t.line1, t.line2].filter(Boolean).join(", "), city: t.city, region: t.region, postcode: t.postalCode ?? t.postcode, country: t.country }
}

/** The rate to book: the stored quote's token while it's usable, else a fresh quote for the same courier (or the cheapest). */
async function rateToBook(provider: CourierProvider, order: OrderRow, choice: CourierChoice, opts: { requote?: boolean } = {}) {
  const s = await loadBrandShipping(order.brandId, { fresh: true })
  if (!s) throw rule("This brand's shipping isn't set up.")
  const now = Date.now()
  const stored = opts.requote ? null : await storedQuote(choice.quoteId)
  if (stored && stored.provider === provider.id && tokenUsable(stored, now, s.profile.timeZone)) {
    const r = (stored.options as CourierRate[]).find((x) => x.courierId === choice.courierId && x.serviceCode === choice.serviceCode)
    if (r) return { requestToken: stored.requestToken, rate: r, requoted: false }
  }
  invalidateCourierSettings(order.brandId)
  const settings = await courierSettingsFor(order.brandId)
  if (!settings?.providerAddressCode) throw rule("Add and verify your pickup address in Studio › Shipping first.")
  const to = await receiverFor(order)
  if (!to) throw rule("This order's delivery address is incomplete, so the courier can't be booked. Add tracking by hand.")
  const items = ((order.items ?? []) as { productId: string; qty: number; unitMinor: number }[]).map((i) => ({ productId: i.productId, qty: i.qty, unitMinor: i.unitMinor, currency: order.currency }))
  const q = await quoteFor(provider, settings, s, items, to, now, { reuse: false })
  const rates = q.options as CourierRate[]
  const same = rates.find((x) => x.courierId === choice.courierId && x.serviceCode === choice.serviceCode)
  const rate = same ?? [...rates].sort((a, b) => a.amountMinor - b.amountMinor)[0]
  if (!rate) throw new CourierError("No courier can collect this parcel right now", "refused")
  return { requestToken: q.requestToken, rate, requoted: true }
}

export async function bookPickup(actor: BrandActor, orderRefId: string, ipHash: string | null): Promise<StudioCourierDto> {
  const provider = getCourier()
  if (!provider) throw notConfigured("Courier booking isn't connected on Yard right now. Add tracking by hand.")
  const claimed = await claim(actor, orderRefId, provider)
  if (claimed.done) return toStudioCourier(claimed.order, claimed.row)
  const { order } = claimed
  const choice = choiceOf(order)!

  let picked: Awaited<ReturnType<typeof rateToBook>> | null = null
  let booking: Awaited<ReturnType<CourierProvider["book"]>>
  try {
    picked = await rateToBook(provider, order, choice)
    try {
      booking = await provider.book({ requestToken: picked.requestToken, courierId: picked.rate.courierId, serviceCode: picked.rate.serviceCode })
    } catch (e) {
      // The provider refused a stored token Yard still thought valid (expired early, or its rate
      // changed): re-quote once and book that. A refusal never booked anything, so this is safe.
      if (!(e instanceof CourierError && e.kind === "refused") || picked.requoted) throw e
      log.warn(`[yard] couriers: ${provider.label} refused the stored rate for ${order.id} (${e.message}); re-quoting`)
      picked = await rateToBook(provider, order, choice, { requote: true })
      booking = await provider.book({ requestToken: picked.requestToken, courierId: picked.rate.courierId, serviceCode: picked.rate.serviceCode })
    }
  } catch (e) {
    // Only a booking call that may have reached the courier is ambiguous; a failed quote booked nothing.
    const ambiguous = e instanceof CourierError && e.ambiguous && picked !== null
    const status = ambiguous ? "needs_review" : "failed"
    const message = e instanceof CourierError || (e instanceof Error && e.name === "HttpError") ? e.message : "The courier couldn't be booked."
    await withTx(async (tx) => {
      await tx.update(courierShipments).set({ status, error: message.slice(0, 300), updatedAt: new Date() }).where(eq(courierShipments.id, claimed.row.id))
    })
    await noteCourierFailure(provider.id, "book_failed", e, { orderRefId: order.id, shipmentId: claimed.row.id })
    if (ambiguous) await notifyAdmins("shipping.view", { key: `courier-review:${claimed.row.id}`, template: "delivery.admin_issue", vars: { kind: "courier booking unconfirmed", reference: order.reference, brand: actor.brand.name }, href: `/admin/delivery?order=${order.id}` })
    if (e instanceof Error && e.name === "HttpError") throw e
    throw rule(ambiguous ? "The courier didn't confirm the booking. Yard is checking with them before trying again; you'll see it here." : `The courier couldn't be booked: ${message.replace(/\.$/, "")}. Try again in a few minutes, or add tracking by hand.`)
  }

  const cfg = courierConfig()
  const cost = booking.costMinor !== null && (booking.currency ?? picked.rate.currency) === choice.currency ? booking.costMinor : picked.rate.amountMinor
  const absorb = absorbDecision(choice.amountMinor, cost, cfg.absorbCapMinor)
  const courierName = booking.courierName ?? picked.rate.courierName
  const actorOf: OrderActor = { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }

  const row = await withTx(async (tx) => {
    const now = new Date()
    const [updated] = await tx
      .update(courierShipments)
      .set({
        status: booking.status === "delivered" ? "delivered" : booking.status === "in_transit" || booking.status === "picked_up" ? "in_transit" : "booked",
        providerOrderId: booking.providerOrderId,
        courierId: picked.rate.courierId,
        serviceCode: picked.rate.serviceCode,
        courierName,
        trackingCode: booking.trackingCode,
        trackingUrl: booking.trackingUrl,
        labelUrl: booking.labelUrl,
        costMinor: cost,
        priceDiffMinor: absorb.diffMinor,
        requoted: picked.requoted,
        overCap: absorb.overCap,
        providerStatus: booking.providerStatus,
        error: null,
        bookedAt: now,
        lastEventAt: now,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(courierShipments.id, claimed.row.id))
      .returning()
    await postCourierBooked(tx, { shipmentId: updated.id, orderId: order.id, brandId: order.brandId, currency: choice.currency, costMinor: cost, actor: { kind: "brand", id: actor.userId } })
    await moveOrder(tx, order.id, "shipped", { carrier: courierName, tracking: booking.trackingCode, brandName: actor.brand.name, actor: actorOf })
    if (absorb.overCap) {
      await tx.insert(courierEvents).values({ id: newId("cev"), provider: provider.id, kind: "price_over_cap", eventKey: `price_over_cap:${updated.id}`, orderRefId: order.id, shipmentId: updated.id, detail: `Re-quote cost ${money(cost, choice.currency)}; the shopper paid ${money(choice.amountMinor, choice.currency)} (Yard absorbs ${money(absorb.diffMinor, choice.currency)}, over the ${money(cfg.absorbCapMinor, choice.currency)} cap).` }).onConflictDoNothing()
      await notifyAdmins("shipping.view", { key: `courier-over-cap:${updated.id}`, template: "delivery.admin_issue", vars: { kind: `courier price up ${money(absorb.diffMinor, choice.currency)}`, reference: order.reference, brand: actor.brand.name }, href: `/admin/delivery?order=${order.id}` })
    }
    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "order.courier_booked",
      target: `Order ${order.reference}`,
      subjectType: "order_ref",
      subjectId: order.id,
      brandId: order.brandId,
      ipHash,
      meta: { provider: provider.id, courier: courierName, costMinor: cost, collectedMinor: choice.amountMinor, priceDiffMinor: absorb.diffMinor, requoted: picked.requoted, overCap: absorb.overCap },
    })
    return updated
  })
  return toStudioCourier({ ...order, status: "shipped" }, row)
}

/**
 * Records a courier step on the order (inside the caller's transaction): the shipment event, the
 * merchant status, the order's stored fulfilment, its timeline, and the shopper's email.
 */
async function moveOrder(tx: Tx, orderRefId: string, step: "shipped" | "in_transit" | "delivered" | "exception", info: { carrier: string | null; tracking: string | null; brandName: string; actor: OrderActor; occurredAt?: Date | null; location?: string | null }) {
  const r = await recordCarrierShipment(orderRefId, { status: step, carrier: info.carrier, trackingNumber: info.tracking, occurredAt: info.occurredAt, locationText: info.location, brandName: info.brandName })
  if (!r.recorded) return false
  const locked = await lockOrder(tx, orderRefId)
  if (!locked) return true
  const before = locked.state.fulfilmentStatus
  const { state } = await syncFulfilment(tx, locked.order, locked.state)
  if (state.fulfilmentStatus !== before) await addEvent(tx, orderRefId, `fulfilment.${state.fulfilmentStatus}`, info.actor, { source: "courier" })
  const vars = { reference: locked.order.reference, brand: info.brandName, url: orderUrl(orderRefId), ...(info.carrier ? { carrier: info.carrier, courier: info.carrier } : {}), ...(info.tracking ? { tracking: info.tracking } : {}) }
  if (r.firstShip) await emailCustomer(tx, locked.order.customerId, "shipped", { ...vars, ...(r.range && r.range !== "soon" ? { range: r.range } : {}) }, `order-shipped:${orderRefId}`)
  if (step === "delivered") await emailCustomer(tx, locked.order.customerId, "delivered", vars, `order-delivered:${orderRefId}`)
  await announce(locked.order, step === "delivered" ? "delivered" : "shipped")
  return true
}

/* ---------- Courier updates (webhook and tracking) ---------- */

/**
 * A courier status for a booked shipment. Unknown shipments are logged (Admin › Delivery) and
 * otherwise ignored. Idempotent: a repeat of the same status changes nothing.
 */
export async function applyCourierUpdate(providerId: string, u: CourierTracking, source: "webhook" | "poll"): Promise<{ matched: boolean; changed: boolean }> {
  const d = await db()
  const [found] = await d
    .select()
    .from(courierShipments)
    .where(and(eq(courierShipments.provider, providerId), eq(courierShipments.providerOrderId, u.providerOrderId)))
    .limit(1)
  if (!found) {
    await d.insert(courierEvents).values({ id: newId("cev"), provider: providerId, kind: "unmatched", eventKey: `unmatched:${providerId}:${u.providerOrderId}:${u.status}`, status: u.status, detail: `No Yard shipment for ${providerId} order ${u.providerOrderId.slice(0, 60)}.` }).onConflictDoNothing()
    return { matched: false, changed: false }
  }
  return withTx(async (tx) => {
    const [s] = await tx.select().from(courierShipments).where(eq(courierShipments.id, found.id)).for("update").limit(1)
    const order = await tx.query.orderRefs.findFirst({ where: (o, { eq }) => eq(o.id, s.orderRefId) })
    if (!order) return { matched: true, changed: false }
    const brand = await tx.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, order.brandId), columns: { name: true } })
    const brandName = brand?.name ?? "The brand"
    const events = await tx.select({ status: shipmentEvents.status }).from(shipmentEvents).where(eq(shipmentEvents.orderRefId, order.id)).orderBy(asc(shipmentEvents.occurredAt))
    const step = eventForCourierStatus(u.status, events.map((e) => e.status))
    const next = shipmentStateFor(s.status, u.status)
    const now = new Date()
    const patch: Partial<ShipmentRow> = { lastSyncedAt: now, updatedAt: now }
    if (u.providerStatus && u.providerStatus !== s.providerStatus) patch.providerStatus = u.providerStatus
    if (u.trackingCode && !s.trackingCode) patch.trackingCode = u.trackingCode
    if (u.trackingUrl && !s.trackingUrl) patch.trackingUrl = u.trackingUrl
    if (u.labelUrl && u.labelUrl !== s.labelUrl) patch.labelUrl = u.labelUrl
    const changed = next !== s.status || !!step || "trackingCode" in patch || "labelUrl" in patch
    if (next !== s.status) patch.status = next
    if (changed) patch.lastEventAt = now
    await tx.update(courierShipments).set(patch).where(eq(courierShipments.id, s.id))
    if (step) {
      await moveOrder(tx, order.id, step, { carrier: s.courierName, tracking: patch.trackingCode ?? s.trackingCode, brandName, actor: { kind: "provider", id: null, name: s.courierName }, occurredAt: u.occurredAt ? new Date(u.occurredAt) : null, location: u.location })
      const words = step === "delivered" ? "delivered" : step === "exception" ? "cancelled by the courier" : "picked up"
      await notify({ kind: "brand", id: order.brandId }, { key: `courier:${s.id}:${step}`, template: "delivery.courier_for_brand", vars: { reference: order.reference, step: words, courier: s.courierName ?? undefined, tracking: patch.trackingCode ?? s.trackingCode ?? undefined }, href: `/studio/orders/${order.id}` })
    }
    if (next === "cancelled" && s.status !== "cancelled") {
      await notifyAdmins("shipping.view", { key: `courier-cancelled:${s.id}`, template: "delivery.admin_issue", vars: { kind: "courier cancelled the pickup", reference: order.reference, brand: brandName }, href: `/admin/delivery?order=${order.id}` })
    }
    if (!step && changed) await announce(order, "courier")
    if (source === "poll" && changed) log.info(`[yard] couriers: ${s.id} is now ${next} (tracking poll)`)
    return { matched: true, changed }
  })
}

/** Hourly: asks the provider about booked shipments nobody has heard about for 6 hours (25 a run). */
export async function syncCourierShipments(now = Date.now()) {
  const provider = getCourier()
  if (!provider) return { checked: 0, changed: 0 }
  const d = await db()
  const due = await d
    .select({ id: courierShipments.id, providerOrderId: courierShipments.providerOrderId })
    .from(courierShipments)
    .where(and(eq(courierShipments.provider, provider.id), inArray(courierShipments.status, ["booked", "in_transit"]), or(isNull(courierShipments.lastSyncedAt), lt(courierShipments.lastSyncedAt, new Date(now - 6 * 3600_000)))))
    .orderBy(asc(courierShipments.lastSyncedAt))
    .limit(25)
  let changed = 0
  for (const s of due) {
    if (!s.providerOrderId) continue
    try {
      const t = await provider.track(s.providerOrderId)
      if ((await applyCourierUpdate(provider.id, t, "poll")).changed) changed++
    } catch (e) {
      await d.update(courierShipments).set({ lastSyncedAt: new Date() }).where(eq(courierShipments.id, s.id))
      await noteCourierFailure(provider.id, "track_failed", e, { shipmentId: s.id })
    }
  }
  return { checked: due.length, changed }
}
