import { CheckIcon as Check, ArrowSquareOutIcon as ExternalLink } from "@phosphor-icons/react/ssr"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { customerCheckoutGroups } from "@/lib/data/orders"
import { cn } from "@/lib/utils"
import type { MerchantOrder, MerchantOrderStatus } from "@/lib/data/types"

/**
 * The demo shopper's seeded order history is sample data: it shows how paid, shipped and
 * refunded orders read, and no payment was taken for any of it. Orders placed at checkout in
 * this browser are not sample (they stay awaiting payment until a provider confirms them).
 */
const sampleGroupIds = new Set(customerCheckoutGroups.map((g) => g.id))
export const isSampleCheckout = (groupId: string | undefined) => !!groupId && sampleGroupIds.has(groupId)

/** The quiet "Sample" mark, as notifications use it, beside a sample checkout's reference. */
export function SampleChip({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-[3px] border border-white/10 px-1.5 align-middle text-[10px] font-normal text-ink-3", className)}>
      Sample
    </span>
  )
}

type Tone = NonNullable<React.ComponentProps<typeof StatusBadge>["tone"]>

/** The shopper's words for each order state (Studio uses the merchant's: "To fulfil", …). */
export const customerOrderStatus: Record<MerchantOrderStatus, { label: string; tone: Tone; note: string }> = {
  pending_payment: { label: "Awaiting payment", tone: "muted", note: "Not charged yet. The brand starts preparing it once the payment provider confirms payment." },
  paid: { label: "Confirmed", tone: "neutral", note: "The brand has your order and will start preparing it soon." },
  processing: { label: "Being prepared", tone: "info", note: "The brand is packing your order. Tracking follows when it ships." },
  shipped: { label: "On its way", tone: "info", note: "Your parcel is with the carrier." },
  delivered: { label: "Delivered", tone: "success", note: "Delivered. Something not right? You can request a return." },
  cancelled: { label: "Cancelled", tone: "muted", note: "Cancelled before it shipped." },
  refund_requested: { label: "Return requested", tone: "attention", note: "The brand is reviewing your return request." },
  refunded: { label: "Refunded", tone: "muted", note: "Your refund was issued to your original payment method." },
}

type StatusInput = Pick<MerchantOrder, "status" | "paymentStatus"> & Partial<Pick<MerchantOrder, "returnRequest" | "refund">>

/**
 * How an order reads to the shopper once a return on it has been decided: approved (recorded,
 * not sent: no payment provider is connected in this build) or declined. Null otherwise.
 */
export function returnOutcome(order: StatusInput): { label: string; tone: Tone; note: string } | null {
  const d = order.returnRequest?.decision
  if (!d) return null
  if (d.status === "declined") return { label: "Return declined", tone: "muted", note: d.reason ? `Your return was declined: ${d.reason}.` : "Your return was declined." }
  const recorded = "It's approved and recorded, and goes back to how you paid once a payment provider is connected. Nothing has reached your card yet."
  return d.partial ? { label: "Partial refund approved", tone: "info", note: `A partial refund is approved for the items you returned. ${recorded}` } : { label: "Refund approved", tone: "info", note: `A refund for the whole order is approved. ${recorded}` }
}

/**
 * The status note for one order. A cancellation reads differently depending on whether the
 * order was ever paid: Studio can cancel unpaid orders, and nothing is refunded for those.
 * A decided return says what was decided.
 */
export function orderStatusNote(order: StatusInput) {
  const outcome = returnOutcome(order)
  if (outcome) return outcome.note
  if (order.status !== "cancelled") return customerOrderStatus[order.status].note
  if (order.paymentStatus === "pending" || order.paymentStatus === "failed") return "Cancelled before it was paid, so nothing was charged."
  if (order.paymentStatus === "refunded") return "Cancelled before it shipped, and marked refunded to your original payment method."
  return "Cancelled before it shipped. The refund goes back to your original payment method once the payment provider processes it."
}

/**
 * How a checkout's total reads, from its orders' payment states. "Total charged" only when
 * every order was captured; refunds, pending payments and unpaid cancellations say so instead.
 */
export function checkoutPayment(orders: StatusInput[]): { label: string; status: string; note?: string; tone?: "violet" | "muted" } {
  // An order cancelled before it was paid will never be charged. A refund approved in this
  // browser is recorded, not sent (no payment provider is connected).
  const states = orders.map((o) => (o.status === "cancelled" && (o.paymentStatus === "pending" || o.paymentStatus === "failed") ? "void" : o.refund ? "refund_recorded" : o.paymentStatus))
  const all = (...s: (typeof states)[number][]) => states.length > 0 && states.every((x) => s.includes(x))
  const some = (...s: (typeof states)[number][]) => states.some((x) => s.includes(x))
  if (all("void")) return { label: "Total", status: "Cancelled", note: "Cancelled before payment, nothing was charged", tone: "muted" }
  if (some("refund_recorded")) return { label: "Total charged", status: "Refund approved", note: "A refund is approved and recorded, not sent yet, see each order", tone: "muted" }
  if (all("pending")) return { label: "Total", status: "Awaiting confirmation", note: "Not charged, awaiting payment confirmation", tone: "violet" }
  if (some("pending")) return { label: "Total", status: "Partly awaiting confirmation", note: "Partly awaiting payment confirmation, see each order", tone: "violet" }
  if (all("captured")) return { label: "Total charged", status: "Confirmed" }
  if (all("authorized", "captured")) return { label: "Total", status: "Authorised", note: "Authorised, charged as each brand ships", tone: "muted" }
  if (all("refunded")) return { label: "Total", status: "Refunded in full", note: "Refunded in full", tone: "muted" }
  if (some("refunded", "partially_refunded")) return { label: "Total", status: "Partly refunded", note: "Partly refunded, see each order", tone: "muted" }
  if (some("void")) return { label: "Total", status: "Partly cancelled", note: "Partly cancelled, see each order", tone: "muted" }
  if (all("failed")) return { label: "Total", status: "Didn't go through", note: "Payment didn't go through, nothing was charged", tone: "muted" }
  return { label: "Total", status: "See each order", note: "See each order for its payment", tone: "muted" }
}

/**
 * The order's status badge. Pass the `order` (its status is read from it) so a decided return
 * reads as approved or declined, not just "Delivered". `status` alone is for callers with no
 * order record to hand.
 */
export function OrderStatusBadge({ status, order, className }: { className?: string } & ({ order: StatusInput; status?: MerchantOrderStatus } | { status: MerchantOrderStatus; order?: undefined })) {
  const meta = (order && returnOutcome(order)) ?? customerOrderStatus[status ?? order!.status]
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

/** The text is small, so a pseudo-element gives it a 40px tap target without moving anything. */
export function TrackingLink({ tracking, className }: { tracking: NonNullable<MerchantOrder["tracking"]>; className?: string }) {
  return (
    <a
      href={trackingUrl(tracking)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("relative inline-flex items-center gap-1.5 text-xs text-violet underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline", className)}
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
