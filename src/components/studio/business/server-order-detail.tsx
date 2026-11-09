"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { CheckIcon as Check, ClockCountdownIcon, CurrencyCircleDollarIcon as Refund, DotsThreeIcon, XCircleIcon as PackageX, SealCheckIcon as PackageCheck, ShieldCheckIcon as ShieldCheck, TruckIcon as Truck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { reconcileOrder } from "@/components/market/delivery/reconcile"
import { Panel } from "@/components/studio/catalog/fields"
import { OrderDeliveryCard } from "@/components/studio/shipping/order-delivery-card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { site } from "@/config/site"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { ApiError, api } from "@/lib/api/client"
import type { OrderDetailDto } from "@/lib/api/contracts/orders"
import type { DeliveryDto, StudioShippingDto } from "@/lib/api/contracts/shipping"
import { isNotFound } from "@/lib/api/errors"
import { getStudioShipping, STUDIO_SHIPPING_KEY } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import type { MerchantOrder, MerchantOrderStatus, PaymentStatus } from "@/lib/data/types"
import { countryTimeZone } from "@/lib/data/zones"
import { formatMoney } from "@/lib/money"
import { useRealtimeEventName } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { COMMISSION_RATE, formatDateYear, paymentView, plural } from "./model"
import { CustomerPanel, FulfilmentPanel, ItemsPanel, TimelinePanel, placedIn } from "./order-detail"
import { ReportDelayDialog, TrackingDialog } from "./order-dialogs"
import { ServerCancelDialog, ServerRefundDialog, ServerReturnDialog, type ReturnMode } from "./server-order-dialogs"
import { BackLink } from "./shared"
import { OrderDetailSkeleton } from "./skeletons"

/** GET /api/studio/orders/{id} as the brand sees it: the shopper's DTO plus disputes and the delivery view. */
type DisputeView = { id: string; status: string; category: string | null; amountMinor: number; currency: string; evidenceDueAt: string | null; brandEvidence: string | null; brandEvidenceAt: string | null; responseSubmittedAt: string | null; openedAt: string; resolvedAt: string | null }
type StudioOrderDto = OrderDetailDto & { disputes?: DisputeView[]; delivery?: DeliveryDto | null }

const MERCHANT: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
const statusOf = (v: string): MerchantOrderStatus => (MERCHANT.includes(v as MerchantOrderStatus) ? (v as MerchantOrderStatus) : "pending_payment")
const PAYMENT: Record<string, PaymentStatus> = { paid: "captured", pending: "pending", failed: "failed", refunded: "refunded", partially_refunded: "partially_refunded" }
const serviceLabel: Record<string, string> = { standard: "Standard delivery", express: "Express delivery", pickup: "Pickup" }

function money(minor: unknown, currency: string) {
  return typeof minor === "number" ? formatMoney(minor, currency as CurrencyCode) : null
}

/** A sentence for each event on Yard's order timeline (ids and amounts only on the server). */
function eventLabel(e: StudioOrderDto["timeline"][number], d: StudioOrderDto) {
  const amount = money(e.data.amountMinor ?? e.data.totalMinor, d.currency)
  const by = e.actorKind === "admin" ? `${site.name} support` : e.actorKind === "brand" ? "you" : e.actorKind === "shopper" ? "the customer" : null
  switch (e.kind) {
    case "order.placed":
      return `Order placed${amount ? `, ${amount}` : ""}`
    case "payment.captured":
      return "Payment confirmed by the payment provider"
    case "payment.failed":
      return "Payment failed"
    case "fulfilment.processing":
      return "Brand started processing"
    case "fulfilment.shipped":
      return "Shipped"
    case "fulfilment.delivered":
      return "Delivered"
    case "order.cancelled":
      return `Cancelled${by ? ` by ${by}` : ""}${d.cancelReason ? `: ${d.cancelReason.replace(/\.$/, "")}` : ""}${e.data.paid ? ". Full refund to the customer" : ""}`
    case "return.requested":
      return `Customer requested a return${typeof e.data.units === "number" ? ` of ${plural(e.data.units, "item")}` : ""}`
    case "return.approved":
      return `Return approved${e.data.by === "platform" ? ` by ${site.name}` : ""}`
    case "return.rejected":
      return `Return declined${e.data.by === "platform" ? ` by ${site.name}` : ""}`
    case "return.received":
      return `Return received${amount && e.data.amountMinor ? `, ${amount} refunded` : ""}`
    case "return.cancelled":
      return "Customer withdrew the return"
    case "return.expired":
      return "Return expired: the items weren't sent back in time"
    case "refund.requested":
      return `Refund of ${amount ?? "part of the order"} requested`
    case "refund.succeeded":
      return `Refund of ${amount ?? "part of the order"} sent to the customer`
    case "refund.failed":
      return `Refund of ${amount ?? "part of the order"} failed`
    case "order.completed":
      return "Order completed: the returns window closed"
    case "dispute.evidence_added":
      return "You sent your account of a payment dispute"
    default:
      if (e.kind.startsWith("dispute.")) return `Payment dispute ${e.kind.slice(8).replace(/_/g, " ")}`
      return e.kind.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  }
}

