"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { ProhibitIcon as Ban, CheckIcon as Check, CopyIcon as Copy, HourglassIcon as Hourglass, SealCheckIcon as PackageCheck, XCircleIcon as PackageX, ShieldCheckIcon as ShieldCheck, TruckIcon as Truck, ArrowUUpLeftIcon as Undo2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { Button } from "@/components/ui/button"
import { site } from "@/config/site"
import { brandById } from "@/lib/data/brands"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { spring } from "@/lib/motion"
import { studioSeedOrders, useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { useBrandSettings, useSettingsReady } from "./settings-store"
import { CancelOrderDialog, DeclineRefundDialog, ApproveRefundDialog, ReportDelayDialog, TrackingDialog } from "./order-dialogs"
import { OrderDeliveryCard } from "@/components/studio/shipping/order-delivery-card"
import { syncMessage, syncShipment, useShipmentQueue } from "@/components/studio/shipping/shipment-sync"
import { useStudioDelivery } from "@/components/studio/shipping/use-studio-delivery"
import { DeliveryFlag } from "@/components/market/delivery/delivery-bits"
import { reconcileOrder } from "@/components/market/delivery/reconcile"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { getServerSessionState, useServerSession } from "@/lib/session/use-server-session"
import { noonUtc } from "@/lib/shipping/calendar"
import { DotsThreeIcon, ClockCountdownIcon } from "@phosphor-icons/react"
import { DEMO_NOW, DAY_MS, countryName, formatDateYear, formatWeekday, itemCount, paymentView, payoutEstimate, plural, refundRequest, shipBy, shopperName } from "./model"
import { Panel } from "@/components/studio/catalog/fields"
import { Thumb } from "@/components/studio/catalog/parts"
import { brandZone, formatInZone, formatTimeInZone, zoneAbbr } from "@/components/studio/growth/utils"
import { BackLink, DefinitionList, useStudioReady } from "./shared"
import { OrderDetailSkeleton } from "./skeletons"
import { ServerOrderDetail } from "./server-order-detail"

/**
 * A real (non-demo) brand member reads the order from Yard's server (GET /api/studio/orders/{id});
 * demo sessions and signed-out visitors keep the sample orders in this browser's Studio store.
 */
export function OrderDetail({ id }: { id: string }) {
  const member = useServerSession((s) => s.brand)
  const sessionLoading = useServerSession((s) => s.status === "loading")
  if (member && !member.demo) return <ServerOrderDetail key={`${member.brand.id}:${id}`} id={id} />
  return <DemoOrderDetail id={id} sessionLoading={sessionLoading} />
}

function DemoOrderDetail({ id, sessionLoading }: { id: string; sessionLoading: boolean }) {
  const studioReady = useStudioReady()
  const settingsReady = useSettingsReady()
  const ready = studioReady && settingsReady
  const order = useStudio((s) => s.orders.find((o) => o.id === id))
  const brandId = useStudio((s) => s.brandId)
  const brand = brandById.get(brandId)!

  // An order not in this browser may be a real brand's server order: wait for the session to answer.
  if (!ready || (!order && sessionLoading)) return <OrderDetailSkeleton />

  if (!order) {
    return (
      <div className="grid gap-6">
        <BackLink href="/studio/orders">Orders</BackLink>
        <EmptyState
          icon={PackageX}
          title="This order isn't in your Studio"
          body="It may belong to another brand, or the sample data in this browser was reset."
          action={<Button asChild size="sm" variant="secondary"><Link href="/studio/orders">Back to orders</Link></Button>}
        />
      </div>
    )
  }

  return <OrderView order={order} brand={brand} />
}

type DialogKind = "tracking" | "cancel" | "approve" | "decline" | "delay" | null

/** Orders that came with the sample data (not placed at checkout in this browser). */
const seededIds = new Set(studioSeedOrders.map((o) => o.id))

/** "3 Nov 2026 at 13:00 WAT": an instant in the brand's time zone, as Drops and Promotions show times. */
export function placedIn(iso: string, tz: string) {
  const ms = Date.parse(iso)
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(ms)
  return `${day} at ${formatTimeInZone(ms, tz)} ${zoneAbbr(tz, ms)}`
}

/** "3 Nov, 13:00 WAT" for a timeline entry. */
function stampIn(iso: string, tz: string) {
  const ms = Date.parse(iso)
  return `${formatInZone(ms, tz, { weekday: false })} ${zoneAbbr(tz, ms)}`
}

const steps = [
  { key: "paid", label: "To fulfil" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const

function stepIndex(status: MerchantOrder["status"]) {
  if (status === "paid") return 0
  if (status === "processing") return 1
  if (status === "shipped") return 2
  if (status === "delivered" || status === "refund_requested" || status === "refunded") return 3
  return -1
}

function OrderView({ order: o, brand }: { order: MerchantOrder; brand: Brand }) {
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const cur = brand.currency
  const status = orderStatusMeta[o.status]
  const pay = paymentView(o)
  const verified = o.paymentStatus === "captured" || o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded"
  const sample = seededIds.has(o.id)
  const tz = brandZone(brand).tz
  // Shipment events from here go to Yard's server too; ones queued while offline go out now.
  useShipmentQueue()
  const brandSession = useServerSession((s) => s.brand)
  // Another member (or this member on another device) may have shipped or delivered it: Yard's
  // record moves this browser's copy forward, so the header, stepper and timeline match the
  // Delivery card and "Mark delivered" can't record a second delivery.
  const serverDelivery = useStudioDelivery(o.id).data
  useEffect(() => {
    if (!serverDelivery) return
    const cur = useStudio.getState().orders.find((x) => x.id === serverDelivery.orderId)
    const next = cur ? reconcileOrder(cur, serverDelivery, { deliveredLabel: "Marked delivered on Yard" }) : null
    if (next) useStudio.setState({ orders: useStudio.getState().orders.map((x) => (x.id === next.id ? next : x)) })
  }, [serverDelivery])
  const canReportDelay = !!brandSession?.permissions.includes("orders.fulfil") && brandSession.brand.id === o.brandId

  // A status change swaps the header buttons, and the new primary lands under the cursor.
  // Clicks in the first moments after a change are ignored, so a double-click never takes the next step.
  const settleUntil = useRef(0)
  function act(fn: () => void) {
    if (performance.now() < settleUntil.current) return
    fn()
  }
  const moved = () => {
    settleUntil.current = performance.now() + 450
  }

  function markProcessing() {
    if (useStudio.getState().orders.find((x) => x.id === o.id)?.status !== "paid") return
    moved()
    setOrderStatus(o.id, "processing", "Brand started processing")
    toast.success(`#${o.reference} is processing`, {
      description: "Add tracking when it ships.",
      action: { label: "Undo", onClick: () => useStudio.getState().setOrderStatus(o.id, "paid", "Moved back to To fulfil") },
    })
  }

  function markDelivered() {
    if (useStudio.getState().orders.find((x) => x.id === o.id)?.status !== "shipped") return
    moved()
    setOrderStatus(o.id, "delivered", "Marked delivered by brand")
    const signedIn = !!getServerSessionState().brand
    if (signedIn) {
      // Yard's server records it for the shopper; an event there can't be taken back, so no Undo.
      void syncShipment(o.id, { status: "delivered" }, true).then((r) => {
        if (r.result === "refused") toast.error(`Yard didn't record the delivery on #${o.reference}`, { description: `${r.message} It's marked delivered in this browser only.` })
        else toast.success(`#${o.reference} marked delivered`, { description: `The returns window starts today. ${syncMessage(r.result)}` })
      })
      return
    }
    toast.success(`#${o.reference} marked delivered`, {
      description: "The returns window starts today. Saved in this browser: sign in to Brand Studio so the shopper's order updates too.",
      action: { label: "Undo", onClick: () => useStudio.getState().setOrderStatus(o.id, "shipped", "Delivery mark undone by brand") },
    })
  }

  const delayable = o.status === "paid" || o.status === "processing" || o.status === "shipped"
  const moreMenu = delayable ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="secondary" aria-label="More order actions" className="px-2.5">
          <DotsThreeIcon weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem disabled={!canReportDelay} onSelect={() => act(() => setDialog("delay"))} className="items-start">
          <ClockCountdownIcon className="mt-0.5" />
          <span className="grid gap-0.5">
            <span>Report a delay</span>
            {!canReportDelay ? <span className="text-[11px] text-ink-3">{brandSession ? "Needs the Fulfilment or Owner role for this brand" : "Sign in to Brand Studio to tell the shopper"}</span> : null}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  let actions: React.ReactNode = null
  if (o.status === "paid") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="secondary" onClick={() => act(() => setDialog("tracking"))}><Truck /> Add tracking</Button>
        <Button size="sm" variant="primary" onClick={() => act(markProcessing)}><PackageCheck /> Mark as processing</Button>
      </>
    )
  } else if (o.status === "processing") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="primary" onClick={() => act(() => setDialog("tracking"))}><Truck /> Add tracking</Button>
      </>
    )
  } else if (o.status === "shipped") {
    actions = (
      <>
        {moreMenu}
        <Button size="sm" variant="secondary" onClick={() => act(() => setDialog("tracking"))}>Edit tracking</Button>
        <Button size="sm" variant="primary" onClick={() => act(markDelivered)}><Check /> Mark delivered</Button>
      </>
    )
  } else if (o.status === "refund_requested") {
    actions = (
      <>
        <Button size="sm" variant="secondary" onClick={() => act(() => setDialog("decline"))}>Decline</Button>
        <Button size="sm" variant="primary" onClick={() => act(() => setDialog("approve"))}><Undo2 /> Approve refund</Button>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/orders">Orders</BackLink>
        <PageHeader
          title={`Order #${o.reference}`}
          description={`Placed ${placedIn(o.placedAt, tz)}. ${plural(itemCount(o), "item")}, ${formatMoney(o.total, cur)}.`}
          actions={actions}
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sample ? <SampleDataNote /> : null}
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {/* An unpaid order's status already says "Awaiting payment"; the payment badge would repeat it. */}
            {pay.label !== status.label ? <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge> : null}
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <ShieldCheck className="size-3.5 text-violet" aria-hidden />
                {o.paymentStatus === "captured" && o.status !== "refunded" && o.status !== "cancelled" ? "Verified by the payment provider" : "Payment verified by the payment provider"}
              </span>
            ) : null}
          </div>
        </PageHeader>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6 xl:col-start-1">
          {o.status === "refund_requested" ? <RefundPanel order={o} cur={cur} /> : o.returnRequest?.decision ? <ReturnOutcome order={o} cur={cur} brandName={brand.name} /> : null}
          <FulfilmentPanel order={o} onCancel={() => act(() => setDialog("cancel"))} />
          <OrderDeliveryCard order={o} brand={brand} />
          <ItemsPanel order={o} cur={cur} />
        </div>

        <aside className="grid min-w-0 gap-6 xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-label="Customer and payout">
          <CustomerPanel order={o} />
          <PayoutPanel order={o} cur={cur} />
        </aside>

        <div className="min-w-0 xl:col-start-1">
          <TimelinePanel order={o} tz={tz} />
        </div>
      </div>

      <TrackingDialog open={dialog === "tracking"} onOpenChange={(v) => setDialog(v ? "tracking" : null)} order={o} brand={brand} />
      <CancelOrderDialog open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} order={o} />
      <ApproveRefundDialog open={dialog === "approve"} onOpenChange={(v) => setDialog(v ? "approve" : null)} order={o} />
      <DeclineRefundDialog open={dialog === "decline"} onOpenChange={(v) => setDialog(v ? "decline" : null)} order={o} />
      <ReportDelayDialog open={dialog === "delay"} onOpenChange={(v) => setDialog(v ? "delay" : null)} order={o} />
    </div>
  )
}

