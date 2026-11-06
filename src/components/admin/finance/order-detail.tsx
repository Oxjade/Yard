"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { ShieldWarningIcon as ShieldAlert, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { BrandMark } from "@/components/market/brand-mark"
import { countries, type CountryCode } from "@/config/markets"
import type { AuditEntry } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { CopyValue } from "../marketplace/bits"
import { DetailSection, DetailSheet, EmptyLine, Facts, LinkRow, insetClass } from "../marketplace/detail-sheet"
import { useLast } from "../marketplace/use-last"
import { orderEstimate } from "@/components/market/delivery/browser-estimate"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay, formatShortRange } from "@/lib/shipping/format"
import { disputeStage, groupState, orderTimeline, paymentEvents, providerFor, type OrderRow } from "./derive"
import { amountIn, formatWhen, providerName, signedUsd, usd } from "./format"
import { fulfilMeta, groupMeta, payMeta, txStatusMeta } from "./meta"

const countryName = (c: string) => countries[c as CountryCode]?.name ?? c
const num = (v: React.ReactNode) => <span className="tabular">{v}</span>

/**
 * One brand order in the context of its checkout: the sibling brand orders the same payment
 * created, the money events, and the timeline. Built on the Control Center's DetailSheet.
 * Read-only: an order is a record, so the only action is copying its reference.
 */
export function OrderDetail({ rows, id, open, onOpenChange, onSelect }: { rows: OrderRow[]; id: string | null; open: boolean; onOpenChange: (open: boolean) => void; onSelect: (id: string) => void }) {
  const audit = useAdmin((s) => s.audit)
  // Keep the last order while the sheet animates out.
  const shown = useLast(id)
  const row = shown ? rows.find((r) => r.order.id === shown) : undefined
  if (!row) return null
  return <OrderBody row={row} rows={rows} audit={audit} open={open} onOpenChange={onOpenChange} onSelect={onSelect} />
}

