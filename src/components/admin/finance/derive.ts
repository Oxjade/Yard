import { convert } from "@/lib/money"
import { disputes, transactions, type AuditEntry, type Dispute, type Payout, type Refund, type Transaction } from "@/lib/data/admin"
import { brandById, brands } from "@/lib/data/brands"
import { demoCustomer, merchantOrders, shoppers } from "@/lib/data/orders"
import { hash } from "@/lib/data/seed"
import type { Brand, CheckoutGroup, MerchantOrder } from "@/lib/data/types"
import type { AdjustmentRequest } from "@/lib/stores/admin"
import { DEMO_NOW, providerName } from "./format"
import type { DisputeStage, FulfilState, GroupState, Meta, PayState } from "./meta"
import { disputeMeta, refundMeta, txStatusMeta } from "./meta"

/**
 * Read-side derivations for the orders and finance screens. Everything here is a pure view
 * over the local data layer and the admin store; nothing writes. In the backend phase these
 * become queries over merchant_orders, ledger_transactions and provider_events.
 */

const DAY = 86_400_000

export type Provider = Transaction["provider"]

/** Same routing rule the data layer uses: the brand's market decides the payment provider. */
export function providerFor(brand: Pick<Brand, "country">): Provider {
  if (brand.country === "NG" || brand.country === "GH") return "paystack"
  if (brand.country === "KE" || brand.country === "ZA") return "flutterwave"
  return "stripe"
}

export type CustomerInfo = { name: string; email: string; city: string; country: string }

const shopperById = new Map(shoppers.map((s) => [s.id, s]))

export function customerOf(id: string): CustomerInfo {
  if (id === demoCustomer.id) return { name: demoCustomer.name, email: demoCustomer.email, city: demoCustomer.city, country: demoCustomer.country }
  return shopperById.get(id) ?? { name: "Guest customer", email: "No email on file", city: "", country: "" }
}

/** The order a finance record belongs to: tx_{orderId}, tx_{orderId}_r, tx_{orderId}_c, rf_{orderId}, dp_{orderId}. */
export function orderIdOf(recordId: string) {
  return recordId.replace(/^(tx|rf|dp)_/, "").replace(/_(r|c)$/, "")
}

const txByOrder = new Map<string, Transaction[]>()
for (const t of transactions) {
  const k = orderIdOf(t.id)
  txByOrder.set(k, [...(txByOrder.get(k) ?? []), t])
}
const seededDisputes = new Map(disputes.map((d) => [orderIdOf(d.id), d]))
const failedCharges = new Set(transactions.filter((t) => t.type === "charge" && t.status === "failed").map((t) => orderIdOf(t.id)))

export function groupReference(groupId: string, groups: CheckoutGroup[]) {
  const known = groups.find((g) => g.id === groupId)
  if (known) return known.reference
  const h = hash(groupId).toString(36).toUpperCase().padStart(6, "0")
  return `NCT-${h.slice(-4)}-${String(hash(`${groupId}-n`) % 100).padStart(2, "0")}`
}

/* ---------- Order axes (payment and fulfilment are shown separately) ---------- */

/** Where the parcel is, from the brand's order status alone. */
function shippingState(o: MerchantOrder): Exclude<FulfilState, "on_hold"> {
  switch (o.status) {
    case "processing":
      return "processing"
    case "shipped":
      return "shipped"
    case "delivered":
    case "refund_requested":
    case "refunded":
      return "delivered"
    case "cancelled":
      return "cancelled"
    default:
      return "unfulfilled"
  }
}

/** Payment states that stop a brand from shipping an order that hasn't left yet. */
const STOPS_SHIPPING: PayState[] = ["failed", "disputed", "charged_back"]

/**
 * Fulfilment as an operator should read it. An order that hasn't shipped is on hold while its
 * charge has failed or a dispute is open, so the row never says "Processing" next to
 * "Charge failed". Once a parcel has left, the shipping state stands.
 */
