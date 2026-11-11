"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { ApiError, api } from "@/lib/api/client"
import type { CheckoutOrderSummary, CheckoutOrdersPage, CheckoutStartResponse, StartCheckoutRequest } from "@/lib/api/contracts/checkout"
import type { OrderDetailDto } from "@/lib/api/contracts/orders"
import type { DemoSignInResult } from "@/lib/api/contracts/session"
import type { QuoteGroupDto } from "@/lib/api/contracts/shipping"
import { brandById } from "@/lib/data/brands"
import { convert, formatMoney } from "@/lib/money"
import { priceCart, type ShippingService } from "@/lib/cart"
import { afterIdentityChange } from "@/lib/session/identity"
import { DEMO_SHOPPER } from "./session"
import { customerCheckoutGroups, customerOrders, sampleReturnRequest } from "@/lib/data/orders"
import { variantLabel } from "@/lib/data/products"
import type { CheckoutGroup, DeliverySnapshot, MerchantOrder, MerchantOrderStatus, PaymentStatus, ReturnDecision } from "@/lib/data/types"
import { returnRefund } from "@/lib/payouts"
import { useCart, type CartLine } from "./cart"
import { useSession } from "./session"
import { useAdmin } from "./admin"
import { currentReferences, renameTimeline } from "./old-name"
import { refreshSampleOrder } from "./sample-refresh"
import { useStudio } from "./studio"

/**
 * Shopper order presentation is persisted locally, but placement, stock holds, payment state and
 * order identity come from the server checkout. The idempotency key makes retries safe.
 *
 * Only the demo shopper's orders (and the sample history) are written to this browser's storage.
 * A real account's checkouts, with their address and phone, stay in memory for the visit and are
 * read back from the server (GET /api/checkout/{id}, /api/orders…) everywhere else; they are
 * dropped whenever the signed-in shopper changes (scopeTo).
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
  /** What the receipt says about payment: words only. Card details are typed on Paystack's page, never here. */
  payment: { label: string; holder?: string }
}

/**
 * Why a checkout didn't finish here. Nothing is created locally in any of these cases. "started":
 * the server created the checkout (`checkoutId`), but its orders couldn't be loaded; a retry with
 * the same idempotency key picks the same checkout up.
 */
export class CheckoutError extends Error {
  constructor(
    public kind: "signin" | "changed" | "network" | "blocked" | "started" | "other",
    message: string,
    public checkoutId?: string,
  ) {
    super(message)
    this.name = "CheckoutError"
  }
}

/** Restores the shared demo session when its server cookie expires. */
async function restoreShopperSession() {
  await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "shopper", account: DEMO_SHOPPER } })
  await afterIdentityChange("market")
}

/** Makes a shopper API request; only demo identities may recover by restoring the demo session. */
async function shopperRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e
  }
  if (useSession.getState().user?.id !== DEMO_SHOPPER) throw new CheckoutError("signin", "Your session ended. Sign in again to continue with your order.")
  try {
    await restoreShopperSession()
    return await request()
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === "suspended" || e.status === 404)) throw new CheckoutError("signin", "Sign in again to continue with your order.")
    throw e
  }
}

function merchantStatus(value: string): MerchantOrderStatus {
  const statuses: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
  return statuses.includes(value as MerchantOrderStatus) ? value as MerchantOrderStatus : "pending_payment"
}

function paymentStatus(value: string): PaymentStatus {
  if (value === "paid") return "captured"
  const statuses: PaymentStatus[] = ["pending", "authorized", "captured", "failed", "refunded", "partially_refunded"]
  return statuses.includes(value as PaymentStatus) ? value as PaymentStatus : "pending"
}

/** True for checkouts kept in this browser's storage: the demo shopper's (and the sample history). */
const persistable = (customerId: string) => customerId === DEMO_SHOPPER

