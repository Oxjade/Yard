import { currencies, type CurrencyCode } from "@/config/markets"

/** Money is always integer minor units + a currency code. */
export type Money = { amount: number; currency: CurrencyCode }

export function toMajor(amount: number, currency: CurrencyCode) {
  return amount / 10 ** currencies[currency].minor
}

export function convert(amount: number, from: CurrencyCode, to: CurrencyCode) {
  if (from === to) return amount
  const majorFrom = toMajor(amount, from)
  const usd = majorFrom / currencies[from].perUsd
  const majorTo = usd * currencies[to].perUsd
  return Math.round(majorTo * 10 ** currencies[to].minor)
}

const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(
  amount: number,
  currency: CurrencyCode,
  opts: { compact?: boolean; showCents?: boolean } = {},
) {
  const c = currencies[currency]
  const major = toMajor(amount, currency)
  const key = `${currency}-${opts.compact ? "c" : ""}-${opts.showCents ? "s" : ""}`
  let f = formatters.get(key)
  if (!f) {
    const wantsCents = opts.showCents ?? !Number.isInteger(major)
    f = new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.compact ? 0 : wantsCents ? c.minor : 0,
      maximumFractionDigits: opts.compact ? 1 : c.minor,
    })
    if (opts.showCents !== undefined || opts.compact) formatters.set(key, f)
  }
  if (currency === "USD") return f.format(major)
  // Every currency shows the symbol the markets config gives it, the one the rest of the app
  // (Admin's operator amounts included) uses. Above all, a dollar currency other than the US
  // dollar (the Mexican peso's narrow sign is a bare "$") never reads as USD: "MX$6,400". It also
  // settles "Ksh" as "KSh" and the full-width "￥" as "¥". A symbol written before the number sits
  // against it, as every prefix symbol does here ("KSh8,296", "R8 296,00", not "KSh 8,296"); a
  // symbol after the number keeps its locale's space ("8.296,00 €"). The number keeps its
  // locale's grouping and symbol position.
  const parts = f.formatToParts(major)
  return parts
    .map((p, i) => (p.type === "currency" ? c.symbol : p.type === "literal" && parts[i - 1]?.type === "currency" && /^\s+$/.test(p.value) ? "" : p.value))
    .join("")
}

export function formatNumber(n: number, opts: { compact?: boolean } = {}) {
  return new Intl.NumberFormat("en-US", {
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(n)
}

export function formatPercent(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`
}
