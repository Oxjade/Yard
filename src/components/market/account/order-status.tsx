import { CheckIcon as Check, ArrowSquareOutIcon as ExternalLink } from "@phosphor-icons/react/ssr"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { cn } from "@/lib/utils"
import type { MerchantOrder, MerchantOrderStatus } from "@/lib/data/types"

type Tone = NonNullable<React.ComponentProps<typeof StatusBadge>["tone"]>

/** The shopper's words for each order state (Studio uses the merchant's: "To fulfil", …). */
export const customerOrderStatus: Record<MerchantOrderStatus, { label: string; tone: Tone; note: string }> = {
  pending_payment: { label: "Awaiting payment", tone: "muted", note: "We'll confirm as soon as the payment provider does." },
  paid: { label: "Confirmed", tone: "neutral", note: "The brand has your order and will start preparing it soon." },
  processing: { label: "Being prepared", tone: "info", note: "The brand is packing your order. Tracking follows when it ships." },
  shipped: { label: "On its way", tone: "info", note: "Your parcel is with the carrier." },
  delivered: { label: "Delivered", tone: "success", note: "Delivered. Something not right? You can request a return." },
  cancelled: { label: "Cancelled", tone: "muted", note: "This order was cancelled before it shipped and you were refunded in full." },
  refund_requested: { label: "Return requested", tone: "attention", note: "The brand is reviewing your return request." },
  refunded: { label: "Refunded", tone: "muted", note: "Your refund was issued to your original payment method." },
}

export function OrderStatusBadge({ status, className }: { status: MerchantOrderStatus; className?: string }) {
  const meta = customerOrderStatus[status]
  return <StatusBadge tone={meta.tone} className={className}>{meta.label}</StatusBadge>
}

/** Carrier tracking pages, opened with the order's tracking number. */
export function trackingUrl(tracking: NonNullable<MerchantOrder["tracking"]>) {
  if (tracking.url) return tracking.url
  const n = encodeURIComponent(tracking.number)
  const carrier = tracking.carrier.toLowerCase()
  if (carrier.includes("dhl")) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`
  if (carrier.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`
  if (carrier.includes("royal mail")) return `https://www.royalmail.com/track-your-item#/tracking-results/${n}`
  return `https://parcelsapp.com/en/tracking/${n}`
}

export function TrackingLink({ tracking, className }: { tracking: NonNullable<MerchantOrder["tracking"]>; className?: string }) {
  return (
    <a
      href={trackingUrl(tracking)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1.5 text-xs text-violet underline-offset-4 hover:underline", className)}
    >
      Track with {tracking.carrier}
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(opens the carrier&apos;s site)</span>
    </a>
  )
}

// The same words as the status badge, so a step and its badge never disagree.
const steps = ["Confirmed", "Being prepared", "On its way", "Delivered"]
const stepIndex: Record<MerchantOrderStatus, number> = {
  pending_payment: -1,
  paid: 0,
  processing: 1,
  shipped: 2,
  delivered: 3,
  refund_requested: 3,
  refunded: 3,
  cancelled: -1,
}

/** Per-brand progress: Confirmed, Being prepared, On its way, Delivered. */
export function OrderStepper({ status }: { status: MerchantOrderStatus }) {
  const current = stepIndex[status]
  return (
    <ol className="grid grid-cols-4" aria-label="Order progress">
      {steps.map((label, i) => {
        const done = i <= current
        const isCurrent = i === current
        return (
          <li key={label} className="relative flex flex-col items-start" aria-current={isCurrent ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  done ? "border-violet bg-purple text-ink" : "border-line bg-obsidian text-ink-3",
                  isCurrent && "ring-4 ring-purple/20",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {i < steps.length - 1 ? <span className={cn("h-px flex-1", i < current ? "bg-violet" : "bg-line")} aria-hidden /> : null}
            </div>
            <span className={cn("mt-2 pr-2 text-xs leading-snug", done ? "text-ink" : "text-ink-3")}>
              {label}
              <span className="sr-only">{done ? ", done" : ", to come"}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