/** The provider's channel as the receipt's words ("card" → "Card"). */
const channelWord: Record<string, string> = { card: "Card", bank_transfer: "Bank transfer", bank: "Bank transfer", eft: "Instant EFT", ussd: "USSD", mobile_money: "Mobile money", qr: "QR code" }

function paymentSnapshot(checkout: CheckoutStartResponse, previous?: CheckoutGroup["payment"]): NonNullable<CheckoutGroup["payment"]> {
  const channel = checkout.payment?.channel ? channelWord[checkout.payment.channel] : undefined
  return {
    ...previous,
    ...(channel ? { method: channel } : {}),
    status: checkout.status === "paid" ? "captured" : checkout.status === "failed" || checkout.status === "expired" ? "failed" : checkout.payment?.stub ? "not_charged" : "pending",
    note: checkout.failureReason ?? checkout.payment?.message ?? previous?.note ?? undefined,
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET with a couple of quick retries (network or server errors only). */
async function getWithRetry<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await shopperRequest(() => api<T>(path))
    } catch (e) {
      const transient = e instanceof ApiError && (e.status === 0 || e.status >= 500)
      if (!transient || attempt >= 2) throw e
      await wait(600 * 2 ** attempt)
    }
  }
}

/** A checkout as the server has it now, whether or not this browser placed it. */
export type ServerCheckout = { checkout: CheckoutStartResponse; group: CheckoutGroup; orders: MerchantOrder[]; holder: string | null }

/**
 * Builds a checkout's confirmation from the server alone (another browser or device, cleared
 * storage, or a real account whose orders aren't kept here): the checkout view, its orders and
 * each order's lines. `verify` asks the payment provider first (the payment return page).
 */
export async function loadServerCheckout(checkoutId: string, opts: { verify?: boolean } = {}): Promise<ServerCheckout> {
  const id = encodeURIComponent(checkoutId)
  const checkout = opts.verify
    ? await shopperRequest(() => api<CheckoutStartResponse>(`/api/checkout/${id}/verify`, { method: "POST" }))
    : await getWithRetry<CheckoutStartResponse>(`/api/checkout/${id}`)
  const page = await getWithRetry<CheckoutOrdersPage>(`/api/orders/checkouts/${id}`)
  const details = await Promise.all(page.items.map((summary) => getWithRetry<{ order: OrderDetailDto }>(`/api/orders/${encodeURIComponent(summary.id)}`).then((r) => r.order)))
  const customerId = useSession.getState().user?.id ?? ""
  const orders: MerchantOrder[] = details.map((d) => {
    const shipTo = (d.shipTo ?? {}) as Record<string, unknown>
    const text = (v: unknown) => (typeof v === "string" ? v : "")
    const service = (["standard", "express", "pickup"] as string[]).includes(d.service) ? d.service as ShippingService : "standard"
    return {
      id: d.id,
      reference: d.reference,
      groupId: checkout.id,
      brandId: d.brand.id,
      brand: { name: d.brand.name, handle: d.brand.handle },
      customerId,
      status: merchantStatus(d.states.merchant),
      paymentStatus: paymentStatus(d.states.payment),
      currency: d.currency as CurrencyCode,
      lines: d.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, name: l.title, variantLabel: l.variantLabel, image: l.image, quantity: l.qty, unitPrice: l.unitMinor })),
      subtotal: d.subtotalMinor,
      shipping: d.shippingMinor,
      tax: 0,
      total: d.totalMinor,
      commission: 0,
      placedAt: d.placedAt,
      // Only what the confirmation shows (city and country): the full address stays on the server.
      shippingAddress: { name: d.customerName, line1: "", city: text(shipTo.city) || d.shipToPreview.city || "", country: (text(shipTo.country) || d.shipToPreview.country) as CountryCode },
      shippingMethod: serviceLabel(service),
      timeline: [],
      paidAt: d.paidAt ?? undefined,
      deliveredAt: d.deliveredAt ?? undefined,
    }
  })
  const group: CheckoutGroup = {
    id: checkout.id,
    reference: checkout.reference ?? page.items[0]?.groupReference ?? checkout.id,
    customerId,
    placedAt: checkout.createdAt,
    currency: checkout.currency as CurrencyCode,
    orderIds: orders.map((o) => o.id),
    total: checkout.totalMinor,
    payment: paymentSnapshot(checkout),
  }
  useOrders.getState().applyServerCheckout(checkout, page.items)
  return { checkout, group, orders, holder: details[0]?.customerName ?? null }
}

