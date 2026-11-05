"use client"

import { useHydrated } from "@/hooks/use-hydrated"
import { convert, formatMoney } from "@/lib/money"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { CurrencyCode } from "@/config/markets"

/**
 * Shows a price in the shopper's currency. Brands price in their own currency; the
 * conversion is indicative until checkout fixes the rate.
 */
export function Price({
  amount,
  currency,
  compareAt,
  className,
  size = "sm",
}: {
  amount: number
  currency: CurrencyCode
  compareAt?: number
  className?: string
  size?: "sm" | "md" | "lg"
}) {
  const hydrated = useHydrated()
  const shopper = useSession((s) => s.currency)
  const target = hydrated ? shopper : "USD"
  const value = formatMoney(convert(amount, currency, target), target)
  const was = compareAt ? formatMoney(convert(compareAt, currency, target), target) : null
  return (
    <span
      className={cn(
        "tabular inline-flex items-baseline gap-2 whitespace-nowrap",
        size === "lg" ? "text-2xl font-medium" : size === "md" ? "text-base" : "text-sm",
        className,
      )}
      title={currency !== target ? `Priced by the brand in ${currency}` : undefined}
    >
      <span className={cn(was && "text-acid")}>{value}</span>
      {was ? <s className="text-ink-3 decoration-ink-3/70">{was}</s> : null}
    </span>
  )
}
