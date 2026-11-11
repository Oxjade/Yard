import "server-only"
import { getEnv } from "../env"

/**
 * Payment configuration, read from the environment on each call (no import-time parsing, so
 * `next build` never needs the keys). With PAYSTACK_SECRET_KEY absent the stub provider is
 * used: it never charges, never reports a charge as successful on its own, and every response
 * says so.
 */
export type PaymentsConfig = {
  provider: "paystack" | "stub"
  secretKey: string | null
  publicKey: string | null
  /** Webhook signature keys to try, in order (PAYSTACK_WEBHOOK_SECRET, then the secret key). */
  webhookKeys: string[]
  /** Split payments / subaccounts. Off unless PAYSTACK_SPLIT=subaccount; the split itself is stubbed. */
  split: "off" | "subaccount"
  /** Where Paystack sends the shopper back after paying. */
  callbackUrl: (checkoutId: string) => string
  /** Minutes a pending checkout holds stock before the expiry job releases it. */
  holdMinutes: number
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

/** Currencies Paystack can charge in that Yard also sells in. */
export const PAYSTACK_CURRENCIES = ["NGN", "GHS", "ZAR", "KES", "USD"] as const
export type ChargeCurrency = (typeof PAYSTACK_CURRENCIES)[number]
export const isChargeCurrency = (c: string): c is ChargeCurrency => (PAYSTACK_CURRENCIES as readonly string[]).includes(c)

export function paymentsConfig(): PaymentsConfig {
  const secretKey = blank(process.env.PAYSTACK_SECRET_KEY)
  const webhookSecret = blank(process.env.PAYSTACK_WEBHOOK_SECRET)
  const origin = getEnv().publicOrigin
  return {
    provider: secretKey ? "paystack" : "stub",
    secretKey,
    publicKey: blank(process.env.PAYSTACK_PUBLIC_KEY),
    webhookKeys: [webhookSecret, secretKey].filter((k): k is string => !!k).filter((k, i, a) => a.indexOf(k) === i),
    split: process.env.PAYSTACK_SPLIT === "subaccount" ? "subaccount" : "off",
    // Straight to the confirmation, which verifies first (paid=1) and then follows the server.
    callbackUrl: (checkoutId) => `${origin}/checkout/confirmation?group=${encodeURIComponent(checkoutId)}&paid=1`,
    holdMinutes: 30,
  }
}

/**
 * Which kind of payments this deployment takes: "stub" (no secret key, nothing is charged),
 * "test" (a Paystack test key, sk_test_…) or "live". Read at request time.
 */
export function paymentsMode(): "stub" | "test" | "live" {
  const key = paymentsConfig().secretKey
  return !key ? "stub" : key.startsWith("sk_test_") ? "test" : "live"
}
