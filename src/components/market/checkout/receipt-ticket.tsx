"use client"

import { useState } from "react"
import { BankIcon, CheckIcon, ConfettiIcon, CopyIcon, CreditCardIcon, DeviceMobileIcon } from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
import { toast } from "sonner"
import { checkoutPayment, customerOrderStatus } from "@/components/market/account/order-status"
import { formatOrderMoney } from "@/components/market/account/format"
import { orderEstimate } from "@/components/market/delivery/browser-estimate"
import { useHydrated } from "@/hooks/use-hydrated"
import { barcodeBars, canEncode128B } from "@/lib/barcode128"
import { brandById } from "@/lib/data/brands"
import { spring } from "@/lib/motion"
import { formatRange } from "@/lib/shipping/format"
import { cn } from "@/lib/utils"
import type { CheckoutGroup, MerchantOrder, MerchantOrderStatus, PaymentSnapshot } from "@/lib/data/types"
import { methodFromLabel } from "./shipping"

/** The receipt's one sentence per state (§6.6, used verbatim in §9.10 and §10). */
export const receiptLine = {
  paid: "Your order has been placed.",
  awaiting: "Order received — awaiting payment confirmation. Nothing was charged.",
  sample: "Sample order history for the demo account.",
} as const

/** What placeCheckout stores about payment: words only (method, holder, card brand, last four). */
type ReceiptPayment = PaymentSnapshot & { label?: string; holder?: string; cardBrand?: string; last4?: string }

/** States in which a delivery estimate still means something. */
const expecting = new Set<MerchantOrderStatus>(["pending_payment", "paid", "processing", "shipped"])

// Paper text: labels #4a4a4a (over 7:1 on the #f5f5f5 paper), values #080808. The labels are
// written in sentence case and uppercased by class, so screen readers don't read capitals.
const label = "text-[11px] font-medium uppercase tracking-wide text-[#4a4a4a]"

// Notches: 20px half-circles cut at the perforation's ends, half from the section above it and
// half from the one below. The scalloped foot is a 14px strip with 7px bites along its bottom.
// A browser without CSS masks ignores them and shows plain rounded corners (§6.6 fallback).
// (Class strings are written out in full so Tailwind finds them.)
const notchBelow =
  "[mask-image:radial-gradient(circle_at_0_100%,transparent_10px,#000_10.5px),radial-gradient(circle_at_100%_100%,transparent_10px,#000_10.5px)] [mask-composite:intersect]"
const notchAbove =
  "[mask-image:radial-gradient(circle_at_0_0,transparent_10px,#000_10.5px),radial-gradient(circle_at_100%_0,transparent_10px,#000_10.5px)] [mask-composite:intersect]"
const scallop = "[mask-image:radial-gradient(circle_at_50%_100%,transparent_7px,#000_7.5px)] [mask-size:18px_100%] [mask-repeat:repeat-x] [mask-position:center_bottom]"

/**
 * The ticket receipt on the order confirmation (§6.6, after the owner's pin 5mhMDERMG.jpg): a light
 * paper ticket on the black page. Confetti and "Thank you!", the one sentence for the checkout's
 * state, a perforation with notches, the order ID and total, the date and time in the shopper's
 * zone, the payment method (never a card number: the holder and the last four, with "Not
 * charged" while nothing has been charged), each brand's estimated arrival, a tear line, a Code
 * 128 barcode of the reference and a scalloped bottom edge. Nothing on it says money moved.
 */
export function ReceiptTicket({ group, orders, sample, holder, className }: { group: CheckoutGroup; orders: MerchantOrder[]; sample: boolean; holder?: string; className?: string }) {
  const reduce = useReducedMotion()
  const hydrated = useHydrated()
  const payment = checkoutPayment(orders)
  const paid = payment.status === "Confirmed"
  const line = sample ? receiptLine.sample : paid ? receiptLine.paid : receiptLine.awaiting
  const snap = group.payment as ReceiptPayment | undefined
  const notCharged = !sample && !paid
  return (
    <motion.section
      aria-labelledby="receipt-title"
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.snappy}
      className={cn("mx-auto w-full min-w-0 max-w-md text-obsidian [filter:drop-shadow(0_1px_0_rgba(0,0,0,0.6))] print:[filter:none]", className)}
    >
      {/* Top: confetti, thanks and the state's sentence. */}
      <div className={cn("rounded-t-[10px] bg-ink px-6 pt-8 pb-6 text-center print:bg-white", notchBelow)}>
        <ConfettiIcon weight="duotone" className="mx-auto size-10 text-purple" aria-hidden />
        <h2 id="receipt-title" className="mt-3 font-display text-[2rem] leading-none text-obsidian">
          Thank you!
        </h2>
        <p className="mx-auto mt-3 max-w-[18rem] text-sm leading-relaxed text-[#4a4a4a]">{line}</p>
      </div>

      {/* The perforation, then the details. */}
      <div className={cn("bg-ink px-6 pt-6 pb-6 print:bg-white", notchAbove)}>
        <div aria-hidden className="-mt-6 mb-6 border-t-2 border-dashed border-[#c9c9c9]" />
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-5">
          <div className="min-w-0">
            <dt className={label}>Order ID</dt>
            <dd className="mt-1 flex items-center gap-1">
              <span className="truncate text-[15px] font-medium tabular">{group.reference}</span>
              <CopyReference value={group.reference} />
            </dd>
          </div>
          <div className="text-right">
            {/* "Total", never "Paid" or "charged": only a provider-confirmed live checkout says more. */}
            <dt className={label}>{paid && !sample ? payment.label : "Total"}</dt>
            <dd className="mt-1 text-[15px] font-medium tabular">{formatOrderMoney(group.total, group.currency)}</dd>
          </div>
          <div className="col-span-2">
            <dt className={label}>Date &amp; time</dt>
            <dd className="mt-1 text-[15px] font-medium tabular">{hydrated ? formatWhen(group.placedAt) : <span className="inline-block h-4 w-40 rounded-md bg-obsidian/10 align-middle" aria-hidden />}</dd>
          </div>
        </dl>

        <div className="mt-5 rounded-lg bg-obsidian/[0.05] p-3.5 print:border print:border-[#ddd]">
          <p className={label}>Payment method</p>
          <div className="mt-2 flex items-center gap-3">
            <PaymentIcon snap={snap} />
            {/* On a narrow ticket the tag drops under the words instead of cutting them short. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{snap?.holder || holder || "Demo shopper"}</p>
                <p className="truncate text-[13px] text-[#4a4a4a] tabular">{methodLine(snap)}</p>
              </div>
              {notCharged ? (
                <span className="shrink-0 rounded-full border border-obsidian/15 px-2.5 py-1 text-[11px] font-medium text-[#4a4a4a]">Not charged</span>
              ) : sample ? (
                <span className="shrink-0 rounded-[3px] border border-obsidian/15 px-1.5 py-0.5 text-[10px] text-[#4a4a4a]">Sample</span>
              ) : null}
            </div>
          </div>
        </div>

        <ul className="mt-5 grid gap-2.5" aria-label="Each brand's order">
          {orders.map((o) => (
            <BrandArrival key={o.id} order={o} hydrated={hydrated} />
          ))}
        </ul>
      </div>

      {/* Tear line, then the barcode of the reference. */}
      <div className="bg-ink px-6 pt-0 pb-3 print:bg-white">
        <div aria-hidden className="border-t-2 border-dashed border-[#c9c9c9]" />
        <Barcode value={group.reference} className="mt-5" />
      </div>
      <div aria-hidden className={cn("h-3.5 rounded-b-[10px] bg-ink print:bg-white", scallop)} />
    </motion.section>
  )
}

