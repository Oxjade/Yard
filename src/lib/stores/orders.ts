"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { ApiError, api } from "@/lib/api/client"
import type { DemoSignInResult } from "@/lib/api/contracts/session"
import type { QuoteGroupDto, RegisterOrderBody, RegisterResponse } from "@/lib/api/contracts/shipping"
import { registerOrders } from "@/lib/api/shipping"
import { brandById } from "@/lib/data/brands"
import { convert, formatMoney } from "@/lib/money"
import { priceCart, type ShippingService } from "@/lib/cart"
import { afterIdentityChange } from "@/lib/session/identity"
import { DEMO_SHOPPER } from "./session"
import { customerCheckoutGroups, customerOrders, sampleReturnRequest } from "@/lib/data/orders"
import { variantLabel } from "@/lib/data/products"
import type { CheckoutGroup, MerchantOrder, ReturnDecision } from "@/lib/data/types"
import { returnRefund } from "@/lib/payouts"
import type { CartLine } from "./cart"
import { useAdmin } from "./admin"
import { currentReferences, renameTimeline } from "./old-name"
import { refreshSampleOrder } from "./sample-refresh"
import { useStudio } from "./studio"

/**
 * The shopper's orders. `placeCheckout` registers the checkout with the server first
 * (POST /api/orders/register, §6.5): the server re-checks every brand's shipping quote and mints
 * the group id, order ids and references, which the local orders then use. Only after that are
 * the orders created in this browser. Orders are created unpaid ("pending_payment") and only a
 * verified provider webhook may mark them paid; there is no provider in this build, so they stay
 * unpaid. The checkout's idempotency key makes a retry return the same server group.
 */

export type CheckoutInput = {
  idempotencyKey: string
  lines: CartLine[]
  currency: CurrencyCode
  shipTo: CountryCode
  /** The delivery city (matches a brand's pickup point; never a street address). */
  shipToCity?: string | null
  contact: { name: string; email: string; phone?: string }
  address: { line1: string; city: string; postcode?: string; country: CountryCode }
  /** brandId → the shipping service chosen. */
  shipping: Record<string, ShippingService>
  /** The server's quote per brand (its signed token goes with the order). */
  quotes: Record<string, QuoteGroupDto>
  paymentMethod: "card" | "bank_transfer" | "ussd" | "mobile_money"
  /** What the receipt says about payment: words only, never the card number, expiry or code. */
  payment: { label: string; holder?: string; cardBrand?: string; last4?: string }
}

/** Why a checkout wasn't placed. Nothing is created locally in any of these cases. */
export class CheckoutError extends Error {
  constructor(
    public kind: "signin" | "changed" | "network" | "blocked" | "other",
    message: string,
  ) {
    super(message)
    this.name = "CheckoutError"
  }
}

/** Restores the demo shopper session (as SessionSync does) when the server lost it. */
async function restoreShopperSession() {
  await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "shopper", account: DEMO_SHOPPER } })
  await afterIdentityChange("market")
}

/** Registers the checkout; on 401 restores the session once and retries once (§6.5). */
async function register(body: RegisterOrderBody): Promise<RegisterResponse> {
  try {
    return await registerOrders(body)
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e
  }
  try {
    await restoreShopperSession()
    return await registerOrders(body)
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === "suspended" || e.status === 404)) throw new CheckoutError("signin", "Sign in again to place your order. Nothing was placed.")
    throw e
  }
}

const methodWord: Record<CheckoutInput["paymentMethod"], string> = { card: "Card", bank_transfer: "Bank transfer", ussd: "USSD", mobile_money: "Mobile money" }
const serviceLabel = (service: ShippingService, pickupArea?: string) => (service === "express" ? "Express" : service === "pickup" ? `Pickup${pickupArea ? `, ${pickupArea}` : ""}` : "Standard")

