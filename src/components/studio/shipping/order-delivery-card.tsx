"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { ChatCircleDotsIcon, WarningIcon } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { DeliveryFlag, PaymentsNotice, RetryButton } from "@/components/market/delivery/delivery-bits"
import { shipmentStatusLabels } from "@/components/market/delivery/order-delivery"
import { Panel } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { complaintKindLabels, complaintStatusLabels } from "@/lib/api/contracts/shipping"
import { errorMessage } from "@/lib/api/errors"
import { respondToComplaint } from "@/lib/api/shipping"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { formatDay, formatRange, formatShortRange } from "@/lib/shipping/format"
import { cn } from "@/lib/utils"
import { useStudioDelivery } from "./use-studio-delivery"

/**
 * Yard's delivery view of a Studio order (§6.5): the shopper's current estimate, the ship-by date
 * in business days, a Late badge, the shipment events Yard holds, and the shopper's delivery
 * problem with Respond. It needs a brand session; the rest of the order page keeps working from
 * this browser's data without one.
 */
export function OrderDeliveryCard({ order, brand }: { order: MerchantOrder; brand: Pick<Brand, "id" | "name"> }) {
  const s = useStudioDelivery(order.id)
  const d = s.data
  const uid = useId()
  const [reply, setReply] = useState("")
  const [replyError, setReplyError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  let body: React.ReactNode
  if (s.sessionLoading || s.isLoading) {
    body = (
      <div role="status" aria-label="Loading the delivery estimate" className="grid gap-2">
        <Bone className="h-4 w-40" />
        <Bone className="h-4 w-56" />
      </div>
    )
  } else if (!s.signedIn) {
    body = <p className="text-sm text-ink-2">Sign in to Brand Studio to see the shopper&apos;s delivery estimate and any delivery problem they report.</p>
  } else if (s.notOnServer) {
    body = (
      <p className="text-sm text-ink-2">
        {s.sessionBrand && s.sessionBrand.id !== brand.id
          ? `You're signed in for ${s.sessionBrand.name}, and this order is ${brand.name}'s sample data, so Yard's server doesn't show it to you.`
          : "Yard's server has no record of this order: it was placed in this browser before orders were registered. Its estimate stays in this browser."}
      </p>
    )
  } else if (!d) {
    body = (
      <p role="status" className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-2">
        Couldn&apos;t load the delivery estimate
        <span aria-hidden>·</span>
        <RetryButton onRetry={s.retry} retrying={s.retrying} />
      </p>
    )
  } else {
    const e = d.estimate
    const late = e.basis === "late" || e.basis === "exception"
    const c = d.complaint
    async function send(ev: React.FormEvent) {
      ev.preventDefault()
      if (sending) return
      const text = reply.trim()
      if (!text) {
        setReplyError("Write a reply first.")
        document.getElementById(`${uid}-reply`)?.focus()
        return
      }
      setSending(true)
      setReplyError(null)
      try {
        const r = await respondToComplaint(order.id, text)
        s.mutate((cur) => (cur ? { ...cur, complaint: r.complaint } : cur))
        setReply("")
      } catch (err) {
        setReplyError(errorMessage(err, "Your reply wasn't sent. Check your connection and try again."))
      } finally {
        setSending(false)
      }
    }
    body = (
      <div className="grid gap-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-xs text-ink-3">{e.deliveredOn ? "Delivered" : "Shopper's estimated arrival"}</dt>
            <dd className="text-ink tabular">{e.deliveredOn ? formatDay(e.deliveredOn) : e.arrivalFrom && e.arrivalTo ? formatRange(e.arrivalFrom, e.arrivalTo) : "Not available"}</dd>
          </div>
          {e.shipBy && !d.shippedOn ? (
            <div className="grid gap-0.5">
              <dt className="text-xs text-ink-3">Ship by</dt>
              <dd className="text-ink tabular">{formatDay(e.shipBy)}</dd>
            </div>
          ) : d.shippedOn ? (
            <div className="grid gap-0.5">
              <dt className="text-xs text-ink-3">Shipped</dt>
              <dd className="text-ink tabular">{formatDay(d.shippedOn)}</dd>
            </div>
          ) : null}
        </dl>
        {late && !e.deliveredOn && e.arrivalFrom && e.arrivalTo ? <DeliveryFlag>Late: the shopper sees a new estimate, {formatShortRange(e.arrivalFrom, e.arrivalTo)}</DeliveryFlag> : null}
        {d.events.length ? (
          <ul className="grid gap-1 text-xs text-ink-2" aria-label="Shipment updates Yard holds">
            {[...d.events].reverse().slice(0, 4).map((x) => (
              <li key={x.id}>
                {shipmentStatusLabels[x.status]}
                {x.carrier ? `, ${x.carrier}` : ""}
                <span className="text-ink-3">, {formatDay(x.occurredAt.slice(0, 10))}</span>
                {x.noteHeld ? <span className="block text-ink-3">Your note is held for review: Yard checks notes that ask for payment outside checkout, so the shopper doesn&apos;t see it.</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {c ? (
          <div className={cn("grid gap-3 rounded-md border px-3 py-3", c.status === "resolved" ? "border-line-soft" : "border-line")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-ink">
                <WarningIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
                Delivery problem: {complaintKindLabels[c.kind].toLowerCase()}
              </p>
              {/* Neutral tones: acid is the page's primary action, purple means active or selected. */}
              <StatusBadge tone={c.status === "resolved" || c.status === "brand_responded" ? "muted" : c.status === "escalated" ? "danger" : "neutral"}>{complaintStatusLabels[c.status]}</StatusBadge>
            </div>
            {c.details ? <p className="text-sm text-ink-2">&ldquo;{c.details}&rdquo;</p> : null}
            <p className="text-xs text-ink-3">
              Reported {formatDay(c.createdAt.slice(0, 10))}. Yard&apos;s support team steps in if it isn&apos;t sorted within 2 business days.
            </p>
            {c.brandResponse ? (
              <div className="grid gap-1.5">
                <p className="flex gap-2 text-sm text-ink">
                  <ChatCircleDotsIcon className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
                  <span>
                    <span className="text-ink-2">Your reply: </span>
                    {c.brandResponse}
                  </span>
                </p>
                {c.responseHeld ? (
                  <p className="text-xs text-ink-2">Held for review — Yard checks replies that ask for payment outside checkout. The shopper doesn&apos;t see it, and Yard&apos;s support team has the problem now.</p>
                ) : c.responseNotice ? (
                  <PaymentsNotice />
                ) : null}
              </div>
            ) : null}
            {c.status === "escalated" && !c.responseHeld ? <p className="text-xs text-ink-3">Yard&apos;s support team is handling this problem now. Your replies still reach the shopper.</p> : null}
            {c.status !== "resolved" ? (
              s.canFulfil ? (
                <form onSubmit={send} noValidate className="grid gap-2">
                  <label htmlFor={`${uid}-reply`} className="text-xs text-ink-2">
                    {c.brandResponse ? "Send another reply" : "Respond to the shopper"}
                  </label>
                  <Textarea
                    id={`${uid}-reply`}
                    value={reply}
                    onChange={(ev) => {
                      setReply(ev.target.value)
                      setReplyError(null)
                    }}
                    rows={3}
                    maxLength={1000}
                    aria-invalid={replyError ? true : undefined}
                    aria-describedby={replyError ? `${uid}-reply-error` : undefined}
                    placeholder="What's happening with the parcel, and when they can expect it."
                    className="min-h-20 bg-surface"
                  />
                  {replyError ? (
                    <p id={`${uid}-reply-error`} role="alert" className="text-xs text-danger">
                      {replyError}
                    </p>
                  ) : null}
                  {/* Secondary: the page header already carries the order's one primary action. */}
                  <Button type="submit" size="sm" variant="secondary" loading={sending} className="w-fit">
                    Respond
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-ink-3">Your role can&apos;t reply to delivery problems. Ask an owner or the fulfilment team.</p>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Panel
      id="delivery"
      title="Delivery"
      description="What the shopper sees. Estimates, not guarantees: they skip weekends and public holidays."
      className="min-w-0"
      action={
        <Link href="/studio/shipping" className="shrink-0 text-xs text-violet hover:underline">
          Shipping settings
        </Link>
      }
    >
      {body}
    </Panel>
  )
}