/** "6 Nov 2026, 17:42" in the shopper's own zone (read after hydration). */
function formatWhen(iso: string) {
  const d = new Date(iso)
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
  return `${day}, ${time}`
}

/** "Mastercard •••• 8237", "Bank transfer", "MTN MoMo": the words the shopper chose, never a number beyond the last four. */
function methodLine(p: ReceiptPayment | undefined) {
  if (!p) return "Card"
  if (p.last4) return `${p.cardBrand ?? "Card"} •••• ${p.last4}`
  // The network only ("MTN MoMo"): the summary the shopper saw also holds their number.
  if (p.method === "Mobile money") return p.label?.split(",")[0]?.trim() || "Mobile money"
  if (p.method === "Bank transfer") return p.label === "Instant EFT" ? "Instant EFT" : "Bank transfer"
  return p.label || p.method || "Card"
}

function PaymentIcon({ snap }: { snap: ReceiptPayment | undefined }) {
  const method = snap?.method ?? "Card"
  const Icon = /bank|ussd/i.test(method) ? BankIcon : /mobile/i.test(method) ? DeviceMobileIcon : CreditCardIcon
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink ring-1 ring-obsidian/10 print:bg-white">
      <Icon className="size-[18px] text-obsidian" aria-hidden />
    </span>
  )
}

/** One brand's line: its name and estimated arrival (or where the order stands). */
function BrandArrival({ order, hydrated }: { order: MerchantOrder; hydrated: boolean }) {
  const brand = brandById.get(order.brandId)
  const pickup = methodFromLabel(order.shippingMethod) === "pickup"
  let value: React.ReactNode
  if (!expecting.has(order.status)) value = customerOrderStatus[order.status].label
  else if (!hydrated) value = <span className="inline-block h-3.5 w-28 rounded-md bg-obsidian/10 align-middle" aria-hidden />
  else {
    const e = orderEstimate(order)
    value = e.arrivalFrom && e.arrivalTo ? `${pickup ? "Est. ready" : "Est. arrival"} ${formatRange(e.arrivalFrom, pickup ? e.arrivalFrom : e.arrivalTo)}` : "Estimate not available"
  }
  return (
    // The arrival wraps under the name when both don't fit, so neither is cut short.
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
      <span className="min-w-0 truncate font-medium">{brand?.name ?? "Brand"}</span>
      <span className="ml-auto shrink-0 text-right text-[#4a4a4a] tabular">{value}</span>
    </li>
  )
}

/** The reference as Code 128B bars (decorative: the reference is printed under it as text). */
function Barcode({ value, className }: { value: string; className?: string }) {
  if (!canEncode128B(value)) return <p className={cn("text-center text-sm tabular", className)}>{value}</p>
  const { bars, width } = barcodeBars(value)
  return (
    <div className={className}>
      <svg data-barcode={value} aria-hidden viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" className="block h-14 w-full text-obsidian">
        {bars.map(([x, w]) => (
          <rect key={x} x={x} y={0} width={w} height={40} fill="currentColor" />
        ))}
      </svg>
      <p className="mt-1.5 text-center text-xs tracking-[0.2em] text-[#4a4a4a] tabular">{value}</p>
    </div>
  )
}

function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy the order ID", { description: "Select it and copy it instead." })
    }
  }
  // The check in place is the confirmation; a toast would repeat it.
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy order ID"
        className="-my-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-[#4a4a4a] transition-[background-color,color,scale] duration-150 hover:bg-obsidian/[0.06] hover:text-obsidian focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none active:scale-95 motion-reduce:transition-none print:hidden"
      >
        {copied ? <CheckIcon weight="bold" className="size-4 text-purple" /> : <CopyIcon className="size-4" />}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Order ID copied" : ""}
      </span>
    </>
  )
}