type OrdersState = {
  groups: CheckoutGroup[]
  orders: MerchantOrder[]
  processedKeys: Record<string, string>
  /** Throws CheckoutError (or an ApiError) when nothing was placed. */
  placeCheckout: (input: CheckoutInput) => Promise<{ groupId: string; duplicate: boolean }>
  /**
   * A return request on a delivered order. It lands on the brand's order in Studio and in the
   * admin refund queue (in the backend phase: one row both read). Returns false when the order
   * can't take a request (not delivered, or already requested).
   */
  requestReturn: (orderId: string, request: { reason: string; reasonLabel: string; note?: string; variantIds: string[] }) => boolean
}

const sampleOrderById = new Map(customerOrders.map((o) => [o.id, o]))

export const useOrders = create<OrdersState>()(
  persist(
    (set, get) => ({
      groups: customerCheckoutGroups,
      orders: customerOrders,
      processedKeys: {},
      placeCheckout: async (input) => {
        const existing = get().processedKeys[input.idempotencyKey]
        if (existing) return { groupId: existing, duplicate: true }
        const bag = priceCart(input.lines, input.shipTo, input.currency, input.quotes, (b) => input.shipping[b])
        const blocked = bag.groups.find((g) => !g.quote || !g.option)
        if (blocked) throw new CheckoutError("blocked", blocked.reason ? `${blocked.reason.replace(/\.$/, "")} for ${blocked.brand.name}. Nothing was placed.` : `Shipping for ${blocked.brand.name} isn't ready. Nothing was placed.`)
        const body: RegisterOrderBody = {
          idempotencyKey: input.idempotencyKey,
          currency: input.currency,
          shipTo: { country: input.shipTo, ...(input.shipToCity ? { city: input.shipToCity } : {}) },
          groups: bag.groups.map((g) => ({ lines: g.lines.map((l) => ({ productId: l.product.id, variantId: l.variant.id, qty: l.line.quantity })), service: g.option!.service, quoteToken: g.quote!.quoteToken })),
        }
        let res: RegisterResponse
        try {
          res = await register(body)
        } catch (e) {
          if (e instanceof CheckoutError) throw e
          if (e instanceof ApiError && e.status === 409) throw new CheckoutError("changed", e.message)
          if (e instanceof ApiError && e.status === 0) throw new CheckoutError("network", "Couldn't reach Yard. Nothing was placed.")
          throw new CheckoutError("other", e instanceof ApiError && e.message ? `${e.message.replace(/\.$/, "")}. Nothing was placed.` : "Your order wasn't placed. Nothing was charged. Try again.")
        }
        // A retry in another tab may already have created this group here.
        if (get().groups.some((x) => x.id === res.groupId)) {
          set({ processedKeys: { ...get().processedKeys, [input.idempotencyKey]: res.groupId } })
          return { groupId: res.groupId, duplicate: true }
        }
        const at = res.placedAt
        const orders: MerchantOrder[] = res.orders.map((r) => {
          const g = bag.groups.find((x) => x.brand.id === r.brandId)!
          return {
            id: r.id,
            reference: r.reference,
            groupId: res.groupId,
            brandId: r.brandId,
            customerId: res.customerId,
            // Never "paid" until the payment provider confirms it server-side.
            status: "pending_payment",
            paymentStatus: "pending",
            currency: input.currency,
            lines: g.lines.map((l) => ({ productId: l.product.id, variantId: l.variant.id, name: l.product.name, variantLabel: variantLabel(l.variant.options), image: l.product.images[0], quantity: l.line.quantity, unitPrice: l.unit })),
            subtotal: r.subtotal,
            shipping: r.shipping,
            tax: 0,
            total: r.total,
            commission: Math.round(r.subtotal * 0.05),
            placedAt: at,
            shippingAddress: { name: input.contact.name, line1: input.address.line1, city: input.address.city, country: input.address.country, postcode: input.address.postcode, phone: input.contact.phone },
            shippingMethod: serviceLabel(r.service, g.option?.pickup?.area),
            delivery: { ...r.delivery, service: r.service },
            timeline: [
              { at, label: "Order placed" },
              { at, label: "Waiting for the payment provider to confirm. No provider is connected in this development build, so this order stays unpaid." },
            ],
          }
        })
        // Words only: the method, the summary the shopper saw ("Visa ending 4242") and the name on it.
        const payment = { status: "not_charged" as const, method: methodWord[input.paymentMethod], note: input.payment.label, label: input.payment.label, holder: input.payment.holder, cardBrand: input.payment.cardBrand, last4: input.payment.last4 }
        const group: CheckoutGroup = { id: res.groupId, reference: res.reference, customerId: res.customerId, placedAt: at, currency: input.currency, orderIds: orders.map((o) => o.id), total: orders.reduce((s, o) => s + o.total, 0), payment }
        set({ groups: [group, ...get().groups], orders: [...orders, ...get().orders], processedKeys: { ...get().processedKeys, [input.idempotencyKey]: res.groupId } })
        // The merchant sees their order immediately (the server holds the same order_ref).
        const studio = useStudio.getState()
        const mine = orders.filter((o) => o.brandId === studio.brandId)
        if (mine.length) useStudio.setState({ orders: [...mine, ...studio.orders] })
        return { groupId: res.groupId, duplicate: res.duplicate }
      },
      requestReturn: (orderId, request) => {
        const o = get().orders.find((x) => x.id === orderId)
        if (!o || o.status !== "delivered" || o.returnRequest) return false
        const at = new Date().toISOString()
        const returnRequest = { at, ...request }
        const entry = { at, label: `Return requested: ${request.reasonLabel.toLowerCase()}` }
        const next: MerchantOrder = { ...o, status: "refund_requested", returnRequest, timeline: [...o.timeline, entry] }
        set({ orders: get().orders.map((x) => (x.id === orderId ? next : x)) })

        const studio = useStudio.getState()
        if (o.brandId === studio.brandId) {
          const known = studio.orders.some((x) => x.id === orderId)
          useStudio.setState({
            orders: known ? studio.orders.map((x) => (x.id === orderId ? { ...x, status: "refund_requested", returnRequest, timeline: [...x.timeline, entry] } : x)) : [next, ...studio.orders],
          })
        }

        // The same refund the brand sees: the returned items, or what was paid when it's everything.
        const amount = returnRefund(o, request.variantIds).amount
        const admin = useAdmin.getState()
        const id = `rf_${orderId}`
        useAdmin.setState({
          refunds: [
            { id, reference: o.reference, brandName: brandById.get(o.brandId)?.name ?? "Brand", customer: o.shippingAddress.name, amountUsd: convert(amount, o.currency, "USD"), reason: request.reasonLabel, requestedAt: at, status: "requested", idempotencyKey: `rfnd_${orderId}` },
            ...admin.refunds.filter((r) => r.id !== id),
          ],
        })
        return true
      },
    }),
    {
      name: "nocturne-orders",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 2,
      // v1: decisions saved on an order's timeline before the platform was renamed read its
      // current name ("approved by Yard").
      // v2: checkout references read the current prefix ("YRD-…", was "NCT-…"), and the sample
      // orders take the corrected sample data (see refreshSampleOrder), their checkouts its totals.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<OrdersState>
        const next = { ...p }
        if (p.orders) {
          const named = p.orders.map(renameTimeline)
          next.orders = version < 2 ? named.map((o) => refreshSampleOrder(o, sampleOrderById.get(o.id))) : named
        }
        if (p.groups && version < 2) {
          next.groups = p.groups.map((g) => {
            const sample = customerCheckoutGroups.find((x) => x.id === g.id)
            if (!sample) return { ...g, reference: currentReferences(g.reference) }
            const orders = (next.orders ?? []).filter((o) => g.orderIds.includes(o.id))
            return { ...g, reference: sample.reference, total: orders.length ? orders.reduce((s, o) => s + convert(o.total, o.currency, g.currency), 0) : sample.total }
          })
        }
        return next as OrdersState
      },
    },
  ),
)

