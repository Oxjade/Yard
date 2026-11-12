/**
 * Bachs (https://docs.bachs.io) pure helpers: amounts, webhook signatures, status mapping and the
 * payment corridors a checkout may offer. No database, no network and no "server-only", so
 * `tsx --test` unit-tests them (bachs-core.test.ts). The provider itself is in providers.ts.
 *
 * Bachs amounts are DECIMAL STRINGS in the currency's major unit at its precision ("75000.00" is
 * ₦75,000.00), never minor units. Yard keeps integer minor units everywhere; the two meet only in
 * minorToBachsAmount / bachsAmountToMinor below.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

/** Currencies Yard sells in that Bachs can charge (Bachs prices in USD, NGN, GHS, KES and a few more Yard doesn't sell in; no ZAR). */
export const BACHS_CURRENCIES = ["NGN", "GHS", "KES", "USD"] as const
export type BachsCurrency = (typeof BACHS_CURRENCIES)[number]
export const isBachsCurrency = (c: string): c is BachsCurrency => (BACHS_CURRENCIES as readonly string[]).includes(c)

/** Digits after the decimal point, per currency (all of Yard's Bachs currencies use 2). */
const PRECISION: Record<BachsCurrency, number> = { NGN: 2, GHS: 2, KES: 2, USD: 2 }

function precisionOf(currency: string): number {
  const p = PRECISION[currency.toUpperCase() as BachsCurrency]
  if (p === undefined) throw new Error(`Bachs can't charge in ${currency}`)
  return p
}

/**
 * Integer minor units → Bachs decimal string at the currency's precision: 7_500_000 NGN → "75000.00".
 * String arithmetic only (no floating point). Throws on anything but a non-negative safe integer.
 */
export function minorToBachsAmount(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error(`Amount must be a non-negative whole number of minor units (got ${amountMinor})`)
  const p = precisionOf(currency)
  if (p === 0) return String(amountMinor)
  const digits = String(amountMinor).padStart(p + 1, "0")
  return `${digits.slice(0, -p)}.${digits.slice(-p)}`
}

/**
 * Bachs decimal string → integer minor units: "75000.00" NGN → 7_500_000. Accepts fewer decimals
 * ("19", "19.5") and extra trailing zeros ("100000.000000000000000000", as Bachs returns on some
 * objects); refuses anything that isn't a plain non-negative decimal or that has non-zero digits
 * beyond the currency's precision (it would not be a whole number of minor units). Throws.
 */
export function bachsAmountToMinor(amount: unknown, currency: string): number {
  const s = typeof amount === "number" && Number.isFinite(amount) ? String(amount) : typeof amount === "string" ? amount.trim() : ""
  const m = /^(\d{1,15})(?:\.(\d{1,30}))?$/.exec(s)
  if (!m) throw new Error(`Not a Bachs amount: ${JSON.stringify(amount)}`)
  const p = precisionOf(currency)
  const frac = m[2] ?? ""
  if (/[1-9]/.test(frac.slice(p))) throw new Error(`Bachs amount ${s} has more than ${p} decimals for ${currency}`)
  const minor = Number(m[1] + frac.slice(0, p).padEnd(p, "0"))
  if (!Number.isSafeInteger(minor)) throw new Error(`Bachs amount ${s} is too large`)
  return minor
}

/* ---------- Webhook signatures ---------- */

/** Seconds a signed delivery stays valid either side of now (the docs use 300). */
export const BACHS_SIGNATURE_TOLERANCE_SEC = 300

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" | "no_secret" }

/**
 * Verifies an X-Bachs-Signature-V2 header ("t={unix seconds},v1={hex},v1={hex}…") on the exact raw
 * body, as the docs describe: the signed message is `${t}.${rawBody}`, the digest HMAC-SHA256 hex
 * under the endpoint's signing secret, the timestamp must be within `toleranceSec` of now, and the
 * delivery is accepted when ANY v1 value matches (Bachs sends one per valid secret while a secret
 * rotates). Every secret in `secrets` is tried. Constant-time compare.
 */
export function verifyBachsSignatureV2(
  rawBody: string,
  header: string | null | undefined,
  secrets: readonly string[],
  opts: { nowSec?: number; toleranceSec?: number } = {},
): SignatureCheck {
  if (!header || !header.trim()) return { ok: false, reason: "missing" }
  if (!secrets.length) return { ok: false, reason: "no_secret" }
  let t: string | null = null
  const v1: Buffer[] = []
  for (const part of header.split(",")) {
    const i = part.indexOf("=")
    if (i <= 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === "t") t = v
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1.push(Buffer.from(v.toLowerCase(), "hex"))
  }
  if (!t || !/^\d{1,12}$/.test(t) || !v1.length) return { ok: false, reason: "malformed" }
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(t)) > (opts.toleranceSec ?? BACHS_SIGNATURE_TOLERANCE_SEC)) return { ok: false, reason: "expired" }
  let match = false
  for (const secret of secrets) {
    const want = createHmac("sha256", secret).update(`${t}.`, "utf8").update(rawBody, "utf8").digest()
    // Every candidate is compared (no early exit), each in constant time.
    for (const got of v1) if (got.length === want.length && timingSafeEqual(got, want)) match = true
  }
  return match ? { ok: true } : { ok: false, reason: "mismatch" }
}

