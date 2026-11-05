/**
 * Markets: currencies, countries and shipping zones.
 * Extensible by design — add a currency or country here; nothing else is hard-coded.
 * FX rates are static demo values (USD base) until the backend supplies daily rates.
 */

export const currencies = {
  USD: { code: "USD", symbol: "$", minor: 2, locale: "en-US", perUsd: 1 },
  NGN: { code: "NGN", symbol: "₦", minor: 2, locale: "en-NG", perUsd: 1520 },
  GBP: { code: "GBP", symbol: "£", minor: 2, locale: "en-GB", perUsd: 0.78 },
  EUR: { code: "EUR", symbol: "€", minor: 2, locale: "de-DE", perUsd: 0.92 },
  GHS: { code: "GHS", symbol: "GH₵", minor: 2, locale: "en-GH", perUsd: 15.4 },
  KES: { code: "KES", symbol: "KSh", minor: 2, locale: "en-KE", perUsd: 129 },
  ZAR: { code: "ZAR", symbol: "R", minor: 2, locale: "en-ZA", perUsd: 18.1 },
  JPY: { code: "JPY", symbol: "¥", minor: 0, locale: "ja-JP", perUsd: 151 },
  KRW: { code: "KRW", symbol: "₩", minor: 0, locale: "ko-KR", perUsd: 1370 },
  MXN: { code: "MXN", symbol: "MX$", minor: 2, locale: "es-MX", perUsd: 17.6 },
} as const

export type CurrencyCode = keyof typeof currencies
export const currencyCodes = Object.keys(currencies) as CurrencyCode[]

export type ShippingZone = "domestic" | "regional" | "international"

export const countries = {
  NG: { name: "Nigeria", currency: "NGN", region: "West Africa" },
  GH: { name: "Ghana", currency: "GHS", region: "West Africa" },
  KE: { name: "Kenya", currency: "KES", region: "East Africa" },
  ZA: { name: "South Africa", currency: "ZAR", region: "Southern Africa" },
  GB: { name: "United Kingdom", currency: "GBP", region: "Europe" },
  FR: { name: "France", currency: "EUR", region: "Europe" },
  DE: { name: "Germany", currency: "EUR", region: "Europe" },
  US: { name: "United States", currency: "USD", region: "North America" },
  MX: { name: "Mexico", currency: "MXN", region: "Latin America" },
  JP: { name: "Japan", currency: "JPY", region: "Asia" },
  KR: { name: "South Korea", currency: "KRW", region: "Asia" },
} as const

export type CountryCode = keyof typeof countries
export const countryCodes = Object.keys(countries) as CountryCode[]

export function shippingZone(from: CountryCode, to: CountryCode): ShippingZone {
  if (from === to) return "domestic"
  if (countries[from].region === countries[to].region) return "regional"
  return "international"
}

/** Demo shipping rates per brand order, in USD cents, by zone. */
export const shippingRatesUsd: Record<ShippingZone, { standard: number; express: number; days: [number, number] }> = {
  domestic: { standard: 600, express: 1400, days: [2, 4] },
  regional: { standard: 1500, express: 2800, days: [4, 8] },
  international: { standard: 2400, express: 4600, days: [6, 12] },
}

/** Free standard shipping per brand order above this subtotal (USD cents). */
export const freeShippingThresholdUsd = 20000
