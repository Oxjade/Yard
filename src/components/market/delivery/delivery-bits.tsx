"use client"

import { ArrowClockwiseIcon, ShieldWarningIcon, TruckIcon, WarningIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Price } from "@/components/market/price"
import type { CurrencyCode } from "@/config/markets"
import type { EstimateDto } from "@/lib/api/contracts/shipping"
import type { BrandGroup } from "@/lib/cart"
import { formatShortRange } from "@/lib/shipping/format"
import { cn } from "@/lib/utils"

/** "Est. arrival 11–16 Nov": always worded as an estimate (§10). */
export function ArrivalChip({ estimate, className, prefix = "Est. arrival" }: { estimate: Pick<EstimateDto, "arrivalFrom" | "arrivalTo"> | null | undefined; className?: string; prefix?: string }) {
  if (!estimate?.arrivalFrom || !estimate.arrivalTo) return null
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-[11px] whitespace-nowrap text-ink-2 tabular", className)}>
      <TruckIcon className="size-3" aria-hidden />
      {prefix} {formatShortRange(estimate.arrivalFrom, estimate.arrivalTo)}
    </span>
  )
}

/**
 * A delivery state that needs attention ("Running late", "Waiting for the brand"): a bordered ink
 * chip with a warning icon. Acid stays for the page's one primary action (house palette), and
 * purple for what's active or selected, so neither is used here.
 */
export function DeliveryFlag({ children, className, icon = true }: { children: React.ReactNode; className?: string; icon?: boolean }) {
  return (
    <span className={cn("inline-flex min-h-6 w-fit items-center gap-1.5 rounded-[5px] border border-white/15 px-2 py-0.5 text-[11px] font-medium text-ink", className)}>
      {icon ? <WarningIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Above brand-written text that scored like an off-platform payment request (§5.2), as Inbox shows it. */
export function PaymentsNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-ink-2", className)}>
      <ShieldWarningIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      Keep payments on Yard. Never pay a brand outside checkout.
    </p>
  )
}

/** A quiet Retry for a quote or estimate that couldn't load (a 40px target on phones). */
export function RetryButton({ onRetry, retrying, className, label = "Retry" }: { onRetry: () => void; retrying?: boolean; className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={retrying}
      className={cn(
        "-my-2 inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-violet disabled:text-ink-3 disabled:no-underline sm:min-h-8",
        className,
      )}
    >
      <ArrowClockwiseIcon className={cn("size-3.5", retrying && "motion-safe:animate-spin")} aria-hidden />
      {retrying ? "Retrying" : label}
    </button>
  )
}

export type QuoteState = { isLoading: boolean; error: unknown; retry: () => void; retrying?: boolean }

/**
 * The shipping amount for a total: a Bone while the quote loads, "Free" or the amount once it
 * has, and "Shipping not included" after a failure (never "Calculating shipping" after one).
 */
export function ShippingAmount({ amount, currency, state, className, unavailable }: { amount: number | null; currency: CurrencyCode; state: QuoteState; className?: string; unavailable?: boolean }) {
  if (amount !== null) return amount === 0 ? <span className={cn("text-sm", className)}>Free</span> : <Price amount={amount} currency={currency} className={className} />
  if (state.isLoading)
    return (
      <span role="status" className="inline-flex items-center">
        <span className="sr-only">Calculating shipping</span>
        <Bone className="h-4 w-16" />
      </span>
    )
  if (unavailable) return <span className={cn("text-sm text-ink-2", className)}>Not available</span>
  return <span className={cn("text-sm text-ink-2", className)}>Shipping not included</span>
}

/**
 * Each brand's estimated arrival in the bag: a chip once the quote has loaded, a Bone while it
 * loads, "Doesn't ship to Japan" for a brand that can't deliver there, and one line with Retry
 * when the quote couldn't load.
 */
export function BrandDeliveryList({ groups, state, className, title = "Delivery" }: { groups: BrandGroup[]; state: QuoteState; className?: string; title?: string }) {
  const failed = !state.isLoading && !!state.error && groups.every((g) => !g.quote)
  return (
    <section aria-label={title} className={cn("grid gap-2", className)}>
      {failed ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
          <TruckIcon className="size-3.5 shrink-0" aria-hidden />
          <span>Shipping is calculated at checkout</span>
          <RetryButton onRetry={state.retry} retrying={state.retrying} />
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {groups.map((g) => (
            <li key={g.brand.id} className="flex min-h-6 items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-ink-2">{g.brand.name}</span>
              {g.notForSale ? (
                <span className="shrink-0 text-ink-3">Not selling yet</span>
              ) : g.quote ? (
                g.unavailable ? (
                  <span className="shrink-0 text-ink-2">{g.reason ?? "Doesn't ship here"}</span>
                ) : (
                  <ArrivalChip estimate={g.estimate} />
                )
              ) : state.isLoading ? (
                <Bone className="h-5 w-32 rounded-full" />
              ) : (
                <span className="shrink-0 text-ink-3">Shipping is calculated at checkout</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