const methodWord: Record<CheckoutInput["paymentMethod"], string> = { card: "Card", bank_transfer: "Bank transfer", ussd: "USSD", mobile_money: "Mobile money" }
const serviceLabel = (service: ShippingService, pickupArea?: string) => (service === "express" ? "Express" : service === "pickup" ? `Pickup${pickupArea ? `, ${pickupArea}` : ""}` : "Standard")

type OrdersState = {
  groups: CheckoutGroup[]
  orders: MerchantOrder[]
  processedKeys: Record<string, string>
  /** Throws CheckoutError (or an ApiError) when nothing was placed. */
  placeCheckout: (input: CheckoutInput) => Promise<{ groupId: string; duplicate: boolean; authorizationUrl: string | null }>
  /** Asks the payment provider (POST …/verify), updates this browser's copy and returns the checkout. */
  verifyCheckout: (checkoutId: string) => Promise<CheckoutStartResponse>
  /** Re-reads the checkout (GET), updates this browser's copy and returns it. */
  refreshCheckout: (checkoutId: string) => Promise<CheckoutStartResponse>
  /** Brings this browser's copy of a checkout (when it holds one) in step with the server's. */
  applyServerCheckout: (checkout: CheckoutStartResponse, summaries: CheckoutOrderSummary[]) => void
  /**
   * Keeps only what the shopper now signed in may see: the demo shopper's checkouts (kept in this
   * browser) and the current account's from this visit. Others' are dropped here and from the
   * Studio copy.
   */
  scopeTo: (shopperId: string | null) => void
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
        if (existing) return { groupId: existing, duplicate: true, authorizationUrl: null }
        const bag = priceCart(input.lines, input.shipTo, input.currency, input.quotes, (b) => input.shipping[b])
        const blocked = bag.groups.find((g) => !g.quote || !g.option)
        if (blocked) throw new CheckoutError("blocked", blocked.reason ? `${blocked.reason.replace(/\.$/, "")} for ${blocked.brand.name}. Nothing was placed.` : `Shipping for ${blocked.brand.name} isn't ready. Nothing was placed.`)
        const body: StartCheckoutRequest = {
          idempotencyKey: input.idempotencyKey,
          currency: input.currency,
          shipTo: {
            name: input.contact.name.trim(),
            line1: input.address.line1,
            city: input.address.city,
            country: input.address.country,
            ...(input.address.postcode ? { postalCode: input.address.postcode } : {}),
            ...(input.contact.phone ? { phone: input.contact.phone } : {}),
          },
          shipping: bag.groups.map((g) => ({ brandId: g.brand.id, service: g.option!.service })),
          expectedTotalMinor: bag.total ?? undefined,
          paymentMethod: input.paymentMethod,
        }
        let checkout: CheckoutStartResponse
        let orderPage: CheckoutOrdersPage
        try {
          checkout = await shopperRequest(() => api<CheckoutStartResponse>("/api/checkout", { body }))
        } catch (e) {
          if (e instanceof CheckoutError) throw e
          if (e instanceof ApiError && e.status === 409) throw new CheckoutError("changed", e.message)
          // The server's cart has brands this bag doesn't show (another device, an account merge).
          if (e instanceof ApiError && e.status === 400 && Object.keys(e.fields ?? {}).some((k) => k.startsWith("shipping."))) {
            throw new CheckoutError("changed", "Your cart changed since you last looked. Check it and place your order again.")
          }
          if (e instanceof ApiError && e.status === 0) throw new CheckoutError("network", "Couldn't reach Yard. Nothing was placed.")
          throw new CheckoutError("other", e instanceof ApiError && e.message ? `${e.message.replace(/\.$/, "")}. Nothing was placed.` : "Your order wasn't placed. Nothing was charged. Try again.")
        }
        // From here the checkout exists on the server: never say "nothing was placed".
        const started = "Your order was started, but Yard couldn't load it yet. Retry to pick up the same checkout: nothing is placed twice."
        try {
          orderPage = await getWithRetry<CheckoutOrdersPage>(`/api/orders/checkouts/${encodeURIComponent(checkout.id)}`)
        } catch (e) {
          if (e instanceof CheckoutError && e.kind === "signin") throw e
          throw new CheckoutError("started", started, checkout.id)
        }
        if (!orderPage.items.length) throw new CheckoutError("started", started, checkout.id)
        // A retry that reached the same checkout (another tab already recorded it): keep one copy.
        if (get().groups.some((g) => g.id === checkout.id)) {
          set({ processedKeys: { ...get().processedKeys, [input.idempotencyKey]: checkout.id } })
          return { groupId: checkout.id, duplicate: true, authorizationUrl: checkout.payment?.authorizationUrl ?? null }
        }
        const customerId = useSession.getState().user?.id ?? DEMO_SHOPPER
        const orders: MerchantOrder[] = orderPage.items.map((summary: CheckoutOrderSummary) => {
          const g = bag.groups.find((x) => x.brand.id === summary.brand.id)
          if (!g) throw new CheckoutError("other", "The server returned an order for a brand that isn't in this cart.")
          const service = (["standard", "express", "pickup"] as string[]).includes(summary.service) ? summary.service as ShippingService : g.option!.service
          const estimate = g.quote?.options.find((o) => o.service === service)?.estimate
          const delivery: DeliverySnapshot | undefined = estimate ? {
            basis: estimate.basis,
            dispatchFrom: estimate.dispatchFrom,
            shipBy: estimate.shipBy,
            arrivalFrom: estimate.arrivalFrom,
            arrivalTo: estimate.arrivalTo,
            deliveredOn: estimate.deliveredOn,
            late: estimate.late,
            guaranteed: false,
            service,
            source: "server",
            computedAt: checkout.createdAt,
          } : undefined
          return {
            id: summary.id,
            reference: summary.reference,
            groupId: checkout.id,
            brandId: summary.brand.id,
            brand: { name: summary.brand.name, handle: summary.brand.handle },
            customerId,
            status: merchantStatus(summary.states.merchant),
            paymentStatus: paymentStatus(summary.states.payment),
            currency: summary.currency as CurrencyCode,
            lines: g.lines.map((l) => ({ productId: l.product.id, variantId: l.variant.id, name: l.product.name, variantLabel: variantLabel(l.variant.options), image: l.product.images[0], quantity: l.line.quantity, unitPrice: l.unit })),
            subtotal: summary.subtotalMinor,
            shipping: summary.shippingMinor,
            tax: 0,
            total: summary.totalMinor,
            commission: Math.round(summary.subtotalMinor * 0.05),
            placedAt: summary.placedAt,
            shippingAddress: { name: input.contact.name, line1: input.address.line1, city: input.address.city, country: input.address.country, postcode: input.address.postcode, phone: input.contact.phone },
            shippingMethod: serviceLabel(service, g.option?.pickup?.area),
            delivery,
            timeline: [
              { at: summary.placedAt, label: "Order placed" },
              { at: summary.placedAt, label: checkout.payment?.stub ? "Payments are not connected in this environment. Nothing was charged." : "Waiting for the payment provider to confirm." },
            ],
          }
        })
        const payment = { ...paymentSnapshot(checkout), method: methodWord[input.paymentMethod] }
        const group: CheckoutGroup = {
          id: checkout.id,
          reference: checkout.reference ?? orderPage.items[0].groupReference,
          customerId,
          placedAt: checkout.createdAt,
          currency: checkout.currency as CurrencyCode,
          orderIds: checkout.orderIds,
          total: checkout.totalMinor,
          payment,
        }
        set({ groups: [group, ...get().groups], orders: [...orders, ...get().orders], processedKeys: { ...get().processedKeys, [input.idempotencyKey]: checkout.id } })
        // The demo brand sees the demo shopper's order immediately (the server holds the same
        // order_ref). A real account's order reaches Studio from the server only.
        const studio = useStudio.getState()
        const mine = persistable(customerId) ? orders.filter((o) => o.brandId === studio.brandId && !studio.orders.some((x) => x.id === o.id)) : []
        if (mine.length) useStudio.setState({ orders: [...mine, ...studio.orders] })
        return { groupId: checkout.id, duplicate: false, authorizationUrl: checkout.payment?.authorizationUrl ?? null }
      },
      verifyCheckout: async (checkoutId) => {
        const checkout = await shopperRequest(() => api<CheckoutStartResponse>(`/api/checkout/${encodeURIComponent(checkoutId)}/verify`, { method: "POST" }))
        const page = await getWithRetry<CheckoutOrdersPage>(`/api/orders/checkouts/${encodeURIComponent(checkoutId)}`)
        get().applyServerCheckout(checkout, page.items)
        await useCart.getState().syncFromServer()
        return checkout
      },
      refreshCheckout: async (checkoutId) => {
        const checkout = await getWithRetry<CheckoutStartResponse>(`/api/checkout/${encodeURIComponent(checkoutId)}`)
        if (get().groups.some((g) => g.id === checkoutId)) {
          const page = await getWithRetry<CheckoutOrdersPage>(`/api/orders/checkouts/${encodeURIComponent(checkoutId)}`)
          get().applyServerCheckout(checkout, page.items)
        }
        return checkout
      },
      applyServerCheckout: (checkout, summaries) => {
        const current = get()
        if (!current.groups.some((g) => g.id === checkout.id)) return
        const updates = new Map(summaries.map((summary) => [summary.id, summary]))
        const orders = current.orders.map((order) => {
          const summary = updates.get(order.id)
          if (!summary) return order
          return { ...order, status: merchantStatus(summary.states.merchant), paymentStatus: paymentStatus(summary.states.payment), subtotal: summary.subtotalMinor, shipping: summary.shippingMinor, total: summary.totalMinor }
        })
        const groups = current.groups.map((group) => group.id === checkout.id ? {
          ...group,
          reference: checkout.reference ?? group.reference,
          total: checkout.totalMinor,
          payment: paymentSnapshot(checkout, group.payment),
        } : group)
        set({ groups, orders })
      },
      scopeTo: (shopperId) => {
        const current = get()
        const keep = (customerId: string) => persistable(customerId) || (!!shopperId && customerId === shopperId)
        const dropped = new Set(current.orders.filter((o) => !keep(o.customerId)).map((o) => o.id))
        const groups = current.groups.filter((g) => keep(g.customerId))
        if (dropped.size || groups.length !== current.groups.length) set({ groups, orders: current.orders.filter((o) => !dropped.has(o.id)) })
        // Copies pushed to the demo brand's Studio by earlier builds.
        const studio = useStudio.getState()
        if (dropped.size && studio.orders.some((o) => dropped.has(o.id))) useStudio.setState({ orders: studio.orders.filter((o) => !dropped.has(o.id)) })
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
      // Only the demo shopper's checkouts are written here (see the note at the top).
      // A real account's checkout ids stay in memory only, like its orders (not left for the next sign-in).
      partialize: (s) => ({ groups: s.groups.filter((g) => persistable(g.customerId)), orders: s.orders.filter((o) => persistable(o.customerId)), processedKeys: Object.fromEntries(Object.entries(s.processedKeys).filter(([, id]) => s.groups.some((g) => g.id === id && persistable(g.customerId)))) }),
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