function OrderBody({ row, rows, audit, open, onOpenChange, onSelect }: { row: OrderRow; rows: OrderRow[]; audit: AuditEntry[]; open: boolean; onOpenChange: (open: boolean) => void; onSelect: (id: string) => void }) {
  const o = row.order
  const siblings = rows.filter((r) => r.order.groupId === o.groupId)
  const groupTotal = siblings.reduce((s, r) => s + r.totalUsd, 0)
  // A checkout nobody has paid for isn't "Confirmed": its payment state comes first.
  const gState = siblings.every((s) => s.pay === "pending") ? payMeta.pending : siblings.every((s) => s.pay === "failed") ? payMeta.failed : groupMeta[groupState(siblings.map((s) => s.order))]
  const stage = row.dispute ? disputeStage(row.dispute, audit) : undefined
  const events = paymentEvents(o, row.brand, row.refund, row.dispute, stage)
  const timeline = orderTimeline(o, audit, row)
  const net = o.total - o.commission
  const paid = row.pay === "paid"
  const unpaid = row.pay === "pending" || row.pay === "failed"
  // Delivery (§6.5): the order's stored estimate, else the same engine run here. Read after
  // hydration, as it can read the clock.
  const hydrated = useHydrated()
  const delivery = hydrated && o.status !== "cancelled" && o.status !== "refunded" ? orderEstimate(o) : null
  const late = !!delivery && !delivery.deliveredOn && (delivery.basis === "late" || delivery.basis === "exception")
  const deliveryFacts = delivery
    ? [
        { label: delivery.deliveredOn ? "Delivered" : "Est. arrival", value: delivery.deliveredOn ? formatDay(delivery.deliveredOn) : delivery.arrivalFrom && delivery.arrivalTo ? formatShortRange(delivery.arrivalFrom, delivery.arrivalTo) : "Not available" },
        { label: "Ship by", value: delivery.shipBy ? formatDay(delivery.shipBy) : o.tracking ? "Shipped" : "Not available" },
        { label: "Late", value: late ? "Yes, re-estimated" : "No" },
      ]
    : []
  const money = (v: number) => amountIn(v, o.currency)

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Order #${o.reference}`}
      description={`${row.brand.name}, placed ${formatWhen(o.placedAt)}`}
      lead={<BrandMark brand={row.brand} size="md" />}
      badges={
        <>
          <StatusBadge tone={payMeta[row.pay].tone}>{payMeta[row.pay].label}</StatusBadge>
          <StatusBadge tone={fulfilMeta[row.fulfil].tone}>{fulfilMeta[row.fulfil].label}</StatusBadge>
        </>
      }
      actions={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="max-w-xs text-[11.5px] leading-snug text-ink-3">Read-only. Amounts on an order never change; a refund or correction is a new ledger entry made in Finance.</p>
          <div className="flex items-center gap-3 text-[12px] text-ink-2">
            <CopyValue value={`#${o.reference}`} label="Copy order reference" className="min-h-10 sm:min-h-0" />
            <CopyValue value={row.groupRef} label="Copy checkout reference" className="min-h-10 sm:min-h-0" />
          </div>
        </div>
      }
    >
      {/* Keyed by order so moving to a sibling brand order cross-fades the body. */}
      <motion.div key={o.id} className="grid gap-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
        <DetailSection title="Checkout" aside={<StatusBadge tone={gState.tone}>{gState.label}</StatusBadge>}>
          <p className="text-[12px] text-ink-2">
            Checkout <span className="text-ink tabular">{row.groupRef}</span> {siblings.length === 1 ? "was one payment for one brand order." : `was one payment, split into ${siblings.length} brand orders. Each brand fulfils and refunds its own order.`}
          </p>
          <ul className={cn("divide-y divide-white/[0.07] overflow-hidden", insetClass)}>
            {siblings.map((s) => {
              const here = s.order.id === o.id
              return (
                <li key={s.order.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.order.id)}
                    disabled={here}
                    aria-current={here ? "true" : undefined}
                    className={cn("flex min-h-12 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset", here ? "bg-purple/[0.08]" : "hover:bg-white/[0.03]")}
                  >
                    <BrandMark brand={s.brand} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{s.brand.name}</span>
                      <span className="block truncate text-[11px] text-ink-3 tabular">
                        #{s.order.reference}
                        {here ? ", this order" : ""}
                      </span>
                    </span>
                    <StatusBadge tone={fulfilMeta[s.fulfil].tone}>{fulfilMeta[s.fulfil].label}</StatusBadge>
                    <span className="w-20 shrink-0 text-right text-[13px] text-ink tabular">{usd(s.totalUsd)}</span>
                  </button>
                </li>
              )
            })}
            <li className="flex items-center justify-between gap-3 bg-white/[0.02] px-3 py-2.5">
              <span className="text-[12px] text-ink-2">Checkout total</span>
              <span className="text-[13px] font-medium text-ink tabular">{usd(groupTotal)}</span>
            </li>
          </ul>
        </DetailSection>

        <DetailSection title="Amounts" aside={<span className="text-[11px] text-ink-3">{o.currency === "USD" ? "In USD" : `${o.currency}, with USD at the demo rate`}</span>}>
          <Facts
            items={[
              { label: "Items", value: num(money(o.subtotal)) },
              { label: "Shipping", value: num(money(o.shipping)) },
              { label: "Order total", value: num(money(o.total)) },
              { label: "Order total in USD", value: num(usd(row.totalUsd)) },
              // Only a paid order leaves the brand a share. One that was never paid shows the
              // commission it would carry, and nothing as received.
              { label: unpaid ? "Commission if paid, 5%" : "Commission, 5% of items", value: num(money(o.commission)) },
              paid ? { label: "Brand receives", value: num(money(net)) } : { label: "Payment provider", value: providerName[providerFor(row.brand)] },
            ]}
          />
        </DetailSection>

        <DetailSection title="Payment events" aside={<span className="text-[11px] text-ink-3">{providerName[events[0]?.provider ?? "stripe"]}</span>}>
          {events.length ? (
            <ol className={cn("divide-y divide-white/[0.07]", insetClass)}>
              {events.map((e) => (
                <li key={e.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink">{e.label}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
                        <time dateTime={e.at}>{formatWhen(e.at)}</time>
                        {e.verified === true ? (
                          <span className="inline-flex items-center gap-1 text-ink-2">
                            <ShieldCheck className="size-3 text-violet" aria-hidden /> Webhook verified
                          </span>
                        ) : e.verified === false ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <ShieldAlert className="size-3" aria-hidden /> Not verified
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {/* A failed event moved no money, so it carries no sign. */}
                      <span className={cn("text-[13px] tabular", e.status === txStatusMeta.failed ? "text-ink-3" : e.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{e.amountUsd === 0 ? usd(0) : e.status === txStatusMeta.failed ? usd(Math.abs(e.amountUsd)) : signedUsd(e.amountUsd)}</span>
                      <StatusBadge tone={e.status.tone}>{e.status.label}</StatusBadge>
                    </div>
                  </div>
                  {e.detail ? <p className="mt-1.5 text-[12px] text-ink-2">{e.detail}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyLine>Awaiting payment. Checkout created this order, but no payments provider is connected in this build, so nothing has been charged and the brand shouldn&apos;t ship it.</EmptyLine>
          )}
        </DetailSection>

        <DetailSection title="Items">
          <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
            {o.lines.map((l) => (
              <li key={l.variantId} className="flex items-center gap-3 px-3 py-2.5">
                <span className="relative h-11 w-9 shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.03]">
                  <Image src={l.image.src} alt="" fill sizes="36px" className="object-cover" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{l.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {l.variantLabel}, {l.quantity} × {money(l.unitPrice)}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] text-ink tabular">{money(l.unitPrice * l.quantity)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="Timeline">
          <ol className={cn("relative grid gap-3 p-3", insetClass)}>
            {timeline.map((t, i) => {
              const sameTime = i > 0 && timeline[i - 1].at === t.at
              return (
                <li key={t.id} className="relative flex gap-3">
                  <span className="relative flex w-3 shrink-0 justify-center pt-1" aria-hidden>
                    <span className={cn("size-2 rounded-full", t.who ? "bg-violet" : i === timeline.length - 1 ? "bg-ink" : "bg-ink-3")} />
                    {i < timeline.length - 1 ? <span className="absolute top-3.5 -bottom-3 w-px bg-white/10" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{t.label}</p>
                    {t.who || !sameTime ? (
                      <p className="text-[11px] text-ink-3">
                        {sameTime ? null : <time dateTime={t.at}>{formatWhen(t.at)}</time>}
                        {t.who ? `${sameTime ? "" : ", "}by ${t.who}` : null}
                      </p>
                    ) : null}
                    {t.detail ? <p className="mt-0.5 text-[12px] text-ink-2">{t.detail}</p> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </DetailSection>

        <DetailSection title="Customer and delivery">
          <Facts
            items={[
              { label: "Customer", value: row.customer.name },
              { label: "Email", value: row.customer.email },
              { label: "Ship to", value: `${o.shippingAddress.city}, ${countryName(o.shippingAddress.country)}` },
              { label: "Method", value: o.shippingMethod.replace(" — ", ", ") },
              { label: "Carrier", value: o.tracking?.carrier ?? "Not shipped yet" },
              { label: "Tracking", value: o.tracking ? num(o.tracking.number) : "Not shipped yet" },
              ...deliveryFacts,
            ]}
          />
          {delivery ? <p className="mt-2 text-[11px] text-ink-3">{delivery.source === "server" ? "Yard's estimate when the order was placed or last updated in this browser." : "Estimated in this browser from the brand's handling time and the holiday calendar."} Estimates, never guaranteed.</p> : null}
        </DetailSection>

        <DetailSection title="Links">
          <ul className="grid gap-1.5">
            {row.refund ? (
              <li>
                <LinkRow href={`/admin/finance?tab=refunds&focus=${row.refund.id}`} label="Refund in Finance" hint={`Idempotency key ${row.refund.idempotencyKey}`} />
              </li>
            ) : null}
            {row.dispute ? (
              <li>
                <LinkRow href={`/admin/finance?tab=disputes&focus=${row.dispute.id}`} label={row.dispute.type === "chargeback" ? "Chargeback in Finance" : "Inquiry in Finance"} hint={`${row.dispute.reason}, ${usd(row.dispute.amountUsd)}`} />
              </li>
            ) : null}
            <li>
              <LinkRow href={`/admin/brands?review=app_${row.brand.handle}`} label="Brand" hint={`${row.brand.name}, verification and activity`} />
            </li>
          </ul>
        </DetailSection>
      </motion.div>
    </DetailSheet>
  )
}