/** The server record in the shape the Studio order panels read, so a real order looks like a sample one. */
function toMerchantOrder(d: StudioOrderDto, origin: CountryCode | null): MerchantOrder {
  const ship = d.shipTo ?? {}
  const str = (k: string) => (typeof ship[k] === "string" && ship[k] ? (ship[k] as string) : undefined)
  const country = (str("country") ?? d.shipToPreview.country) as CountryCode
  const events = d.delivery?.events ?? []
  const withTracking = [...events].reverse().find((e) => e.carrier && e.trackingNumber)
  let o: MerchantOrder = {
    id: d.id,
    reference: d.reference,
    groupId: d.checkoutId ?? d.groupReference,
    brandId: d.brand.id,
    customerId: "",
    status: statusOf(d.states.merchant),
    paymentStatus: PAYMENT[d.states.payment] ?? "pending",
    currency: d.currency as CurrencyCode,
    lines: d.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, name: l.title, variantLabel: l.variantLabel, image: l.image, quantity: l.qty, unitPrice: l.unitMinor })),
    subtotal: d.subtotalMinor,
    shipping: d.shippingMinor,
    tax: Math.max(0, d.totalMinor - d.subtotalMinor - d.shippingMinor),
    total: d.totalMinor,
    commission: 0,
    placedAt: d.placedAt,
    shippingAddress: { name: str("name") ?? d.customerName, line1: [str("line1"), str("line2")].filter(Boolean).join(", "), city: str("city") ?? d.shipToPreview.city ?? "", country, postcode: str("postcode"), phone: str("phone") },
    shippingMethod: `${serviceLabel[d.service] ?? d.service}${country && origin && country !== origin ? " — international" : ""}`,
    tracking: withTracking ? { carrier: withTracking.carrier!, number: withTracking.trackingNumber! } : undefined,
    timeline: d.timeline.map((e) => ({ at: e.at, label: eventLabel(e, d) })),
    cancelReason: d.cancelReason ?? undefined,
    paidAt: d.paidAt ?? undefined,
    deliveredAt: d.deliveredAt ?? undefined,
  }
  // Shipment events move the order on before Yard's hourly sync does: the same reconcile the sample orders use.
  if (d.delivery) o = reconcileOrder(o, d.delivery, { deliveredLabel: "Marked delivered" }) ?? o
  return o
}

/** Where this brand ships from, from its own shipping profile on the server (never a demo brand's). */
type Origin = { country: CountryCode | null; tz: string }

