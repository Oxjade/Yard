import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { SHIPPING_SERVICES } from "@/lib/api/contracts/enums"
import { afterCommit, withTx, type Tx } from "../db"
import { deliveryEstimates, orderGroups, orderRefs } from "../db/schema"
import type { OrderRefItem } from "../db/schema/orders"
import { orderLines, orderStates, type OrderShipTo } from "../db/schema/orders-v3"
import { enqueueEmail } from "../email"
import { badRequest, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { computeEstimate, estimateValues } from "../shipping/orders"
import { addEvent, announce, assertAmbientTx, brandName, customerEmail, orderUrl, setMerchantStatus, updateState } from "./core"
import { refundCancelledPaidOrder } from "./cancel"
import { money } from "./refunds"

/* ---------- Contract input shapes (as written in the v3 brief) ---------- */

export type CheckoutLineInput = { variantId: string; productId: string; title: string; qty: number; unitMinor: number }
export type CheckoutGroupInput = { brandId: string; lines: CheckoutLineInput[]; shippingMinor: number; shippingService: string; subtotalMinor: number; totalMinor: number }
export type CreateOrdersInput = { checkoutId: string; customerId: string; currency: string; groups: CheckoutGroupInput[]; shipTo: unknown }

const shipToSchema = z
  .object({
    name: z.string().max(120).optional(),
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    postcode: z.string().max(32).optional(),
    country: z.string().regex(/^[A-Z]{2}$/),
    phone: z.string().max(40).optional(),
  })
  .passthrough()

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
function mintReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `YRD-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`
}

const checkoutKey = (checkoutId: string) => `checkout:${checkoutId}`

/** Integer minor units, non-negative. */
const isMinor = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0

/**
 * ORDERS contract: one order_ref (+ order_states, order_lines, first delivery estimate) per brand
 * group, all under one order group and reference. Idempotent per checkout: a second call for the
 * same checkoutId returns the orders the first one made. Totals are checked, never trusted:
 * subtotal = Σ qty × unit, total = subtotal + shipping.
 */
