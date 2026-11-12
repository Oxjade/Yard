import "server-only"
import { getEnv } from "../env"
import { BACHS_CURRENCIES, type BachsCurrency } from "./bachs-core"

/**
 * Payment configuration, read from the environment on each call (no import-time parsing, so
 * `next build` never needs the keys). YARD_PAYMENTS picks the provider (env.ts):
 * - "paystack": PAYSTACK_SECRET_KEY charges for real (sk_live_…) or in Paystack's test mode.
 * - "bachs": BACHS_SECRET_KEY (sk_live_…) collects through Bachs hosted checkout into Yard's own
 *   Bachs account; Yard's ledger and payout batches pay brands (no Bachs Connect, no split).
 *   See docs/BACHS.md.
 * - "off" (production's default): no provider is connected, so checkout is closed. Starting,
 *   resuming and verifying a checkout answer 503 "Payments open soon" before anything is written;
 *   carts, browsing, accounts, brands and Studio all keep working.
 * - "stub" (development, or an isolated demo deployment): never charges, never reports a charge as
 *   successful on its own, and every response says so.
 */
export type PaymentsConfig = {
  provider: "paystack" | "bachs" | "stub" | "off"
  /** PAYSTACK_SECRET_KEY, only while YARD_PAYMENTS=paystack (never the Bachs key: payout recipients send this one to Paystack). */
  secretKey: string | null
  publicKey: string | null
  /** Webhook signature keys to try, in order (PAYSTACK_WEBHOOK_SECRET, then the secret key). */
  webhookKeys: string[]
  /** Bachs credentials, only while YARD_PAYMENTS=bachs. */
  bachs: BachsConfig | null
  /** Split payments / subaccounts. Off unless PAYSTACK_SPLIT=subaccount; the split itself is stubbed. */
  split: "off" | "subaccount"
  /** Where the provider sends the shopper back after paying (or cancelling). */
  callbackUrl: (checkoutId: string) => string
  /** Minutes a pending checkout holds stock before the expiry job releases it. */
  holdMinutes: number
}