const validZone = (tz: string | null | undefined) => {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/**
 * The ship-from country and time zone: the shipping profile's origin, else the brand's country.
 * Without a profile (not set up yet, or it couldn't load) there's no country (no "international"
 * label, the general carrier list) and times read in this browser's zone.
 */
function originFor(s: StudioShippingDto | undefined): Origin {
  const code = s?.profile.originCountry || s?.brand.country
  const country = code && code in countries ? (code as CountryCode) : null
  const tz = validZone(s?.profile.timeZone) ?? (country ? countryTimeZone[country] : null) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC"
  return { country, tz }
}

type DialogKind = "tracking" | "cancel" | "delay" | "refund" | null

export function ServerOrderDetail({ id }: { id: string }) {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  // The brand's own shipping profile: its origin country and time zone (any member may read it).
  const shipping = useApi<StudioShippingDto>(brandId ? `${STUDIO_SHIPPING_KEY}:${brandId}` : null, () => getStudioShipping(), { revalidateOnFocus: false })
  const q = useApi<{ order: StudioOrderDto }>(`studio.order:${id}`, () => api<{ order: StudioOrderDto }>(`/api/studio/orders/${encodeURIComponent(id)}`), { revalidateOnFocus: true })
  // Shipments, refunds, returns and disputes from anywhere (another member, the shopper, Yard) arrive live.
  useRealtimeEventName("order.updated", (p) => {
    if ((p as { orderId?: string } | null)?.orderId === id) void q.revalidate()
  })
  useRealtimeEventName("order.estimate", (p) => {
    if ((p as { orderId?: string } | null)?.orderId === id) void q.revalidate()
  })

  if (!q.data || (!shipping.data && !shipping.error)) {
    if (q.error && isNotFound(q.error)) {
      return (
        <div className="grid gap-6">
          <BackLink href="/studio/orders">Orders</BackLink>
          <EmptyState icon={PackageX} title="This order isn't in your Studio" body="It may belong to another brand, or the link is wrong." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/orders">Back to orders</Link></Button>} />
        </div>
      )
    }
    if (q.error) {
      return (
        <div className="grid gap-6">
          <BackLink href="/studio/orders">Orders</BackLink>
          <EmptyState
            icon={PackageX}
            title="Couldn't load this order"
            body={q.error instanceof ApiError ? q.error.message : "Check your connection and try again."}
            action={<Button size="sm" variant="secondary" onClick={() => void q.revalidate()} loading={q.isValidating}>Retry</Button>}
          />
        </div>
      )
    }
    return <OrderDetailSkeleton />
  }
  return <ServerOrderView dto={q.data.order} origin={originFor(shipping.data)} onChanged={(order) => (order ? q.mutate({ order }) : void q.revalidate())} />
}

function ServerOrderView({ dto: d, origin, onChanged }: { dto: StudioOrderDto; origin: Origin; onChanged: (order: StudioOrderDto | null) => void }) {
  const member = useServerSession((s) => s.brand)
  const o = toMerchantOrder(d, origin.country)
  const tz = origin.tz
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [returnAction, setReturnAction] = useState<{ id: string; mode: ReturnMode; open: boolean } | null>(null)
  const canFulfil = !!member?.permissions.includes("orders.fulfil")
  const mayRefund = canFulfil && (member?.role === "owner" || member?.role === "admin")
  const status = orderStatusMeta[o.status]
  const pay = paymentView(o)
  const verified = o.paymentStatus === "captured" || o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded"
  const refresh = () => onChanged(null)

  // As on the sample orders: clicks in the first moments after a change are ignored, so a double-click never takes the next step.
  const settleUntil = useRef(0)
  const [busy, setBusy] = useState(false)
  function act(fn: () => void) {
    if (busy || performance.now() < settleUntil.current) return
    fn()
  }
  async function post(path: string, body: unknown, success: { title: string; description?: string }) {
    setBusy(true)
    try {
      const r = await api<{ order?: StudioOrderDto }>(`/api/studio/orders/${encodeURIComponent(d.id)}/${path}`, { body })
      settleUntil.current = performance.now() + 450
      toast.success(success.title, success.description ? { description: success.description } : undefined)
      onChanged(r.order ?? null)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "That didn't go through. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }
  const markProcessing = () => void post("processing", {}, { title: `#${d.reference} is processing`, description: "Add tracking when it ships." })
  const markDelivered = () => void post("shipment", { status: "delivered", occurredAt: new Date().toISOString() }, { title: `#${d.reference} marked delivered`, description: "The returns window starts today. The shopper's order updates too." })

  const delayable = canFulfil && (o.status === "paid" || o.status === "processing" || o.status === "shipped")
  const moreMenu =
    delayable || (canFulfil && d.refundableMinor > 0) ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" aria-label="More order actions" className="px-2.5">
            <DotsThreeIcon weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {delayable ? (
            <DropdownMenuItem onSelect={() => act(() => setDialog("delay"))}>
              <ClockCountdownIcon /> Report a delay
            </DropdownMenuItem>
          ) : null}
          {d.refundableMinor > 0 ? (
            <DropdownMenuItem disabled={!mayRefund} onSelect={() => act(() => setDialog("refund"))} className="items-start">
              <Refund className="mt-0.5" />
              <span className="grid gap-0.5">
                <span>Refund the customer</span>
                {!mayRefund ? <span className="text-[11px] text-ink-3">Only the brand&apos;s owner or admins can refund</span> : null}
              </span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  let actions: React.ReactNode = moreMenu
  if (canFulfil && o.status === "paid") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="secondary" onClick={() => act(() => setDialog("tracking"))}><Truck /> Add tracking</Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => act(markProcessing)}><PackageCheck /> Mark as processing</Button>
      </>
    )
  } else if (canFulfil && o.status === "processing") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="primary" onClick={() => act(() => setDialog("tracking"))}><Truck /> Add tracking</Button>
      </>
    )
  } else if (canFulfil && o.status === "shipped") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="secondary" onClick={() => act(() => setDialog("tracking"))}>Edit tracking</Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => act(markDelivered)}><Check /> Mark delivered</Button>
      </>
    )
  }

  const openReturn = (rid: string, mode: ReturnMode) => act(() => setReturnAction({ id: rid, mode, open: true }))
  const shownReturns = d.returns.filter((r) => r.status === "requested" || r.status === "approved" || r.status === "received" || r.status === "rejected").slice(0, 1)

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/orders">Orders</BackLink>
        <PageHeader title={`Order #${o.reference}`} description={`Placed ${placedIn(o.placedAt, tz)}. ${plural(d.itemCount, "item")}, ${formatMoney(o.total, o.currency)}.`} actions={actions}>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {pay.label !== status.label ? <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge> : null}
            {d.states.dispute === "open" ? <StatusBadge tone="danger">Payment disputed</StatusBadge> : null}
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <ShieldCheck className="size-3.5 text-violet" aria-hidden />
                Payment verified by the payment provider
              </span>
            ) : null}
          </div>
          {!canFulfil ? <p className="mt-2 text-xs text-ink-3">Your role can view this order. Fulfilling it needs the Fulfilment, Admin or Owner role.</p> : null}
        </PageHeader>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6 xl:col-start-1">
          {(d.disputes ?? []).map((x) => (
            <DisputePanel key={x.id} order={d} dispute={x} canFulfil={canFulfil} onDone={refresh} />
          ))}
          {shownReturns.map((r) => (
            <ReturnPanel key={r.id} order={d} ret={r} canFulfil={canFulfil} onAction={openReturn} />
          ))}
          <FulfilmentPanel order={o} live canCancel={canFulfil && d.actions.canCancel} onCancel={() => act(() => setDialog("cancel"))} />
          <OrderDeliveryCard order={o} brand={d.brand} />
          <ItemsPanel order={o} cur={o.currency} />
        </div>
        <aside className="grid min-w-0 gap-6 xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-label="Customer and payout">
          <CustomerPanel order={o} customerName={d.customerName} />
          <PayoutPanel order={d} />
        </aside>
        <div className="min-w-0 xl:col-start-1">
          <TimelinePanel order={o} tz={tz} />
        </div>
      </div>

      <TrackingDialog open={dialog === "tracking"} onOpenChange={(v) => { setDialog(v ? "tracking" : null); if (!v) refresh() }} order={o} brand={{ country: origin.country }} server />
      <ReportDelayDialog open={dialog === "delay"} onOpenChange={(v) => { setDialog(v ? "delay" : null); if (!v) refresh() }} order={o} />
      <ServerCancelDialog open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} order={d} onDone={onChanged as (x: OrderDetailDto | null) => void} />
      <ServerRefundDialog open={dialog === "refund"} onOpenChange={(v) => setDialog(v ? "refund" : null)} order={d} onDone={onChanged as (x: OrderDetailDto | null) => void} />
      {returnAction ? (
        <ServerReturnDialog
          open={returnAction.open}
          onOpenChange={(v) => setReturnAction((r) => (r ? { ...r, open: v } : r))}
          order={d}
          returnId={returnAction.id}
          mode={returnAction.mode}
          onDone={onChanged as (x: OrderDetailDto | null) => void}
        />
      ) : null}
    </div>
  )
}