/** Builds a V2 header for `rawBody` (the local mock and tests sign deliveries with it). */
export function signBachsPayload(rawBody: string, secret: string, tSec = Math.floor(Date.now() / 1000)): string {
  return `t=${tSec},v1=${createHmac("sha256", secret).update(`${tSec}.${rawBody}`, "utf8").digest("hex")}`
}

/* ---------- Statuses ---------- */

/** Yard's view of a Bachs charge: the same three states Paystack's are mapped to. */
export type YardChargeStatus = "success" | "failed" | "pending"

/**
 * A Bachs charge status (lower or upper case, as the payment object and the webhooks spell it)
 * → Yard's charge state, plus whether a person must look at it before fulfilling.
 *  - succeeded / overpaid → success (the full amount arrived).
 *  - accepted (a short or long payment accepted as final) → success, held for review.
 *  - refunded / partially_refunded / auto_refunded → success: the money was collected; refunds are separate records.
 *  - open / underpaid / processing / created / pending → pending (the customer can still pay).
 *  - incomplete / failed / expired / cancelled → failed (the charge ended without payment).
 * Anything unknown stays pending: never fulfil on a status we don't know.
 */
export function mapBachsChargeStatus(status: unknown): { status: YardChargeStatus; review: boolean } {
  const s = typeof status === "string" ? status.trim().toLowerCase() : ""
  switch (s) {
    case "succeeded":
    case "overpaid":
    case "refunded":
    case "partially_refunded":
    case "auto_refunded":
      return { status: "success", review: false }
    case "accepted":
      return { status: "success", review: true }
    case "incomplete":
    case "failed":
    case "expired":
    case "cancelled":
    case "canceled":
      return { status: "failed", review: false }
    default:
      return { status: "pending", review: false }
  }
}

/** A Bachs refund status → Yard's refund state ("processing" while Bachs works on it; "success" once paid). */
export function mapBachsRefundStatus(status: unknown): "pending" | "succeeded" | "failed" {
  const s = typeof status === "string" ? status.trim().toLowerCase() : ""
  if (s === "success" || s === "succeeded" || s === "paid") return "succeeded"
  if (s === "failed") return "failed"
  return "pending"
}

/* ---------- Payment corridors ---------- */

export type YardPaymentMethod = "card" | "bank_transfer" | "ussd" | "mobile_money"

/** The methods Bachs can take in a charge currency (card: USD and NGN; bank transfer: NGN; mobile money: GHS and KES). */
export function bachsMethodsFor(currency: string): YardPaymentMethod[] {
  switch (currency) {
    case "NGN":
      return ["card", "bank_transfer"]
    case "USD":
      return ["card"]
    case "GHS":
    case "KES":
      return ["mobile_money"]
    default:
      return []
  }
}

/**
 * The Bachs `payment_method_types` corridor for the method the shopper chose, or undefined when it
 * doesn't fit the currency (the checkout is then left unrestricted rather than refused).
 */
export function bachsCorridorsFor(method: YardPaymentMethod | undefined, currency: string): string[] | undefined {
  if (!method) return undefined
  const table: Record<string, Partial<Record<YardPaymentMethod, string>>> = {
    NGN: { card: "NGN_CARD", bank_transfer: "NGN_BANK_TRANSFER" },
    USD: { card: "USD_CARD" },
    GHS: { mobile_money: "MOMO_GHS" },
    KES: { mobile_money: "MOMO_KES" },
  }
  const c = table[currency]?.[method]
  return c ? [c] : undefined
}

/** Yard's word for how a Bachs charge was paid ("CARD", "NGN_BANK_TRANSFER", "MOMO_GHS" → card / bank_transfer / mobile_money). */
export function channelFromBachs(paymentMethod: unknown, detailsType?: unknown): string | null {
  const v = (typeof paymentMethod === "string" && paymentMethod) || (typeof detailsType === "string" && detailsType) || ""
  const s = v.toUpperCase()
  if (!s) return null
  if (s.includes("CARD")) return "card"
  if (s.includes("BANK")) return "bank_transfer"
  if (s.startsWith("MOMO") || s.includes("MOBILE")) return "mobile_money"
  if (s.includes("CRYPTO")) return "crypto"
  return s.toLowerCase().slice(0, 40)
}

/** Whether a URL's host is local or private: Bachs refuses those for success_url / cancel_url. */
export function isPrivateOrigin(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "[::1]") return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}