export function fulfilState(o: MerchantOrder, pay: PayState): FulfilState {
  const ship = shippingState(o)
  if ((ship === "unfulfilled" || ship === "processing") && STOPS_SHIPPING.includes(pay)) return "on_hold"
  return ship
}

export function payState(o: MerchantOrder, refund?: Refund, dispute?: Dispute): PayState {
  if (failedCharges.has(o.id)) return "failed"
  if (o.status === "pending_payment") return "pending"
  if (dispute?.stage === "lost") return "charged_back"
  if (dispute && (dispute.stage === "needs_evidence" || dispute.stage === "under_review")) return "disputed"
  if (o.paymentStatus === "refunded" || refund?.status === "issued") return "refunded"
  if (refund?.status === "approved") return "refund_approved"
  if (refund?.status === "requested") return "refund_requested"
  if (!refund && o.status === "refund_requested") return "refund_requested"
  return "paid"
}

/** The checkout's display status, derived from its brand orders (cancelled orders don't count). */
export function groupState(orders: MerchantOrder[]): GroupState {
  const live = orders.filter((o) => o.status !== "cancelled")
  if (!live.length) return "cancelled"
  if (live.every((o) => o.status === "refunded")) return "refunded"
  const delivered = (o: MerchantOrder) => ["delivered", "refund_requested", "refunded"].includes(o.status)
  const shipped = (o: MerchantOrder) => o.status === "shipped" || delivered(o)
  if (live.every(delivered)) return "delivered"
  if (live.every(shipped)) return "shipped"
  if (live.some(shipped)) return "partially_shipped"
  return "confirmed"
}

export type OrderRow = {
  order: MerchantOrder
  brand: Brand
  customer: CustomerInfo
  groupRef: string
  totalUsd: number
  pay: PayState
  fulfil: FulfilState
  refund?: Refund
  dispute?: Dispute
  /** How many brand orders the same checkout produced. */
  groupSize: number
  search: string
}

/**
 * Every merchant order on the platform: the seeded marketplace orders plus the ones the demo
 * shopper placed through checkout (which is where multi-brand checkouts come from). Newest first.
 */
export function buildOrderRows(clientOrders: MerchantOrder[], groups: CheckoutGroup[], refunds: Refund[], liveDisputes?: Dispute[]): OrderRow[] {
  const disputeByOrder = liveDisputes ? new Map(liveDisputes.map((d) => [orderIdOf(d.id), d])) : seededDisputes
  const seen = new Set<string>()
  const all = [...clientOrders, ...merchantOrders].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
  all.sort((a, b) => b.placedAt.localeCompare(a.placedAt))
  const refundByOrder = new Map(refunds.map((r) => [orderIdOf(r.id), r]))
  const size = new Map<string, number>()
  for (const o of all) size.set(o.groupId, (size.get(o.groupId) ?? 0) + 1)
  return all.flatMap((o) => {
    const brand = brandById.get(o.brandId)
    if (!brand) return []
    const customer = customerOf(o.customerId)
    const groupRef = groupReference(o.groupId, groups)
    const refund = refundByOrder.get(o.id)
    const dispute = disputeByOrder.get(o.id)
    const pay = payState(o, refund, dispute)
    return [
      {
        order: o,
        brand,
        customer,
        groupRef,
        totalUsd: convert(o.total, o.currency, "USD"),
        pay,
        fulfil: fulfilState(o, pay),
        refund,
        dispute,
        groupSize: size.get(o.groupId) ?? 1,
        search: [o.reference, groupRef, customer.name, customer.email, brand.name].join(" ").toLowerCase(),
      },
    ]
  })
}

/* ---------- Payment events for one order ---------- */

export type PaymentEvent = {
  id: string
  at: string
  label: string
  detail?: string
  provider: Provider
  /** Signed from the customer's side: money in is +, money back is −. */
  amountUsd: number
  status: Meta
  /** null when the event doesn't come from a provider webhook. */
  verified: boolean | null
}