/* ---------- Return ---------- */

function ReturnPanel({ order: d, ret: r, canFulfil, onAction }: { order: StudioOrderDto; ret: StudioOrderDto["returns"][number]; canFulfil: boolean; onAction: (id: string, mode: ReturnMode) => void }) {
  const units = r.lines.reduce((n, l) => n + l.qty, 0)
  const partial = units < d.itemCount
  const who = r.decidedBy === "platform" ? `${site.name} Finance` : "You"
  const meta: Record<string, { title: string; description: string; badge: string; tone: "attention" | "info" | "muted" | "success" }> = {
    requested: { title: "Return requested", description: `Requested ${formatDateYear(r.requestedAt)}. Approve to have the items sent back, or decline with a reason the customer will see.`, badge: "Needs a decision", tone: "attention" },
    approved: { title: "Return approved", description: `${who} approved it${r.decidedAt ? ` on ${formatDateYear(r.decidedAt)}` : ""}. Mark it received when the items are back; the refund goes out then.`, badge: "Waiting for the parcel", tone: "info" },
    received: { title: "Return received", description: `The items came back${r.decidedAt ? `; approved ${formatDateYear(r.decidedAt)}` : ""}.`, badge: "Received", tone: "success" },
    rejected: { title: "Return declined", description: `${who} declined the customer's return${r.decidedAt ? ` on ${formatDateYear(r.decidedAt)}` : ""}. The reason is shown on the customer's order.`, badge: "Declined", tone: "muted" },
  }
  const m = meta[r.status] ?? meta.requested
  return (
    <Panel id="return-outcome" title={m.title} description={m.description} action={<StatusBadge tone={m.tone} className="shrink-0">{m.badge}</StatusBadge>} className={r.status === "requested" ? "min-w-0 border-acid/30" : "min-w-0"}>
      <dl className="grid gap-3 rounded-md border border-line-soft bg-surface/60 p-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">Reason</dt>
          <dd className="text-ink">{r.reasonLabel}</dd>
        </div>
        {r.note ? (
          <div className="grid gap-0.5">
            <dt className="text-xs text-ink-3">Customer&apos;s note</dt>
            <dd className="text-ink-2">&ldquo;{r.note}&rdquo;</dd>
          </div>
        ) : null}
        {r.status === "rejected" && r.decisionReason ? (
          <div className="grid gap-0.5">
            <dt className="text-xs text-ink-3">{r.decidedBy === "platform" ? "Finance's reason" : "Your reason"}</dt>
            <dd className="text-ink-2">&ldquo;{r.decisionReason}&rdquo;</dd>
          </div>
        ) : null}
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">{partial ? `Returning ${units} of ${plural(d.itemCount, "item")}` : "Returning"}</dt>
          <dd className="text-ink-2">{partial ? r.lines.map((l) => (l.qty > 1 ? `${l.title} ×${l.qty}` : l.title)).join(", ") : "The whole order"}</dd>
        </div>
      </dl>
      {canFulfil && (r.status === "requested" || r.status === "approved") ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {r.status === "requested" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => onAction(r.id, "decline")}>Decline</Button>
              <Button size="sm" variant="primary" onClick={() => onAction(r.id, "approve")}>Approve return</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => onAction(r.id, "receive")}>Mark received</Button>
          )}
        </div>
      ) : null}
    </Panel>
  )
}