/* ---------- Decisions on return requests ---------- */

export type ReturnDecisionInput = {
  status: "approved" | "declined"
  /** A decline's reason, shown to the shopper. An approval's reason stays with whoever recorded it. */
  reason?: string
  by: ReturnDecision["by"]
  /** For a platform decision: the audit entry it wrote. */
  ref?: string
}

/**
 * Records a decision on a return request on every copy of the order: the brand's (Studio), the
 * shopper's, and, for the brand's own decisions, the platform's refund queue (a platform decision
 * is made there, by setRefundStatus). In the backend phase this is one server action on one row.
 *
 * An approval is recorded, never sent: no payment provider is connected in this build. Returning
 * part of an order keeps it delivered with payment "partially_refunded" and the refund on the
 * order; returning all of it marks it refunded. A decline puts it back to delivered with the
 * reason. Returns the decided order, or null when no copy is waiting for a decision.
 */
export function applyReturnDecision(orderId: string, input: ReturnDecisionInput): MerchantOrder | null {
  const studio = useStudio.getState()
  const theirs = useOrders.getState().orders.find((x) => x.id === orderId)
  const brands = studio.orders.find((x) => x.id === orderId)
  const waiting = (o?: MerchantOrder) => (o?.status === "refund_requested" ? o : undefined)
  const base = waiting(theirs) ?? waiting(brands)
  if (!base) return null

  const at = new Date().toISOString()
  const brandName = brandById.get(base.brandId)?.name ?? "The brand"
  const who = input.by === "brand" ? brandName : site.name
  // A sample order that came with a return requested has no request record: it gets the one
  // Studio and Finance show for it (the whole order), so the decision is recorded like any other.
  const request = base.returnRequest ?? sampleReturnRequest(base)
  const refund = returnRefund(base, request.variantIds)
  const approved = input.status === "approved"
  const reason = input.reason?.trim().replace(/\.$/, "")
  const decision: ReturnDecision = approved
    ? { status: "approved", at, by: input.by, amount: refund.amount, partial: refund.partial, ref: input.ref }
    : { status: "declined", at, by: input.by, reason: reason || undefined, ref: input.ref }
  const items = refund.units === 1 ? "1 item" : `${refund.units} items`
  const label = approved
    ? `${refund.partial ? "Partial refund" : "Refund"} of ${formatMoney(refund.amount, base.currency)} approved by ${who}${refund.partial ? ` for ${items}` : ""}. Recorded; not sent, as no payment provider is connected`
    : `Return declined by ${who}${reason ? `: ${reason}` : ""}`

  const decide = (o: MerchantOrder): MerchantOrder => {
    const taken = o.paymentStatus === "captured" || o.paymentStatus === "authorized" || o.paymentStatus === "partially_refunded"
    const returnRequest = { ...(o.returnRequest ?? request), decision }
    const timeline = [...o.timeline, { at, label }]
    if (!approved) return { ...o, status: "delivered", returnRequest, timeline }
    const recorded = { amount: refund.amount, variantIds: refund.variantIds, at }
    if (refund.partial) return { ...o, status: "delivered", paymentStatus: taken ? "partially_refunded" : o.paymentStatus, returnRequest, refund: recorded, timeline }
    return { ...o, status: "refunded", paymentStatus: taken ? "refunded" : o.paymentStatus, returnRequest, refund: recorded, timeline }
  }

  // The shopper's copy first, then the brand's: the brand's store events copy its order onto the
  // shopper's, which is then already in step.
  let decided: MerchantOrder | null = null
  if (waiting(theirs)) {
    decided = decide(theirs!)
    useOrders.setState({ orders: useOrders.getState().orders.map((x) => (x.id === orderId ? decided! : x)) })
  }
  if (waiting(brands)) {
    const next = decide(brands!)
    decided ??= next
    useStudio.setState({ orders: useStudio.getState().orders.map((x) => (x.id === orderId ? next : x)) })
  }

  // The brand's decision reaches the platform's refund queue (no admin audit entry in the brand's name).
  if (input.by === "brand") {
    const id = `rf_${orderId}`
    const admin = useAdmin.getState()
    if (admin.refunds.some((r) => r.id === id && r.status === "requested")) useAdmin.setState({ refunds: admin.refunds.map((r) => (r.id === id ? { ...r, status: input.status } : r)) })
  }
  return decided
}
