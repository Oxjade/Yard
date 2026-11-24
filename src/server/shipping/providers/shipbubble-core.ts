import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { CourierBooking, CourierQuote, CourierRate, CourierStatus, CourierTracking, CourierWebhook, ValidatedAddress, WalletBalance } from "./courier-types"

/**
 * Shipbubble, the pure half: request bodies, response parsing, status mapping and the webhook
 * signature. No I/O and no server-only, so tests run it with fixtures shaped like the docs.
 *
 * Sources (docs.shipbubble.com, read 2026-11-24; see docs/SHIPPING.md for the full list):
 * - Authentication: `Authorization: Bearer <key>`; sandbox keys start `sb_sandbox_`, live keys `sb_prod_`.
 * - Base URL: https://api.shipbubble.com/v1 for both (the key decides sandbox or live).
 * - POST /shipping/address/validate {name, email, phone, address} → data.address_code.
 * - GET  /shipping/labels/categories → data: [{category_id, category}].
 * - POST /shipping/fetch_rates {sender_address_code, reciever_address_code (sic), pickup_date,
 *   category_id, package_items, package_dimension, service_type?} → data.request_token, data.couriers[].
 * - POST /shipping/labels {request_token, service_code, courier_id} → the shipment (data.order_id…).
 * - GET  /shipping/labels/list/{order_id} → data.results[] (tracking).
 * - GET  /shipping/wallet/balance → data.balance (NGN).
 * - Webhooks: header x-ship-signature = hex HMAC-SHA512 of the raw body, keyed with the API key.
 *   Events shipment.label.created, shipment.status.changed, shipment.cancelled… Status values:
 *   pending, confirmed, picked_up, in_transit, completed, cancelled.
 *
 * Where the docs leave a field unclear, the parsers accept the documented name and the obvious
 * alternative, and a value that can't be read becomes null instead of a guess.
 */

export const SHIPBUBBLE_BASE = "https://api.shipbubble.com/v1"
/** "A rate request token expires after 7 days of generation." */
export const SHIPBUBBLE_TOKEN_TTL_MS = 7 * 86_400_000
export const SHIPBUBBLE_SIGNATURE_HEADER = "x-ship-signature"

export type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null)
const url = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null
  } catch {
    return null
  }
}

/** A key that looks like a Shipbubble API key ("sb_sandbox_…" or "sb_prod_…"). */
export function shipbubbleKeyKind(key: string): "sandbox" | "live" | null {
  if (/^sb_sandbox_[A-Za-z0-9_-]{8,}$/.test(key)) return "sandbox"
  if (/^sb_prod_[A-Za-z0-9_-]{8,}$/.test(key)) return "live"
  return null
}

/**
 * Naira (Shipbubble sends amounts as numbers or numeric strings in the main unit) to kobo,
 * exactly: "2830.5" → 283050. Null for anything that isn't a non-negative amount.
 */
export function nairaToKobo(v: unknown): number | null {
  const s = typeof v === "number" ? (Number.isFinite(v) && v >= 0 ? v.toFixed(2) : "") : typeof v === "string" ? v.trim().replace(/,/g, "") : ""
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const frac = (m[2] ?? "").padEnd(3, "0")
  // Round half up on the third decimal.
  const kobo = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0)
  return Number.isSafeInteger(kobo) ? kobo : null
}

export const koboToNaira = (minor: number) => (minor / 100).toFixed(2)

/** The envelope every Shipbubble answer uses: { status: "success", message, data }. */
export function successData(json: unknown, what: string): unknown {
  const o = obj(json)
  if (!o) throw new ShipbubbleParseError(`${what}: the answer isn't a JSON object`)
  if (o.status !== "success") throw new ShipbubbleParseError(`${what}: ${str(o.message) ?? "the provider didn't report success"}`, true)
  return o.data
}

export class ShipbubbleParseError extends Error {
  constructor(
    message: string,
    /** The provider answered and said no (as opposed to an answer Yard can't read). */
    public readonly refused = false,
  ) {
    super(message.slice(0, 280))
    this.name = "ShipbubbleParseError"
  }
}

/* ---------- Addresses ---------- */

