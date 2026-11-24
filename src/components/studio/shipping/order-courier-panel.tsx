"use client"

import { useRef, useState } from "react"
import { ArrowSquareOutIcon, PrinterIcon, TruckIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import type { StudioCourierDto } from "@/lib/api/contracts/shipping"
import { errorMessage } from "@/lib/api/errors"
import { bookCourierPickup, getStudioCourier, studioCourierKey } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"

/**
 * The courier side of a Studio order (docs/SHIPPING.md): which courier the shopper paid for, the
 * "Book pickup" action, and once booked the courier, tracking code, label and print link. Booking
 * is idempotent on the server; here a click is also ignored while one is in flight.
 */

export function useStudioCourier(orderId: string) {
  return useApi<StudioCourierDto>(studioCourierKey(orderId), () => getStudioCourier(orderId), { revalidateOnFocus: true })
}

const money = (minor: number, currency: string) => {
  try {
    return formatMoney(minor, currency as CurrencyCode)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

const stateMeta: Record<string, { label: string; tone: "success" | "info" | "attention" | "danger" | "muted" }> = {
  booking: { label: "Booking…", tone: "info" },
  booked: { label: "Pickup booked", tone: "info" },
  in_transit: { label: "With the courier", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled by courier", tone: "danger" },
  failed: { label: "Not booked", tone: "attention" },
  needs_review: { label: "Being checked", tone: "attention" },
}

/** Books the pickup; shared by the header button and the panel. */
export function useBookPickup(orderId: string, onBooked: () => void) {
  const q = useStudioCourier(orderId)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  async function book() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const r = await bookCourierPickup(orderId)
      q.mutate(r)
      const s = r.shipment
      const diff = s && s.priceDiffMinor > 0 ? ` The courier's price went up by ${money(s.priceDiffMinor, s.currency)}; Yard covers it.` : ""
      toast.success(`Pickup booked with ${s?.courierName ?? "the courier"}`, { description: `${s?.trackingCode ? `Tracking ${s.trackingCode}. ` : ""}Print the label and have the parcel ready.${diff}` })
      onBooked()
    } catch (e) {
      toast.error(errorMessage(e))
      void q.revalidate()
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return { q, book, pending }
}

export function OrderCourierPanel({ orderId, canFulfil, onBooked }: { orderId: string; canFulfil: boolean; onBooked: () => void }) {
  const { q, book, pending } = useBookPickup(orderId, onBooked)
  const d = q.data
  if (!d || !d.courierOrder) return null
  const s = d.shipment
  const booked = !!s && ["booked", "in_transit", "delivered"].includes(s.status)
  const meta = s ? stateMeta[s.status] : null
  const canBook = canFulfil && !booked && !d.refusal && s?.status !== "needs_review" && s?.status !== "booking"

  return (
    <Panel
      id="courier"
      title="Courier"
      description={d.choice ? `The shopper paid ${money(d.choice.amountMinor, d.choice.currency)} for ${d.choice.name}${d.choice.eta ? ` (${d.choice.eta})` : ""}. Yard pays the courier; it isn't part of your earnings.` : undefined}
      action={meta ? <StatusBadge tone={meta.tone} className="shrink-0">{meta.label}</StatusBadge> : <StatusBadge tone="attention" className="shrink-0">To book</StatusBadge>}
      className="min-w-0"
    >
      {booked && s ? (
        <div className="grid gap-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-0.5">
              <dt className="text-xs text-ink-3">Courier</dt>
              <dd className="text-ink">{s.courierName ?? "Courier"}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs text-ink-3">Tracking</dt>
              <dd className="tabular text-ink">{s.trackingCode ?? "Not issued yet"}</dd>
            </div>
          </dl>
          {s.priceDiffMinor > 0 ? <p className="text-xs text-ink-2">The courier&apos;s price had gone up by {money(s.priceDiffMinor, s.currency)} when you booked. Yard covered the difference.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <a href={s.printUrl} target="_blank" rel="noopener">
                <PrinterIcon /> Print label
              </a>
            </Button>
            {s.labelUrl ? (
              <Button asChild size="sm" variant="secondary">
                <a href={s.labelUrl} target="_blank" rel="noopener noreferrer">
                  <ArrowSquareOutIcon /> Courier waybill
                </a>
              </Button>
            ) : null}
            {s.trackingUrl ? (
              <Button asChild size="sm" variant="secondary">
                <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">
                  <TruckIcon /> Track
                </a>
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-ink-3">The courier&apos;s updates move this order along by themselves: picked up, then delivered. The shopper is told at each step.</p>
        </div>
      ) : (
        <div className="grid gap-3 text-sm">
          {s?.error && (s.status === "failed" || s.status === "needs_review") ? (
            <p role="status" className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-ink-2">
              <WarningCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {s.error}
            </p>
          ) : null}
          {d.refusal ? (
            <p className="text-ink-2">{d.refusal}</p>
          ) : (
            <p className="text-ink-2">When the parcel is packed, book the pickup. The courier collects from your pickup address; Yard pays it from its courier wallet.</p>
          )}
          {canFulfil ? (
            canBook ? (
              <Button type="button" size="sm" variant="secondary" className="w-fit" loading={pending} onClick={() => void book()}>
                <TruckIcon /> Book pickup
              </Button>
            ) : null
          ) : (
            <p className="text-xs text-ink-3">Booking the pickup needs the Fulfilment, Admin or Owner role.</p>
          )}
        </div>
      )}
    </Panel>
  )
}
