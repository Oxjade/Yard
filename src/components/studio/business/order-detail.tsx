"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { ProhibitIcon as Ban, CheckIcon as Check, CopyIcon as Copy, SealCheckIcon as PackageCheck, XCircleIcon as PackageX, ShieldCheckIcon as ShieldCheck, TruckIcon as Truck, ArrowUUpLeftIcon as Undo2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { InfoTip } from "@/components/feedback/info-tip"
import { Button } from "@/components/ui/button"
import { brandById } from "@/lib/data/brands"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { spring } from "@/lib/motion"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { useBrandSettings, useSettingsReady } from "./settings-store"
import { CancelOrderDialog, DeclineRefundDialog, ApproveRefundDialog, TrackingDialog } from "./order-dialogs"
import { DEMO_NOW, DAY_MS, countryName, formatDateTime, formatDateYear, formatTime, formatWeekday, itemCount, paymentMeta, paymentState, payoutEstimate, plural, refundRequest, shipBy, shopperName } from "./model"
import { Panel } from "@/components/studio/catalog/fields"
import { Thumb } from "@/components/studio/catalog/parts"
import { BackLink, DefinitionList, useStudioReady } from "./shared"

export function OrderDetail({ id }: { id: string }) {
  const studioReady = useStudioReady()
  const settingsReady = useSettingsReady()
  const ready = studioReady && settingsReady
  const order = useStudio((s) => s.orders.find((o) => o.id === id))
  const brandId = useStudio((s) => s.brandId)
  const brand = brandById.get(brandId)!

  if (!ready) {
    return (
      <div role="status" aria-label="Loading order" className="grid gap-6">
        <div className="grid gap-2 border-b border-line-soft pb-5">
          <Bone className="h-3 w-16" />
          <Bone className="h-7 w-56" />
          <Bone className="h-4 w-72 max-w-full" />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Bone className="h-64 rounded-lg" />
          <Bone className="h-64 rounded-lg" />
        </div>
      </div>
    )
  }

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

type DialogKind = "tracking" | "cancel" | "approve" | "decline" | null

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
  const pay = paymentMeta[paymentState(o)]
  const verified = o.paymentStatus === "captured" || o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded"

  function markProcessing() {
    setOrderStatus(o.id, "processing", "Brand started processing")
    toast.success(`#${o.reference} is processing`, {
      description: "Add tracking when it ships.",
      action: { label: "Undo", onClick: () => useStudio.getState().setOrderStatus(o.id, "paid", "Moved back to To fulfil") },
    })
  }

  function markDelivered() {
    setOrderStatus(o.id, "delivered", "Marked delivered by brand")
    toast.success(`#${o.reference} marked delivered`, {
      description: "The returns window starts today. Your payout follows once it closes.",
      action: { label: "Undo", onClick: () => useStudio.getState().setOrderStatus(o.id, "shipped", "Delivery mark undone by brand") },
    })
  }

  let actions: React.ReactNode = null
  if (o.status === "paid") {
    actions = (
      <>
        <Button size="sm" variant="secondary" onClick={() => setDialog("tracking")}><Truck /> Add tracking</Button>
        <Button size="sm" variant="primary" onClick={markProcessing}><PackageCheck /> Mark as processing</Button>
      </>
    )
  } else if (o.status === "processing") {
    actions = <Button size="sm" variant="primary" onClick={() => setDialog("tracking")}><Truck /> Add tracking</Button>
  } else if (o.status === "shipped") {
    actions = (
      <>
        <Button size="sm" variant="secondary" onClick={() => setDialog("tracking")}>Edit tracking</Button>
        <Button size="sm" variant="primary" onClick={markDelivered}><Check /> Mark delivered</Button>
      </>
    )
  } else if (o.status === "refund_requested") {
    actions = (
      <>
        <Button size="sm" variant="secondary" onClick={() => setDialog("decline")}>Decline</Button>
        <Button size="sm" variant="primary" onClick={() => setDialog("approve")}><Undo2 /> Approve refund</Button>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/orders">Orders</BackLink>
        <PageHeader
          title={`Order #${o.reference}`}
          description={`Placed ${formatDateYear(o.placedAt)} at ${formatTime(o.placedAt)} UTC. ${plural(itemCount(o), "item")}, ${formatMoney(o.total, cur)}.`}
          actions={actions}
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge>
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <ShieldCheck className="size-3.5 text-violet" aria-hidden />
                {o.status === "refunded" || o.status === "cancelled" ? "Payment and refund verified by the payment provider" : "Verified by the payment provider"}
              </span>
            ) : null}
          </div>
        </PageHeader>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6 xl:col-start-1">
          {o.status === "refund_requested" ? <RefundPanel order={o} cur={cur} /> : null}
          <FulfilmentPanel order={o} onCancel={() => setDialog("cancel")} />
          <ItemsPanel order={o} cur={cur} />
        </div>

        <aside className="grid min-w-0 gap-6 xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-label="Customer and payout">
          <CustomerPanel order={o} />
          <PayoutPanel order={o} cur={cur} />
        </aside>

        <div className="min-w-0 xl:col-start-1">
          <TimelinePanel order={o} />
        </div>
      </div>

      <TrackingDialog open={dialog === "tracking"} onOpenChange={(v) => setDialog(v ? "tracking" : null)} order={o} brand={brand} />
      <CancelOrderDialog open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} order={o} />
      <ApproveRefundDialog open={dialog === "approve"} onOpenChange={(v) => setDialog(v ? "approve" : null)} order={o} />
      <DeclineRefundDialog open={dialog === "decline"} onOpenChange={(v) => setDialog(v ? "decline" : null)} order={o} />
    </div>
  )
}

