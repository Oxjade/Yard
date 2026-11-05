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
  const key = `${currency}-${opts.compact ? "c" : ""}-${opts.showCents ? "s" : ""}`
  let f = formatters.get(key)
  if (!f) {
    const major = toMajor(amount, currency)
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
  return f.format(toMajor(amount, currency))
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