const isOpenStage = (s: DisputeStage) => s === "needs_evidence" || s === "evidence_submitted" || s === "under_review"

export function paymentEvents(o: MerchantOrder, brand: Brand, refund?: Refund, dispute?: Dispute, stage?: DisputeStage): PaymentEvent[] {
  const provider = providerFor(brand)
  const shipped = o.status === "shipped" || o.status === "delivered" || o.status === "refund_requested" || o.status === "refunded"
  const usd = convert(o.total, o.currency, "USD")
  const commission = convert(o.commission, o.currency, "USD")
  const out: PaymentEvent[] = []
  const recorded = txByOrder.get(o.id)
  // A declined charge earns nothing: no commission is assessed on money that never arrived.
  const chargeFailed = failedCharges.has(o.id)

  if (recorded) {
    for (const t of recorded) {
      if (t.type === "charge") {
        out.push({
          id: t.id,
          at: t.at,
          label: t.status === "failed" ? "Charge failed" : "Charge captured",
          detail:
            t.status === "failed"
              ? `The provider declined the charge after checkout had created the brand order${t.webhookVerified ? "" : ", and its webhook wasn't verified, so nothing was posted to the ledger"}. Fulfilment is on hold: the brand doesn't ship until the customer pays.`
              : t.webhookVerified
                ? "Webhook signature checked and the amount confirmed with the provider's verify API."
                : "Webhook not verified, so nothing was posted to the ledger.",
          provider,
          amountUsd: t.amountUsd,
          status: txStatusMeta[t.status],
          verified: t.webhookVerified,
        })
      } else if (t.type === "commission") {
        if (chargeFailed) continue
        out.push({ id: t.id, at: t.at, label: "Commission assessed", detail: "5% of the item subtotal. Shipping passes through to the brand.", provider, amountUsd: t.amountUsd, status: txStatusMeta[t.status], verified: null })
      } else if (t.type === "refund") {
        out.push({ id: t.id, at: t.at, label: "Refund processed", detail: refund ? `Idempotency key ${refund.idempotencyKey}` : undefined, provider, amountUsd: t.amountUsd, status: txStatusMeta[t.status], verified: t.webhookVerified })
      }
    }
  } else if (o.status !== "pending_payment") {
    out.push({ id: `${o.id}-charge`, at: o.placedAt, label: "Charge captured", detail: "Webhook signature checked and the amount confirmed with the provider's verify API.", provider, amountUsd: usd, status: txStatusMeta.succeeded, verified: true })
    if (o.status !== "cancelled") out.push({ id: `${o.id}-commission`, at: o.placedAt, label: "Commission assessed", detail: "5% of the item subtotal. Shipping passes through to the brand.", provider, amountUsd: commission, status: txStatusMeta.succeeded, verified: null })
    if (o.paymentStatus === "refunded") out.push({ id: `${o.id}-refund`, at: o.placedAt, label: o.status === "cancelled" ? "Refunded on cancellation" : "Refund processed", detail: o.status === "cancelled" ? "Cancelled before fulfilment; the commission was reversed." : undefined, provider, amountUsd: -usd, status: txStatusMeta.succeeded, verified: true })
  }

  const hasRefundTx = out.some((e) => e.amountUsd < 0)
  if (refund && !(refund.status === "issued" && hasRefundTx)) {
    const base = { id: refund.id, at: refund.requestedAt, provider, amountUsd: -refund.amountUsd, verified: null }
    if (refund.status === "requested") out.push({ ...base, label: "Refund requested", detail: `${refund.reason}. Waiting for a Finance decision.`, status: { label: "Requested", tone: "attention" } })
    if (refund.status === "approved") out.push({ ...base, label: "Refund approved", detail: `Idempotency key ${refund.idempotencyKey}. Not sent: no payments provider is connected in this build, so no money has moved. When it is, a retry with the same key can't pay twice.`, status: refundMeta.approved })
    if (refund.status === "issued") out.push({ ...base, label: "Refund recorded as issued", detail: `Through ${providerName[provider]}, idempotency key ${refund.idempotencyKey}.`, status: txStatusMeta.succeeded, verified: null })
    if (refund.status === "declined") out.push({ ...base, amountUsd: 0, label: "Refund declined", detail: refund.reason, status: refundMeta.declined })
  }

  if (dispute) {
    out.push({
      id: dispute.id,
      at: dispute.openedAt,
      label: dispute.type === "chargeback" ? `Chargeback opened: ${dispute.reason.toLowerCase()}` : `Inquiry opened: ${dispute.reason.toLowerCase()}`,
      detail: [
        (stage ?? dispute.stage) === "needs_evidence" ? "Evidence is due before the provider decides." : null,
        shipped ? null : (stage ?? dispute.stage) === "lost" ? "The provider ruled for the customer, so the order won't ship." : isOpenStage(stage ?? dispute.stage) ? "The order hadn't shipped, so fulfilment is on hold until the dispute is decided." : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
      provider,
      amountUsd: -dispute.amountUsd,
      status: disputeMeta[stage ?? dispute.stage],
      verified: true,
    })
  }
  return out
}

type TimelineItem = { id: string; at: string; label: string; who?: string; detail?: string }

/**
 * The order's own timeline, with Control Center decisions about it merged in. Where the
 * provider's record disagrees with the order's (a failed charge), the provider's record wins:
 * the order was placed, the charge failed and fulfilment went on hold, and nothing the
 * brand's status implies after that (processing, shipping) happened on an unpaid order.
 */
export function orderTimeline(o: MerchantOrder, audit: AuditEntry[], state?: { pay: PayState; fulfil: FulfilState; refund?: Refund; dispute?: Dispute }): TimelineItem[] {
  const failed = state?.pay === "failed"
  let own: TimelineItem[]
  if (failed) {
    const charge = txByOrder.get(o.id)?.find((t) => t.type === "charge")
    const failedAt = [charge?.at ?? o.placedAt, o.placedAt].sort().at(-1)!
    own = [
      { id: "placed", at: o.placedAt, label: "Order placed" },
      { id: "charge", at: failedAt, label: "Charge failed at the provider", detail: "The provider declined it, so nothing was captured." },
      { id: "hold", at: failedAt, label: "Fulfilment put on hold", detail: "Nothing ships until the customer pays." },
    ]
  } else {
    own = o.timeline.map((t, i) => ({ id: `t${i}`, at: t.at, label: t.label }))
    if (state?.fulfil === "on_hold") {
      const last = own.at(-1)?.at ?? o.placedAt
      const at = !state.dispute || state.dispute.openedAt < last ? last : state.dispute.openedAt
      own.push({ id: "hold", at, label: "Fulfilment put on hold", detail: "Nothing ships while the dispute is open." })
    }
  }
  // Finance writes refund and dispute decisions as "#REF, $amount" with the refund or dispute
  // id as the subject, so match on either.
  const ref = `#${o.reference}`
  const subjects = new Set([state?.refund?.id, state?.dispute?.id].filter(Boolean))
  const about = (a: AuditEntry) => (a.subjectId && subjects.has(a.subjectId)) || a.target === ref || a.target.startsWith(`${ref},`)
  const decisions = audit.filter(about).map((a) => ({ id: a.id, at: a.at, label: a.action, who: a.actor, detail: a.reason }))
  return [...own, ...decisions].sort((a, b) => a.at.localeCompare(b.at))
}

/* ---------- Finance ---------- */

/**
 * A dispute's stage as Finance should read it. Evidence saved in this browser can't reach the
 * provider (no payments backend), so a dispute whose evidence was saved here reads "Evidence
 * saved", not "Under review" as if the provider had it.
 */
export function disputeStage(d: Dispute, audit: AuditEntry[]): DisputeStage {
  const saved = audit.some((a) => a.action === EVIDENCE_ACTION && (a.subjectId ? a.subjectId === d.id : a.target === `#${d.reference}` || a.target.startsWith(`#${d.reference},`)))
  if (saved && (d.stage === "needs_evidence" || d.stage === "under_review")) return "evidence_submitted"
  return d.stage
}
export const EVIDENCE_ACTION = "Submitted dispute evidence"

/** The audit action the admin store writes when a payout is held (src/lib/stores/admin.ts, verbs.payout.held). */
export const HOLD_ACTION = "Held payout"

/**
 * A payout's hold reason: the latest hold decision in the audit log, else the reason it was
 * seeded with. The store targets a payout as "<brand>, $<amount>" and keeps the log newest
 * first, so the first match is the hold that's in force (one payout per brand per run).
 */
export function holdReason(p: Payout, audit: AuditEntry[]) {
  return audit.find((a) => a.action === HOLD_ACTION && a.target.startsWith(`${p.brandName}, `))?.reason ?? p.holdReason
}

export type LedgerRow = Omit<Transaction, "provider" | "webhookVerified"> & { provider: Provider | "internal"; webhookVerified: boolean | null; memo?: string }

/** The ledger view: provider transactions, with approved adjustments appended as their own entries. */
export function ledgerRows(adjustments: AdjustmentRequest[]): LedgerRow[] {
  const adj: LedgerRow[] = adjustments
    .filter((a) => a.status === "approved")
    // An adjustment posts when the second admin approves it, so that's its ledger date.
    .map((a) => ({ id: `tx_${a.id}`, reference: a.id.replace("adj_", "ADJ-").toUpperCase(), at: a.decidedAt ?? a.at, brandName: a.brandName, type: "adjustment", provider: "internal", amountUsd: a.amountUsd, status: "succeeded", webhookVerified: null, memo: a.reason }))
  // A declined charge posts nothing, so its commission never reaches the ledger.
  const posted = transactions.filter((t) => !(t.type === "commission" && failedCharges.has(orderIdOf(t.id))))
  return [...adj, ...posted].sort((a, b) => b.at.localeCompare(a.at))
}

export const PLATFORM_ACCOUNT = "Platform (reconciliation suspense)"
export const adjustmentAccounts = [PLATFORM_ACCOUNT, ...brands.map((b) => b.name)]

/* ---------- Commission report ---------- */

export type CommissionRow = { brand: Brand; orders: number; baseUsd: number; assessedUsd: number; reversedUsd: number; netUsd: number }

function inWindow(o: MerchantOrder, days: number) {
  return new Date(o.placedAt).getTime() > DEMO_NOW - days * DAY
}

export function commissionReport(days: number): CommissionRow[] {
  const rows = new Map<string, CommissionRow>()
  for (const b of brands) rows.set(b.id, { brand: b, orders: 0, baseUsd: 0, assessedUsd: 0, reversedUsd: 0, netUsd: 0 })
  for (const o of merchantOrders) {
    if (o.status === "cancelled" || !inWindow(o, days)) continue
    const r = rows.get(o.brandId)
    if (!r) continue
    const c = convert(o.commission, o.currency, "USD")
    r.orders += 1
    r.baseUsd += convert(o.subtotal, o.currency, "USD")
    r.assessedUsd += c
    if (o.status === "refunded") r.reversedUsd += c
    r.netUsd = r.assessedUsd - r.reversedUsd
  }
  return [...rows.values()].sort((a, b) => b.netUsd - a.netUsd)
}

export function commissionSeries(days: number) {
  const byDay = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) byDay.set(new Date(DEMO_NOW - i * DAY).toISOString().slice(0, 10), 0)
  for (const o of merchantOrders) {
    if (o.status === "cancelled" || o.status === "refunded" || !inWindow(o, days)) continue
    const k = o.placedAt.slice(0, 10)
    if (byDay.has(k)) byDay.set(k, byDay.get(k)! + convert(o.commission, o.currency, "USD"))
  }
  return [...byDay.entries()].map(([date, commission]) => ({ date, commission }))
}