export const validateAddressBody = (a: { name: string; email: string; phone: string; address: string }) => ({ name: a.name, email: a.email, phone: a.phone, address: a.address })

export function parseValidatedAddress(json: unknown): ValidatedAddress {
  const d = obj(successData(json, "address validation"))
  const code = str(d?.address_code)
  if (!code) throw new ShipbubbleParseError("address validation: no address_code in the answer")
  return { code, formatted: str(d?.formatted_address) ?? str(d?.address) }
}

/* ---------- Categories ---------- */

const PREFERRED_CATEGORIES = ["fashion", "clothing", "accessories", "light weight"]

/** The category for a clothing marketplace: a fashion one when listed, else the first. */
export function pickCategory(json: unknown): string | null {
  const list = successData(json, "package categories")
  if (!Array.isArray(list) || !list.length) return null
  const items = list.map(obj).filter((x): x is Json => !!x)
  for (const pref of PREFERRED_CATEGORIES) {
    const hit = items.find((c) => (str(c.category) ?? "").toLowerCase().includes(pref))
    if (hit && str(hit.category_id)) return str(hit.category_id)
  }
  return str(items[0]?.category_id)
}

/* ---------- Rates ---------- */

export type RatesBodyInput = {
  senderCode: string
  receiverCode: string
  pickupDate: string
  categoryId: string
  items: { name: string; description: string; unitWeightGrams: number; unitAmountMinor: number; quantity: number }[]
  lengthCm: number
  widthCm: number
  heightCm: number
}

/** The fetch_rates body, with Shipbubble's own spelling of `reciever_address_code`. Weights in kg, amounts in naira. */
export function ratesBody(i: RatesBodyInput) {
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : s)
  return {
    sender_address_code: num(i.senderCode),
    reciever_address_code: num(i.receiverCode),
    pickup_date: i.pickupDate,
    category_id: num(i.categoryId),
    package_items: i.items.map((x) => ({
      name: x.name.slice(0, 100),
      description: x.description.slice(0, 200),
      unit_weight: (Math.max(1, x.unitWeightGrams) / 1000).toFixed(3).replace(/\.?0+$/, ""),
      unit_amount: koboToNaira(x.unitAmountMinor),
      quantity: String(x.quantity),
    })),
    package_dimension: { length: i.lengthCm, width: i.widthCm, height: i.heightCm },
  }
}

/**
 * Business days from the provider's ETA words: "Within 24 hrs" → [1, 1], "2 - 4 working days" →
 * [2, 4], "3 days" → [3, 3]. Null when there's no number of days or hours to read.
 */
export function parseEtaDays(text: string | null | undefined): [number, number] | null {
  if (!text) return null
  const t = text.toLowerCase()
  const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n >= 0)
  if (/same[\s-]?day|today/.test(t) && !nums.length) return [0, 1]
  if (!nums.length) return null
  const hours = /\b(hours?|hrs?)\b/.test(t)
  const days = /\bdays?\b/.test(t) || /\bweeks?\b/.test(t)
  if (!hours && !days) return null
  const scale = /\bweeks?\b/.test(t) ? 5 : 1
  const toDays = (n: number) => (hours && !days ? Math.max(1, Math.ceil(n / 24)) : Math.max(0, Math.round(n * scale)))
  const lo = toDays(Math.min(...nums.slice(0, 2)))
  const hi = toDays(Math.max(...nums.slice(0, 2)))
  if (hi > 60) return null
  return [lo, Math.max(lo, hi)]
}

function parseRate(c: Json, fallbackCurrency: string): CourierRate | null {
  const courierId = str(c.courier_id)
  const serviceCode = str(c.service_code)
  // The docs name the amount shown to the customer and charged from the wallet; `total` is that
  // figure in the documented examples (rate_card_amount + vat − discount). rate_card_amount is the
  // fallback when an older answer has no total.
  const amountMinor = nairaToKobo(c.total) ?? nairaToKobo(c.rate_card_amount)
  if (!courierId || !serviceCode || amountMinor === null || amountMinor <= 0) return null
  const eta = str(c.delivery_eta) ?? str(c.delivery_eta_time)
  return {
    courierId,
    serviceCode,
    courierName: (str(c.courier_name) ?? serviceCode).slice(0, 80),
    courierImage: url(c.courier_image),
    amountMinor,
    currency: (str(c.currency) ?? fallbackCurrency).toUpperCase(),
    deliveryEta: eta ? eta.slice(0, 80) : null,
    transitDays: parseEtaDays(eta),
    serviceType: str(c.service_type),
  }
}