export type BachsConfig = {
  secretKey: string
  /** BACHS_WEBHOOK_SECRET (the endpoint's whsec_… signing secret); empty when not set (every webhook is then refused). */
  webhookSecrets: string[]
  /** https://api.bachs.io (sk_live_) or https://sandbox-api.bachs.io (sk_sandbox_), unless BACHS_API_BASE says otherwise. */
  apiBase: string
  live: boolean
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

/** Currencies Paystack can charge in that Yard also sells in. */
export const PAYSTACK_CURRENCIES = ["NGN", "GHS", "ZAR", "KES", "USD"] as const
export type ChargeCurrency = (typeof PAYSTACK_CURRENCIES)[number]
export const isChargeCurrency = (c: string): c is ChargeCurrency => (PAYSTACK_CURRENCIES as readonly string[]).includes(c)

const listFrom = <T extends string>(raw: string | undefined, allowed: readonly T[]): T[] =>
  (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is T => (allowed as readonly string[]).includes(c))
    .filter((c, i, a) => a.indexOf(c) === i)

/**
 * The currencies this deployment can actually charge in. Paystack enables currencies per account
 * (a Nigerian account takes NGN; GHS, KES, ZAR and USD each need Paystack to switch them on), so
 * with a key set this is NGN alone unless PAYSTACK_CHARGE_CURRENCIES lists more (comma separated,
 * e.g. "NGN,USD"; anything outside PAYSTACK_CURRENCIES is ignored). Bachs works the same way with
 * BACHS_CHARGE_CURRENCIES (default NGN; from NGN, GHS, KES, USD — Bachs has no ZAR). The stub
 * charges nothing, so it takes all of them. Read at request time. Checkout refuses any other
 * currency before it creates an order or holds stock.
 */
export function chargeCurrencies(): ChargeCurrency[] {
  // The stub charges nothing, and with payments off nothing is charged yet: carts and prices show
  // in every currency Yard sells in (checkout itself is closed when off).
  const mode = paymentsMode()
  if (mode === "stub" || mode === "off") return [...PAYSTACK_CURRENCIES]
  if (paymentsConfig().provider === "bachs") {
    const listed = listFrom<BachsCurrency>(process.env.BACHS_CHARGE_CURRENCIES, BACHS_CURRENCIES)
    return listed.length ? listed : ["NGN"]
  }
  const listed = listFrom<ChargeCurrency>(process.env.PAYSTACK_CHARGE_CURRENCIES, PAYSTACK_CURRENCIES)
  return listed.length ? listed : ["NGN"]
}

/** What a shopper is told while YARD_PAYMENTS=off (checkout 503s and the checkout page). */
export const PAYMENTS_OFF_MESSAGE = "Payments open soon. Your cart is saved — you can place your order once payments open."

function bachsConfig(): BachsConfig | null {
  const secretKey = blank(process.env.BACHS_SECRET_KEY)
  if (!secretKey) return null
  const live = secretKey.startsWith("sk_live_")
  const apiBase = (blank(process.env.BACHS_API_BASE) ?? (live ? "https://api.bachs.io" : "https://sandbox-api.bachs.io")).replace(/\/+$/, "")
  const hook = blank(process.env.BACHS_WEBHOOK_SECRET)
  return { secretKey, webhookSecrets: hook ? [hook] : [], apiBase, live }
}

export function paymentsConfig(): PaymentsConfig {
  const env = getEnv()
  // Only the provider in use gets its key: with payments off or on the stub, a key in the
  // environment is never sent anywhere.
  const secretKey = env.payments === "paystack" ? blank(process.env.PAYSTACK_SECRET_KEY) : null
  const webhookSecret = env.payments === "paystack" ? blank(process.env.PAYSTACK_WEBHOOK_SECRET) : null
  const bachs = env.payments === "bachs" ? bachsConfig() : null
  const origin = env.publicOrigin
  return {
    provider: env.payments === "paystack" && secretKey ? "paystack" : env.payments === "bachs" && bachs ? "bachs" : env.payments === "off" ? "off" : "stub",
    secretKey,
    publicKey: env.payments === "paystack" ? blank(process.env.PAYSTACK_PUBLIC_KEY) : null,
    webhookKeys: [webhookSecret, secretKey].filter((k): k is string => !!k).filter((k, i, a) => a.indexOf(k) === i),
    bachs,
    split: process.env.PAYSTACK_SPLIT === "subaccount" ? "subaccount" : "off",
    // Straight to the confirmation, which verifies first (paid=1) and then follows the server.
    callbackUrl: (checkoutId) => `${origin}/checkout/confirmation?group=${encodeURIComponent(checkoutId)}&paid=1`,
    holdMinutes: 30,
  }
}

/**
 * Which kind of payments this deployment takes: "off" (no provider: checkout is closed), "stub"
 * (nothing is charged), "test" (a Paystack sk_test_ or Bachs sk_sandbox_ key) or "live". Read at
 * request time.
 */
export function paymentsMode(): "off" | "stub" | "test" | "live" {
  const cfg = paymentsConfig()
  if (cfg.provider === "off") return "off"
  if (cfg.provider === "bachs") return cfg.bachs?.live ? "live" : "test"
  const key = cfg.secretKey
  return !key ? "stub" : key.startsWith("sk_test_") ? "test" : "live"
}

/** The shopper-facing name of the provider taking payments ("Paystack" or "Bachs"); null for the stub and off. */
export function paymentsProviderName(): "Paystack" | "Bachs" | null {
  const p = paymentsConfig().provider
  return p === "paystack" ? "Paystack" : p === "bachs" ? "Bachs" : null
}

/** The startup line (once per process, from warmUp). */
export function paymentsStartupLine(): string {
  const bachs = paymentsConfig().provider === "bachs"
  switch (paymentsMode()) {
    case "off":
      return '[yard] payments: off — checkout is closed ("Payments open soon"); carts, browsing, accounts and Studio work. Set YARD_PAYMENTS=paystack (PAYSTACK_*) or YARD_PAYMENTS=bachs (BACHS_*) to open it.'
    case "stub":
      return "[yard] payments: stub — nothing is charged (development or demo only)"
    case "test":
      return bachs ? "[yard] payments: bachs (SANDBOX key — no real money moves)" : "[yard] payments: paystack (TEST key — no real money moves)"
    case "live":
      return bachs ? "[yard] payments: bachs (live)" : "[yard] payments: paystack (live)"
  }
}