/* ---------- Fulfilment ---------- */

export function CopyNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        } catch {
          toast.error("Couldn't copy. Select the number and copy it manually.")
        }
      }}
      aria-label={`Copy tracking number ${value}`}
      className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-white/6 hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-violet" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/**
 * `live`: the order is Yard's server record (a real brand), so payments and refunds are real and
 * the server's `canCancel` decides whether Cancel shows.
 */
export function FulfilmentPanel({ order: o, onCancel, live = false, canCancel }: { order: MerchantOrder; onCancel: () => void; live?: boolean; canCancel?: boolean }) {
  const idx = stepIndex(o.status)
  const [mountedAt] = useState(() => Date.now())
  // Yard's ship-by date (business days, the brand's handling time and closures) when Studio has it;
  // else the same rule here with the processing time saved in this browser.
  const processingDays = useBrandSettings((s) => s.shipping.processingDays)
  const server = useStudioDelivery(o.id).data?.estimate
  const due = server?.shipBy ? noonUtc(server.shipBy) : shipBy(o, processingDays)
  const late = server?.basis === "late" || server?.basis === "exception"
  const daysLeft = late ? -1 : Math.ceil((due - (live ? mountedAt : DEMO_NOW)) / DAY_MS)
  const open = o.status === "paid" || o.status === "processing"
  const showCancel = canCancel ?? open
  const cancelReason = o.status === "cancelled" ? (o.cancelReason ? `You cancelled it: ${o.cancelReason.replace(/\.$/, "")}.` : [...o.timeline].reverse().find((t) => /cancel/i.test(t.label))?.label) : null

  const copy: Record<string, string> = {
    paid: "Paid and waiting for you. Mark it as processing when you start packing, or add tracking straight away if it's ready to go.",
    processing: "You're packing this order. Add the carrier and tracking number when it leaves the studio.",
    shipped: "On its way. Mark it delivered once the carrier confirms, or the customer confirms receipt.",
    delivered: o.paymentStatus === "partially_refunded" ? (o.refund ? "Delivered, with a partial refund approved for the returned items. Your payout for the rest follows once the returns window closes." : "Delivered, with part of the order refunded. Your payout for the rest follows once the returns window closes.") : "Delivered. The returns window is open; your payout follows once it closes.",
    refund_requested: live ? "A return is under way. Follow it in the Return panel above." : "Delivered, and the customer has asked for a refund. Decide on the request above.",
    refunded: o.refund && !live ? "Refund approved and recorded. It's sent to the customer once a payment provider is connected." : "Refunded to the customer.",
    cancelled: o.paymentStatus === "pending" ? "Cancelled before it was paid." : live ? "Cancelled before shipping. The customer's payment is refunded in full." : "Cancelled before shipping. The customer is owed a full refund.",
    pending_payment: "Waiting for the payment provider to confirm payment. Don't ship until it's paid.",
  }
  if (live && o.paymentStatus === "partially_refunded" && o.status === "delivered") copy.delivered = "Delivered, with part of the order refunded. Your payout for the rest follows once the returns window closes."

  return (
    <Panel
      id="fulfilment"
      title="Fulfilment"
      description={copy[o.status]}
      className="min-w-0"
      action={open ? (
        // Ink, not acid: the header's primary action is the page's one acid element.
        daysLeft <= 0 ? (
          <DeliveryFlag className="shrink-0 tabular">{daysLeft < 0 ? `Late: ship by was ${formatWeekday(due)}` : `Ship by ${formatWeekday(due)}`}</DeliveryFlag>
        ) : (
          <StatusBadge tone="muted" className="shrink-0 tabular">Ship by {formatWeekday(due)}</StatusBadge>
        )
      ) : undefined}
    >
      {o.status === "pending_payment" ? (
        <p className="flex items-start gap-2 rounded-md border border-line-soft bg-surface/60 px-3 py-2.5 text-sm text-ink-2">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          {live ? "The payment provider hasn't confirmed payment yet. Don't pack or ship it until it shows Paid." : "No payment provider is connected in this development build, so this order stays unpaid. Don't pack or ship it."}
        </p>
      ) : idx >= 0 ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Fulfilment progress">
          {steps.map((s, i) => {
            const done = i < idx
            const current = i === idx
            return (
              <li key={s.key} className="grid gap-2" aria-current={current ? "step" : undefined}>
                <span className="relative block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  {done || current ? <motion.span layoutId={current ? `step-${o.id}` : undefined} transition={spring.indicator} className={cn("absolute inset-0 rounded-full", current ? "bg-purple" : "bg-ink-3/70")} /> : null}
                </span>
                <span className={cn("text-[11px] leading-tight sm:text-xs", current ? "text-ink" : done ? "text-ink-2" : "text-ink-3")}>{s.label}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="flex items-center gap-2 rounded-md border border-line-soft bg-surface/60 px-3 py-2.5 text-sm text-ink-2">
          <Ban className="size-4 shrink-0 text-ink-3" aria-hidden />
          {cancelReason ?? "Cancelled before shipping."}
        </p>
      )}

      <AnimatePresence initial={false}>
        {o.tracking ? (
          <motion.div key="tracking" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-soft bg-surface/60 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <Truck className="size-4 shrink-0 text-ink-2" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm text-ink">{o.tracking.carrier}</p>
                <p className="truncate text-xs text-ink-2 tabular">{o.tracking.number}</p>
              </div>
            </div>
            <CopyNumber value={o.tracking.number} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {showCancel || o.status === "shipped" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft pt-4">
          {showCancel ? (
            <>
              <p className="text-xs text-ink-3">{o.paymentStatus === "pending" ? "You can cancel until it ships. It isn't paid, so nothing is refunded." : "You can cancel until it ships; the customer is owed a full refund."}</p>
              <Button size="sm" variant="ghost" className="-mx-2 text-danger hover:bg-danger/10 hover:text-danger sm:mx-0" onClick={onCancel}>
                <Ban /> Cancel order
              </Button>
            </>
          ) : (
            <p className="text-xs text-ink-3">Shipped orders can&apos;t be cancelled. The customer can request a refund after delivery.</p>
          )}
        </div>
      ) : null}
    </Panel>
  )
}

/* ---------- Refund request ---------- */

function RefundPanel({ order: o, cur }: { order: MerchantOrder; cur: Brand["currency"] }) {
  const req = refundRequest(o)
  const partial = req.lines.length < o.lines.length
  // Pieces (quantities, not lines), as the order's item count reads.
  const units = req.lines.reduce((n, l) => n + l.quantity, 0)
  return (
    <Panel
      title="Return requested"
      description={`Requested ${formatDateYear(req.at)}. Approve to refund ${formatMoney(req.amount, cur)}, or decline with a reason the customer will see.`}
      action={<StatusBadge tone="attention" className="shrink-0">Needs a decision</StatusBadge>}
      className="min-w-0 border-acid/30"
    >
      <dl className="grid gap-3 rounded-md border border-line-soft bg-surface/60 p-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">Reason</dt>
          <dd className="text-ink">{req.reason}</dd>
        </div>
        {req.note ? (
          <div className="grid gap-0.5">
            <dt className="text-xs text-ink-3">Customer&apos;s note</dt>
            <dd className="text-ink-2">&ldquo;{req.note}&rdquo;</dd>
          </div>
        ) : null}
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">{partial ? `Returning ${units} of ${plural(itemCount(o), "item")}` : "Returning"}</dt>
          <dd className="text-ink-2">{partial ? req.lines.map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ") : "The whole order"}</dd>
        </div>
      </dl>
      {req.sample ? <p className="mt-2 text-xs text-ink-3">This request comes with the sample data. Requests customers make from their orders show their own reason and items.</p> : null}
    </Panel>
  )
}

/* ---------- Return outcome ---------- */

/** A decided return: who decided, and what it means for the customer and the payout. */
function ReturnOutcome({ order: o, cur, brandName }: { order: MerchantOrder; cur: Brand["currency"]; brandName: string }) {
  const r = o.returnRequest!
  const d = r.decision!
  const who = d.by === "brand" ? "You" : `${site.name} Finance`
  const returning = o.lines.filter((l) => r.variantIds.includes(l.variantId))
  const units = returning.reduce((n, l) => n + l.quantity, 0)
  const approved = d.status === "approved"
  return (
    <Panel
      id="return-outcome"
      title={approved ? (d.partial ? "Partial refund approved" : "Refund approved") : "Return declined"}
      description={
        approved
          ? `${who} approved ${formatMoney(d.amount ?? 0, cur)} for the customer on ${formatDateYear(d.at)}. It's recorded, and sent through the payment provider once one is connected; nothing has moved yet.`
          : `${who} declined the customer's return on ${formatDateYear(d.at)}. ${d.by === "brand" ? "Your" : "The"} reason is shown on the customer's order.`
      }
      action={<StatusBadge tone={approved ? "info" : "muted"} className="shrink-0">{approved ? "Recorded, not sent" : "Declined"}</StatusBadge>}
      className="min-w-0"
    >
      <dl className="grid gap-3 rounded-md border border-line-soft bg-surface/60 p-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">Customer&apos;s reason</dt>
          <dd className="text-ink">{r.reasonLabel}</dd>
        </div>
        {!approved && d.reason ? (
          <div className="grid gap-0.5">
            <dt className="text-xs text-ink-3">{d.by === "brand" ? `${brandName}'s reason` : "Finance's reason"}</dt>
            <dd className="text-ink-2">&ldquo;{d.reason}&rdquo;</dd>
          </div>
        ) : null}
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">{!approved ? "Asked to return" : d.partial ? `Approved for refund: ${units} of ${plural(itemCount(o), "item")}` : "Approved for refund"}</dt>
          <dd className="text-ink-2">{d.partial || !approved ? returning.map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join(", ") : "The whole order"}</dd>
        </div>
      </dl>
    </Panel>
  )
}

/* ---------- Items ---------- */

/** Whether the payment provider has taken the customer's money (captured, possibly refunded since). */
const moneyTaken = (o: MerchantOrder) => o.paymentStatus === "captured" || o.paymentStatus === "partially_refunded" || o.paymentStatus === "refunded"

export function ItemsPanel({ order: o, cur }: { order: MerchantOrder; cur: Brand["currency"] }) {
  return (
    <section aria-labelledby="items-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
        <h2 id="items-title" className="text-sm font-medium text-ink">Items</h2>
        <span className="text-xs text-ink-2 tabular">{plural(itemCount(o), "item")}</span>
      </div>
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        {o.lines.map((l) => (
          <li key={`${l.productId}-${l.variantId}`} className="flex items-start gap-3 px-4 py-3 md:px-5">
            <Thumb image={l.image} size={56} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <Link href={`/studio/products/${l.productId}`} className="truncate text-sm font-medium text-ink hover:text-violet">{l.name}</Link>
              <span className="text-xs text-ink-2">{l.variantLabel || "One size"}</span>
              <span className="text-xs text-ink-3 tabular">{formatMoney(l.unitPrice, cur)} each</span>
            </div>
            <div className="grid justify-items-end gap-0.5 text-right">
              <span className="text-sm text-ink tabular">{formatMoney(l.unitPrice * l.quantity, cur)}</span>
              <span className="text-xs text-ink-3 tabular">Qty {l.quantity}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="grid gap-2 border-t border-line-soft px-4 py-3 text-sm md:px-5">
        <div className="flex justify-between gap-4"><dt className="text-ink-2">Subtotal</dt><dd className="text-ink tabular">{formatMoney(o.subtotal, cur)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-ink-2">Shipping ({o.shippingMethod.toLowerCase().includes("international") ? "international" : "domestic"})</dt><dd className="text-ink tabular">{formatMoney(o.shipping, cur)}</dd></div>
        {o.tax ? <div className="flex justify-between gap-4"><dt className="text-ink-2">Tax</dt><dd className="text-ink tabular">{formatMoney(o.tax, cur)}</dd></div> : null}
        {/* "Paid" only once the payment provider has taken the money; until then it's what the customer owes. */}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-2"><dt className="text-ink">{moneyTaken(o) ? "Customer paid" : "Order total"}</dt><dd className="font-medium text-ink tabular">{formatMoney(o.total, cur)}</dd></div>
      </dl>
    </section>
  )
}

/* ---------- Customer ---------- */

/** `customerName`: the name Yard's server gives (a real brand's orders); the sample orders look it up. */
export function CustomerPanel({ order: o, customerName }: { order: MerchantOrder; customerName?: string }) {
  const a = o.shippingAddress
  return (
    <Panel
      title="Ship to"
      className="min-w-0"
      description="Only what you need to fulfil this order."
      action={<InfoTip label="Why so little?" side="left">Email addresses, payment details and marketing preferences stay with the platform. You see the name, address, phone and shipping method needed to deliver.</InfoTip>}
    >
      <DefinitionList
        items={[
          { label: "Name", value: a.name },
          {
            label: "Address",
            value: (
              <address className="not-italic">
                {a.line1}
                <br />
                {a.city}
                {a.postcode ? ` ${a.postcode}` : ""}
                <br />
                {countryName(a.country)}
              </address>
            ),
          },
          { label: "Phone", value: a.phone ? <a href={`tel:${a.phone}`} className="tabular hover:text-violet">{a.phone}</a> : <span className="text-ink-3">Not given</span> },
          { label: "Shipping", value: o.shippingMethod.replace(" — ", ", ") },
        ]}
      />
      {customerName === undefined ? (
        <Link href={`/studio/customers?customer=${o.customerId}`} className="mt-4 inline-block text-xs text-violet hover:underline">
          {shopperName(o.customerId)}&apos;s orders with you
        </Link>
      ) : null}
    </Panel>
  )
}

/* ---------- Payout ---------- */

function PayoutPanel({ order: o, cur }: { order: MerchantOrder; cur: Brand["currency"] }) {
  const p = payoutEstimate(o)
  const description = p.voided
    ? o.status === "cancelled" ? "No payout for this order: it was cancelled." : "No payout for this order: the whole order is refunded."
    : o.status === "refund_requested"
      ? "On hold while the return is decided: Payouts counts it in Pending until then. Approving refunds some or all of it; declining releases it."
      : p.refunded
        ? `A partial refund was approved, so the returned ${p.refunded.lines.reduce((n, l) => n + l.quantity, 0) === 1 ? "item comes" : "items come"} off. An estimate until the returns window closes.`
        : "An estimate until the order completes and the returns window closes."
  return (
    <Panel title="Your payout" className="min-w-0" description={description}>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-ink-2">Item subtotal</dt><dd className="text-ink tabular">{formatMoney(p.subtotal, cur)}</dd></div>
        <div className="flex justify-between gap-4">
          <dt className="flex items-center gap-1 text-ink-2">
            Commission (5%)
            <InfoTip label="About the commission">5% of the item subtotal on completed sales. No monthly or listing fees. Commission is returned when an order is cancelled or refunded.</InfoTip>
          </dt>
          <dd className={cn("tabular", p.voided ? "text-ink-3 line-through" : "text-ink")}>−{formatMoney(p.commission, cur)}</dd>
        </div>
        {p.refunded ? (
          <>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Returned items ({plural(p.refunded.lines.reduce((n, l) => n + l.quantity, 0), "item")})</dt><dd className="text-ink tabular">−{formatMoney(p.refunded.subtotal, cur)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Commission returned on them</dt><dd className="text-ink tabular">+{formatMoney(p.refunded.commissionBack, cur)}</dd></div>
          </>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-line-soft pt-2">
          <dt className="text-ink">Estimated payout</dt>
          <dd className="text-lg font-medium text-ink tabular">{formatMoney(p.payout, cur)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-3">{moneyTaken(o) ? "Shipping paid by the customer" : "Shipping the customer pays"} covers delivery and isn&apos;t part of this estimate. See <Link href="/studio/payouts" className="text-violet hover:underline">Payouts</Link> for what&apos;s available.</p>
    </Panel>
  )
}

/* ---------- Timeline ---------- */

export function TimelinePanel({ order: o, tz }: { order: MerchantOrder; tz: string }) {
  const entries = o.timeline.map((t, i) => ({ ...t, i })).reverse()
  return (
    <Panel title="Timeline" className="min-w-0" description="Every change to this order, newest first. Entries can't be edited.">
      <ol className="relative grid gap-4">
        <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-line" />
        <AnimatePresence initial={false}>
          {entries.map((t, n) => (
            <motion.li key={`${t.i}-${t.label}`} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={spring.layout} className="relative flex gap-3">
              <span aria-hidden className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-card", n === 0 ? "bg-violet" : "bg-ink-3")} />
              <span className="grid min-w-0 gap-0.5">
                <span className={cn("text-sm", n === 0 ? "text-ink" : "text-ink-2")}>{t.label}</span>
                <span className="text-xs text-ink-3 tabular">{stampIn(t.at, tz)}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </Panel>
  )
}