/* ---------- Fulfilment ---------- */

function CopyNumber({ value }: { value: string }) {
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

function FulfilmentPanel({ order: o, onCancel }: { order: MerchantOrder; onCancel: () => void }) {
  const idx = stepIndex(o.status)
  // The processing time saved in Settings (seeded from the brand profile).
  const processingDays = useBrandSettings((s) => s.shipping.processingDays)
  const due = shipBy(o, processingDays)
  const daysLeft = Math.ceil((due - DEMO_NOW) / DAY_MS)
  const open = o.status === "paid" || o.status === "processing"
  const cancelReason = o.status === "cancelled" ? [...o.timeline].reverse().find((t) => /cancel/i.test(t.label))?.label : null

  const copy: Record<string, string> = {
    paid: "Paid and waiting for you. Mark it as processing when you start packing, or add tracking straight away if it's ready to go.",
    processing: "You're packing this order. Add the carrier and tracking number when it leaves the studio.",
    shipped: "On its way. Mark it delivered once the carrier confirms, or the customer confirms receipt.",
    delivered: "Delivered. The returns window is open; your payout follows once it closes.",
    refund_requested: "Delivered, and the customer has asked for a refund. Decide on the request above.",
    refunded: "Refunded in full to the customer.",
    cancelled: "Cancelled before shipping. The customer was refunded in full.",
    pending_payment: "Waiting for the payment provider to confirm payment. Don't ship until it's paid.",
  }

  return (
    <Panel
      title="Fulfilment"
      description={copy[o.status]}
      className="min-w-0"
      action={open ? (
        <StatusBadge tone={daysLeft <= 0 ? "attention" : "muted"} className="shrink-0 tabular">
          {daysLeft < 0 ? `Overdue since ${formatWeekday(due)}` : `Ship by ${formatWeekday(due)}`}
        </StatusBadge>
      ) : undefined}
    >
      {idx >= 0 ? (
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

      {open || o.status === "shipped" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft pt-4">
          {open ? (
            <>
              <p className="text-xs text-ink-3">You can cancel until it ships. The customer is refunded in full.</p>
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
  const at = [...o.timeline].reverse().find((t) => /refund/i.test(t.label))?.at ?? o.placedAt
  return (
    <Panel
      title="Refund requested"
      description={`Requested ${formatDateYear(at)}. Approve to refund ${formatMoney(o.total, cur)} in full, or decline with a reason the customer will see.`}
      action={<StatusBadge tone="attention" className="shrink-0">Needs a decision</StatusBadge>}
      className="min-w-0 border-acid/30"
    >
      <dl className="grid gap-3 rounded-md border border-line-soft bg-surface/60 p-3 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">Reason</dt>
          <dd className="text-ink">{req.reason}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-ink-3">Customer&apos;s note</dt>
          <dd className="text-ink-2">&ldquo;{req.note}&rdquo;</dd>
        </div>
      </dl>
    </Panel>
  )
}

/* ---------- Items ---------- */

function ItemsPanel({ order: o, cur }: { order: MerchantOrder; cur: Brand["currency"] }) {
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
        <div className="flex justify-between gap-4 border-t border-line-soft pt-2"><dt className="text-ink">Customer paid</dt><dd className="font-medium text-ink tabular">{formatMoney(o.total, cur)}</dd></div>
      </dl>
    </section>
  )
}

/* ---------- Customer ---------- */

function CustomerPanel({ order: o }: { order: MerchantOrder }) {
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
      <Link href={`/studio/customers?customer=${o.customerId}`} className="mt-4 inline-block text-xs text-violet hover:underline">
        {shopperName(o.customerId)}&apos;s orders with you
      </Link>
    </Panel>
  )
}

/* ---------- Payout ---------- */

function PayoutPanel({ order: o, cur }: { order: MerchantOrder; cur: Brand["currency"] }) {
  const p = payoutEstimate(o)
  return (
    <Panel title="Your payout" className="min-w-0" description={p.voided ? "No payout for this order: it was refunded in full." : "An estimate until the order completes and the returns window closes."}>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-ink-2">Item subtotal</dt><dd className="text-ink tabular">{formatMoney(p.subtotal, cur)}</dd></div>
        <div className="flex justify-between gap-4">
          <dt className="flex items-center gap-1 text-ink-2">
            Commission (5%)
            <InfoTip label="About the commission">5% of the item subtotal on completed sales. No monthly or listing fees. Commission is returned when an order is cancelled or refunded.</InfoTip>
          </dt>
          <dd className={cn("tabular", p.voided ? "text-ink-3 line-through" : "text-ink")}>−{formatMoney(p.commission, cur)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line-soft pt-2">
          <dt className="text-ink">Estimated payout</dt>
          <dd className="text-lg font-medium text-ink tabular">{formatMoney(p.payout, cur)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-3">Shipping paid by the customer covers delivery and isn&apos;t part of this estimate. See <Link href="/studio/payouts" className="text-violet hover:underline">Payouts</Link> for what&apos;s available.</p>
    </Panel>
  )
}

/* ---------- Timeline ---------- */

function TimelinePanel({ order: o }: { order: MerchantOrder }) {
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
                <span className="text-xs text-ink-3 tabular">{formatDateTime(t.at)}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </Panel>
  )
}