/* ---------- Dispute ---------- */

function DisputePanel({ order: d, dispute: x, canFulfil, onDone }: { order: StudioOrderDto; dispute: DisputeView; canFulfil: boolean; onDone: () => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = x.status === "open" || x.status === "awaiting_response" || x.status === "under_review"
  const due = x.evidenceDueAt ? formatDateYear(x.evidenceDueAt) : null
  const canSend = canFulfil && open && !x.brandEvidence

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (text.trim().length < 10) {
      setError("Describe what happened with this order (tracking, messages, proof of delivery).")
      document.getElementById(`dispute-${x.id}`)?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/api/studio/orders/${encodeURIComponent(d.id)}/disputes/${encodeURIComponent(x.id)}/evidence`, { body: { evidence: text.trim() } })
      toast.success("Sent to Yard", { description: "Yard adds it to the response to the payment provider." })
      setText("")
      onDone()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "It wasn't sent. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Payment dispute"
      description={`The customer's bank disputed ${formatMoney(x.amountMinor, x.currency as CurrencyCode)} on ${formatDateYear(x.openedAt)}${x.category ? ` (${x.category.replace(/_/g, " ")})` : ""}.${open && due ? ` Evidence is due by ${due}.` : ""} While it's open the order can't be cancelled, returned or refunded.`}
      action={<StatusBadge tone={open ? "danger" : "muted"} className="shrink-0">{x.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</StatusBadge>}
      className={open ? "min-w-0 border-danger/30" : "min-w-0"}
    >
      {x.brandEvidence ? (
        <div className="grid gap-0.5 rounded-md border border-line-soft bg-surface/60 p-3 text-sm">
          <span className="text-xs text-ink-3">Your account{x.brandEvidenceAt ? `, sent ${formatDateYear(x.brandEvidenceAt)}` : ""}</span>
          <p className="whitespace-pre-line text-ink-2">{x.brandEvidence}</p>
        </div>
      ) : canSend ? (
        <form noValidate onSubmit={send} className="grid gap-2">
          <label htmlFor={`dispute-${x.id}`} className="text-sm text-ink">Your account of the order</label>
          <Textarea id={`dispute-${x.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} aria-invalid={!!error} aria-describedby={error ? `dispute-${x.id}-error` : undefined} placeholder="e.g. Shipped with GIG on 3 Nov, tracking GIG4810027731, delivered and signed for on 6 Nov." />
          {error ? <p id={`dispute-${x.id}-error`} role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" loading={busy}>Send to Yard</Button>
          </div>
        </form>
      ) : open ? (
        <p className="text-sm text-ink-2">{canFulfil ? "Yard is reviewing it." : "A member with the Fulfilment, Admin or Owner role can send your account of the order."}</p>
      ) : null}
    </Panel>
  )
}

/* ---------- Payout ---------- */

function PayoutPanel({ order: d }: { order: StudioOrderDto }) {
  const c = d.currency as CurrencyCode
  const voided = d.states.merchant === "cancelled" || d.states.merchant === "refunded" || d.states.payment === "refunded"
  const commission = Math.round(d.subtotalMinor * COMMISSION_RATE)
  // Refunds beyond the shipping the customer paid come off the items, net of the commission returned on them.
  const refundedItems = Math.max(0, Math.min(d.subtotalMinor, d.refundedMinor))
  const commissionBack = Math.round(refundedItems * COMMISSION_RATE)
  const payout = voided ? 0 : Math.max(0, d.subtotalMinor - commission - refundedItems + commissionBack)
  const description = voided
    ? d.states.merchant === "cancelled" ? "No payout for this order: it was cancelled." : "No payout for this order: the whole order is refunded."
    : d.states.return === "requested" || d.states.return === "approved"
      ? "On hold while the return is settled. Refunding the returned items takes them off; declining releases it."
      : refundedItems
        ? "Part of the order was refunded, so it comes off. An estimate until the returns window closes."
        : "An estimate until the order completes and the returns window closes."
  return (
    <Panel title="Your payout" className="min-w-0" description={description}>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-ink-2">Item subtotal</dt><dd className="text-ink tabular">{formatMoney(d.subtotalMinor, c)}</dd></div>
        <div className="flex justify-between gap-4">
          <dt className="flex items-center gap-1 text-ink-2">
            Commission (5%)
            <InfoTip label="About the commission">5% of the item subtotal on completed sales. No monthly or listing fees. Commission is returned when an order is cancelled or refunded.</InfoTip>
          </dt>
          <dd className={voided ? "text-ink-3 line-through tabular" : "text-ink tabular"}>−{formatMoney(commission, c)}</dd>
        </div>
        {refundedItems && !voided ? (
          <>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Refunded to the customer</dt><dd className="text-ink tabular">−{formatMoney(refundedItems, c)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Commission returned on it</dt><dd className="text-ink tabular">+{formatMoney(commissionBack, c)}</dd></div>
          </>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-2">
          <dt className="text-ink">Estimated payout</dt>
          <dd className="text-lg font-medium text-ink tabular">{formatMoney(payout, c)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-3">Shipping the customer pays covers delivery and isn&apos;t part of this estimate. See <Link href="/studio/payouts" className="text-violet hover:underline">Payouts</Link> for what&apos;s available.</p>
    </Panel>
  )
}