/** The rates answer: the request token and every courier Yard could read (unreadable ones are left out). */
export function parseRates(json: unknown): CourierQuote {
  const d = obj(successData(json, "rates"))
  const requestToken = str(d?.request_token)
  if (!requestToken) throw new ShipbubbleParseError("rates: no request_token in the answer")
  const checkout = obj(d?.checkout_data)
  const currency = (str(checkout?.currency) ?? "NGN").toUpperCase()
  const couriers = Array.isArray(d?.couriers) ? d.couriers : []
  const seen = new Set<string>()
  const rates: CourierRate[] = []
  for (const raw of couriers) {
    const c = obj(raw)
    const r = c ? parseRate(c, currency) : null
    if (!r) continue
    const key = `${r.courierId}:${r.serviceCode}`
    if (seen.has(key)) continue
    seen.add(key)
    rates.push(r)
  }
  rates.sort((a, b) => a.amountMinor - b.amountMinor)
  return { requestToken, rates, currency }
}

/* ---------- Statuses ---------- */

const RANK: Record<Exclude<CourierStatus, "cancelled" | "unknown">, number> = { pending: 0, confirmed: 1, picked_up: 2, in_transit: 3, delivered: 4 }

/** One Shipbubble status word to Yard's: completed → delivered. Free text Yard can't place is "unknown". */
export function mapShipbubbleStatus(raw: unknown): CourierStatus {
  const s = (str(raw) ?? "").toLowerCase().replace(/[\s-]+/g, "_")
  if (!s) return "unknown"
  if (s === "completed" || s === "delivered" || s.includes("delivered")) return "delivered"
  if (s === "cancelled" || s === "canceled" || s.includes("cancel")) return "cancelled"
  if (s === "in_transit" || s.includes("transit") || s.includes("out_for_delivery")) return "in_transit"
  if (s === "picked_up" || s.includes("picked")) return "picked_up"
  if (s === "confirmed" || s.includes("confirm")) return "confirmed"
  if (s === "pending" || s.includes("pending") || s.includes("processing")) return "pending"
  return "unknown"
}

/**
 * The furthest status a shipment has reached, from its top-level status and its package_status
 * history (one integration reports the top-level field can lag behind the history). Delivered
 * beats everything; cancelled beats the rest; otherwise the highest step.
 */
export function furthestStatus(list: CourierStatus[]): CourierStatus {
  if (list.includes("delivered")) return "delivered"
  if (list.includes("cancelled")) return "cancelled"
  let best: CourierStatus = "unknown"
  for (const s of list) {
    if (s === "unknown" || s === "cancelled") continue
    if (best === "unknown" || RANK[s] > RANK[best as keyof typeof RANK]) best = s
  }
  return best
}

/* ---------- Shipments (booking, tracking, webhooks) ---------- */

function waybillOf(d: Json): string | null {
  const w = d.waybill_document
  if (typeof w === "string") return url(w)
  const o = obj(w)
  return o ? (url(o.url) ?? url(o.link) ?? url(o.document)) : null
}

/** A shipment object as booking, the shipments list and webhooks send it. */
export function parseShipment(d: Json): CourierTracking {
  const providerOrderId = str(d.order_id)
  if (!providerOrderId) throw new ShipbubbleParseError("shipment: no order_id")
  const courier = obj(d.courier)
  const history = (Array.isArray(d.package_status) ? d.package_status : []).map(obj).filter((x): x is Json => !!x)
  const dated = history.map((h, i) => ({ status: mapShipbubbleStatus(h.status), raw: str(h.status), at: str(h.datetime), i }))
  const top = mapShipbubbleStatus(d.status)
  const status = furthestStatus([top, ...dated.map((h) => h.status)])
  const newest = [...dated].sort((a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0) || b.i - a.i)[0]
  const events = (Array.isArray(d.events) ? d.events : []).map(obj).filter((x): x is Json => !!x)
  const lastEvent = events[events.length - 1]
  const at = newest?.at && Number.isFinite(Date.parse(newest.at)) ? new Date(Date.parse(newest.at)).toISOString() : null
  return {
    providerOrderId,
    status,
    providerStatus: (str(d.status) ?? newest?.raw ?? null)?.slice(0, 60) ?? null,
    trackingCode: str(courier?.tracking_code)?.slice(0, 80) ?? null,
    trackingUrl: url(d.tracking_url),
    labelUrl: waybillOf(d),
    occurredAt: at,
    location: str(lastEvent?.location)?.slice(0, 120) ?? null,
  }
}

