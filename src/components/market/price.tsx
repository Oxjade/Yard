"use client"

import { createContext, useContext } from "react"
import { useHydrated } from "@/hooks/use-hydrated"
import { convert, formatMoney } from "@/lib/money"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { CurrencyCode } from "@/config/markets"

/**
 * Overrides the currency prices are shown in, for one subtree, without touching the shopper's
 * saved preference. The checkout uses it to show the currency it will charge in (Paystack can't
 * charge in every display currency) while the shopper's own choice stays as it was.
 */
export const PriceCurrencyContext = createContext<CurrencyCode | null>(null)

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
  const override = useContext(PriceCurrencyContext)
  // Before hydration: the default shopper's currency (Nigeria, NGN), so the usual case doesn't flash.
  const target = override ?? (hydrated ? shopper : "NGN")
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