export async function createOrdersFromCheckout(tx: Tx, input: CreateOrdersInput): Promise<{ orderIds: string[]; reference: string }> {
  assertAmbientTx("createOrdersFromCheckout")
  const existing = await tx.query.orderGroups.findFirst({ where: (g, { and, eq }) => and(eq(g.customerId, input.customerId), eq(g.idempotencyKey, checkoutKey(input.checkoutId))) })
  if (existing) {
    const rows = await tx.select({ id: orderRefs.id }).from(orderRefs).where(eq(orderRefs.groupId, existing.id)).orderBy(orderRefs.reference)
    return { orderIds: rows.map((r) => r.id), reference: existing.reference }
  }

  const ship = shipToSchema.safeParse(input.shipTo)
  if (!ship.success) throw badRequest({ shipTo: "Add a delivery address with a country." })
  const shipTo = ship.data as OrderShipTo
  if (!/^[A-Z]{3}$/.test(input.currency)) throw badRequest({ currency: "Choose one of Yard's currencies." })
  if (!input.groups.length) throw rule("There's nothing to order.")

  const seen = new Set<string>()
  for (const [i, g] of input.groups.entries()) {
    if (seen.has(g.brandId)) throw rule(`Checkout group ${i + 1} repeats a brand.`)
    seen.add(g.brandId)
    if (!g.lines.length) throw rule(`Checkout group ${i + 1} has no lines.`)
    if (!(SHIPPING_SERVICES as readonly string[]).includes(g.shippingService)) throw rule(`Checkout group ${i + 1} has an unknown shipping service.`)
    const variants = new Set<string>()
    for (const l of g.lines) {
      if (!Number.isInteger(l.qty) || l.qty < 1 || !isMinor(l.unitMinor)) throw rule(`Checkout group ${i + 1} has a line with an invalid quantity or price.`)
      if (variants.has(l.variantId)) throw rule(`Checkout group ${i + 1} lists a variant twice.`)
      variants.add(l.variantId)
    }
    const subtotal = g.lines.reduce((s, l) => s + l.qty * l.unitMinor, 0)
    if (!isMinor(g.shippingMinor) || subtotal !== g.subtotalMinor || g.subtotalMinor + g.shippingMinor !== g.totalMinor) throw rule(`Checkout group ${i + 1}'s totals don't add up.`)
  }

  const now = new Date()
  const groupId = newId("cg")
  const reference = mintReference()
  await tx.insert(orderGroups).values({ id: groupId, customerId: input.customerId, idempotencyKey: checkoutKey(input.checkoutId), reference, createdAt: now })

  const orderIds: string[] = []
  for (const [n, g] of input.groups.entries()) {
    const orderId = newId("or")
    const items: OrderRefItem[] = g.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, name: l.title, qty: l.qty, unitMinor: l.unitMinor }))
    const [order] = await tx
      .insert(orderRefs)
      .values({
        id: orderId,
        groupId,
        reference: `${reference}-${n + 1}`,
        brandId: g.brandId,
        customerId: input.customerId,
        placedAt: now,
        status: "pending_payment",
        paid: false,
        currency: input.currency,
        subtotalMinor: g.subtotalMinor,
        shippingMinor: g.shippingMinor,
        totalMinor: g.totalMinor,
        items,
        shipToCountry: shipTo.country,
        shipToCity: shipTo.city?.trim() || null,
        service: g.shippingService,
        quoted: { price: { amount: g.shippingMinor, currency: input.currency } },
        // order_refs.source only allows seed|browser today; v3 checkout orders are browser orders.
        source: "browser",
        createdAt: now,
      })
      .returning()
    await tx.insert(orderStates).values({
      orderRefId: orderId,
      checkoutId: input.checkoutId,
      brandId: g.brandId,
      customerId: input.customerId,
      currency: input.currency,
      totalMinor: g.totalMinor,
      paymentStatus: "pending",
      fulfilmentStatus: "unfulfilled",
      returnStatus: "none",
      shipTo,
      createdAt: now,
    })
    await tx.insert(orderLines).values(g.lines.map((l, i) => ({ id: newId("ol"), orderRefId: orderId, variantId: l.variantId, productId: l.productId, title: l.title.slice(0, 200), qty: l.qty, unitMinor: l.unitMinor, currency: input.currency, position: i })))
    try {
      const { estimate, providerId } = await computeEstimate(order, [], now.getTime())
      await tx.insert(deliveryEstimates).values(estimateValues(order.id, estimate, providerId, "placed", newId("de"), now))
    } catch (e) {
      // An estimate is a nicety; the order stands without one (shipping recomputes on the first event).
      log.warn(`[yard] orders: no delivery estimate for ${order.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
    await addEvent(tx, orderId, "order.placed", { kind: "shopper", id: input.customerId }, { checkoutId: input.checkoutId, totalMinor: g.totalMinor, currency: input.currency })
    orderIds.push(orderId)
  }
  return { orderIds, reference }
}

/**
 * ORDERS contract: payment captured for a checkout. Idempotent (an order already paid is left
 * alone). An order cancelled before the payment landed is still marked paid, then refunded in full
 * and restocked after commit (and by the sweep job if that fails), because the money did arrive.
 * LEDGER postPaymentCaptured and CATALOG commitHold stay with CHECKOUT.
 */
export async function markCheckoutPaid(tx: Tx, input: { checkoutId: string; paymentId: string; paidAt: Date }): Promise<{ orderIds: string[] }> {
  assertAmbientTx("markCheckoutPaid")
  const states = await tx.select().from(orderStates).where(eq(orderStates.checkoutId, input.checkoutId)).for("update")
  if (!states.length) return { orderIds: [] }
  const orders = await tx.select().from(orderRefs).where(inArray(orderRefs.id, states.map((s) => s.orderRefId)))
  const byId = new Map(orders.map((o) => [o.id, o]))
  const cancelledPaid: string[] = []
  const newlyPaid: typeof orders = []
  for (const s of states) {
    const order = byId.get(s.orderRefId)
    if (!order) continue
    if (s.paymentStatus !== "pending" && s.paymentStatus !== "failed") continue
    await updateState(tx, s.orderRefId, { paymentStatus: "paid", paymentId: input.paymentId, paidAt: input.paidAt, paymentFailedReason: null })
    if (s.fulfilmentStatus === "cancelled" || order.status === "cancelled") {
      await setMerchantStatus(tx, order.id, "cancelled", true)
      cancelledPaid.push(order.id)
    } else {
      await setMerchantStatus(tx, order.id, "paid", true)
      newlyPaid.push(order)
    }
    await addEvent(tx, order.id, "payment.captured", { kind: "provider", id: null }, { paymentId: input.paymentId, totalMinor: s.totalMinor, currency: s.currency })
    await announce(order, "paid")
  }

  if (newlyPaid.length) {
    const who = await customerEmail(tx, newlyPaid[0].customerId)
    if (who?.email) {
      const total = newlyPaid.reduce((s, o) => s + o.totalMinor, 0)
      const brands: string[] = []
      for (const o of newlyPaid) brands.push(await brandName(tx, o.brandId))
      await enqueueEmail(tx, {
        template: "order_confirmation",
        to: who.email,
        vars: { name: who.name, url: newlyPaid.length === 1 ? orderUrl(newlyPaid[0].id) : orderUrl(), reference: newlyPaid[0].reference.replace(/-\d+$/, ""), orders: newlyPaid.length, brands: brands.join(", "), total: money(total, newlyPaid[0].currency), totalMinor: total, currency: newlyPaid[0].currency },
        dedupeKey: `order-confirmation:${input.checkoutId}`,
      })
    }
  }

  if (cancelledPaid.length) {
    for (const id of cancelledPaid) {
      afterCommit(async () => {
        await withTx((t) => refundCancelledPaidOrder(t, id)).catch((e) => log.error(`[yard] orders: refund of cancelled order ${id} failed (the sweep job retries)`, e))
      })
    }
  }
  return { orderIds: states.map((s) => s.orderRefId) }
}

/**
 * ORDERS contract: the checkout's payment failed or was abandoned. Unpaid orders are cancelled
 * (payment failed); paid ones are never touched. CHECKOUT releases the stock hold. Idempotent.
 */
export async function markCheckoutPaymentFailed(tx: Tx, input: { checkoutId: string; reason: string }): Promise<void> {
  assertAmbientTx("markCheckoutPaymentFailed")
  const states = await tx
    .select()
    .from(orderStates)
    .where(and(eq(orderStates.checkoutId, input.checkoutId), eq(orderStates.paymentStatus, "pending")))
    .for("update")
  if (!states.length) return
  const orders = await tx.select().from(orderRefs).where(inArray(orderRefs.id, states.map((s) => s.orderRefId)))
  const now = new Date()
  const reason = input.reason.slice(0, 200)
  for (const o of orders) {
    const st = states.find((x) => x.orderRefId === o.id)
    const already = st?.fulfilmentStatus === "cancelled"
    await updateState(tx, o.id, {
      paymentStatus: "failed",
      paymentFailedReason: reason,
      stockReleased: true,
      ...(already ? {} : { fulfilmentStatus: "cancelled", cancelledAt: now, cancelledBy: "system", cancelReason: "Payment didn't go through." }),
    })
    await setMerchantStatus(tx, o.id, "cancelled", false)
    await addEvent(tx, o.id, "payment.failed", { kind: "provider", id: null }, { reason: reason.replace(/[^\w .,:-]/g, "").slice(0, 80) })
    await announce(o, "payment_failed")
  }
}

/** ORDERS contract: what PAYMENTS and LEDGER need to move money for one order. */
export async function getOrderForMoney(
  tx: Tx,
  orderId: string,
): Promise<{ orderId: string; brandId: string; customerId: string; currency: string; totalMinor: number; paymentId: string | null; status: string } | null> {
  const [row] = await tx
    .select({ orderId: orderRefs.id, brandId: orderRefs.brandId, customerId: orderRefs.customerId, currency: orderRefs.currency, totalMinor: orderRefs.totalMinor, merchant: orderRefs.status, paymentId: orderStates.paymentId, payment: orderStates.paymentStatus })
    .from(orderRefs)
    .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
    .where(eq(orderRefs.id, orderId))
    .limit(1)
  if (!row) return null
  // `status` is the payment state (pending|paid|failed|partially_refunded|refunded); legacy orders without a state row read from the merchant status.
  const status = row.payment ?? (row.merchant === "refunded" ? "refunded" : row.merchant === "pending_payment" ? "pending" : "paid")
  return { orderId: row.orderId, brandId: row.brandId, customerId: row.customerId, currency: row.currency, totalMinor: row.totalMinor, paymentId: row.paymentId ?? null, status }
}