export const bookingBody = (r: { requestToken: string; serviceCode: string; courierId: string }) => ({ request_token: r.requestToken, service_code: r.serviceCode, courier_id: r.courierId })

export function parseBooking(json: unknown): CourierBooking {
  const d = obj(successData(json, "booking"))
  if (!d) throw new ShipbubbleParseError("booking: no shipment in the answer")
  const s = parseShipment(d)
  const payment = obj(d.payment)
  const courier = obj(d.courier)
  return {
    providerOrderId: s.providerOrderId,
    status: s.status === "unknown" ? null : s.status,
    providerStatus: s.providerStatus,
    courierName: str(courier?.name)?.slice(0, 80) ?? null,
    trackingCode: s.trackingCode,
    trackingUrl: s.trackingUrl,
    labelUrl: s.labelUrl,
    costMinor: nairaToKobo(payment?.shipping_fee),
    currency: str(payment?.currency)?.toUpperCase() ?? null,
  }
}

export function parseTracking(json: unknown, providerOrderId: string): CourierTracking {
  const d = obj(successData(json, "tracking"))
  const results = Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : []
  const items = results.map(obj).filter((x): x is Json => !!x)
  const hit = items.find((x) => str(x.order_id) === providerOrderId) ?? items[0]
  if (!hit) throw new ShipbubbleParseError(`tracking: shipment ${providerOrderId} not found`)
  return parseShipment(hit)
}

/** A webhook body (flat: the shipment's fields at the top level, plus `event`). */
export function parseWebhookBody(raw: string): CourierWebhook {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    throw new ShipbubbleParseError("webhook: body isn't JSON")
  }
  const o = obj(j)
  if (!o) throw new ShipbubbleParseError("webhook: body isn't an object")
  // Flat per the docs; a `data` envelope is accepted too.
  const d = obj(o.data) && !str(o.order_id) ? (obj(o.data) as Json) : o
  return { ...parseShipment(d), event: str(o.event)?.slice(0, 60) ?? null }
}

/** Dedupe key for a webhook delivery: Shipbubble sends no event id, and retries resend the same body. */
export const webhookEventKey = (raw: string) => `shipbubble:${createHash("sha256").update(raw).digest("hex")}`

/* ---------- Wallet ---------- */

export function parseWallet(json: unknown): WalletBalance {
  const d = obj(successData(json, "wallet balance"))
  const amountMinor = nairaToKobo(d?.balance)
  if (amountMinor === null) throw new ShipbubbleParseError("wallet balance: no balance in the answer")
  return { amountMinor, currency: (str(d?.currency) ?? "NGN").toUpperCase() }
}

/* ---------- Webhook signature ---------- */

export const signShipbubble = (raw: string, secret: string) => createHmac("sha512", secret).update(raw, "utf8").digest("hex")

/**
 * x-ship-signature must equal hex(HMAC-SHA512(raw body)) under one of the secrets (Shipbubble
 * keys it with the API key; SHIPBUBBLE_WEBHOOK_SECRET overrides). Constant time; case-insensitive hex.
 */
export function verifyShipbubbleSignature(raw: string, header: string | null | undefined, secrets: string[]): boolean {
  const got = (header ?? "").trim().toLowerCase()
  if (!/^[0-9a-f]{128}$/.test(got)) return false
  const a = Buffer.from(got, "hex")
  let ok = false
  for (const s of secrets) {
    if (!s) continue
    const b = Buffer.from(signShipbubble(raw, s), "hex")
    if (a.length === b.length && timingSafeEqual(a, b)) ok = true
  }
  return ok
}
