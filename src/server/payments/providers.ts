import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { log } from "../log"
import { bachsAmountToMinor, channelFromBachs, isPrivateOrigin, mapBachsChargeStatus, mapBachsRefundStatus, minorToBachsAmount, verifyBachsSignatureV2 } from "./bachs-core"
import { paymentsConfig, type BachsConfig } from "./config"
import type { ProviderRefund } from "./refund-recovery"

/**
 * The payment provider interface (Paystack live, or the stub when PAYSTACK_SECRET_KEY is absent).
 * Every method does network I/O and must be called OUTSIDE a transaction.
 */

/** A provider call that failed. `definitive` = the provider answered and refused (4xx); otherwise the outcome is unknown. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public definitive: boolean,
    public httpStatus?: number,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

/**
 * `channels`: Paystack channels, or Bachs `payment_method_types` corridors (NGN_CARD…), limiting the
 * hosted page to the method the shopper chose. `idempotencyKey` / `expiresInMinutes`: Bachs only
 * (Paystack's reference is its idempotency).
 */
export type InitInput = {
  reference: string
  email: string
  amountMinor: number
  currency: string
  callbackUrl: string
  metadata: Record<string, string>
  splitCode?: string | null
  channels?: string[]
  idempotencyKey?: string
  expiresInMinutes?: number
}
export type InitResult = { authorizationUrl: string | null; accessCode: string | null }

/** A transaction's state as the provider reports it. `pending` covers Paystack's abandoned/ongoing/processing/queued. */
export type ChargeState = {
  reference: string
  status: "success" | "failed" | "pending"
  /** The provider's own word for it ("abandoned", "ongoing", "success"…): "abandoned" = no payment was completed. */
  providerStatus: string | null
  amountMinor: number
  currency: string
  providerTxnId: string | null
  paidAt: Date | null
  channel: string | null
  reason: string | null
  raw: unknown
  /** Set when the money arrived but a person must look before the order is fulfilled (Bachs `accepted`: a short or long payment accepted as final). */
  review?: string | null
}

/**
 * `providerTxnId`: the provider's id for the charge (Bachs refunds by `charge_id`).
 * `paymentAmountMinor`: what the payment collected (Bachs: a refund of all of it omits `amount`).
 * `refundId`: Yard's refund id (Bachs: sent as the refund's unique `reference` and idempotency key).
 */
export type RefundInput = { transactionReference: string; amountMinor: number; currency: string; note: string; providerTxnId?: string | null; paymentAmountMinor?: number; refundId?: string }
export type RefundResult = { providerRef: string; status: "pending" | "succeeded" | "failed" }

export type TransferInput = { reference: string; amountMinor: number; currency: string; recipientCode: string; reason: string }
export type TransferResult = { providerRef: string; status: "pending" | "succeeded" | "failed"; reason: string | null }

export interface PaymentProvider {
  kind: "paystack" | "bachs" | "stub"
  initialize(input: InitInput): Promise<InitResult>
  /** Paystack: our payment reference. Bachs: the checkout session id (chk_…, stored as the payment's access code). Null = the provider has no such payment. */
  verify(reference: string): Promise<ChargeState | null>
  refund(input: RefundInput): Promise<RefundResult>
  /** Refunds the provider already holds for a transaction (Paystack GET /refund?transaction=…). Throws ProviderError when it can't tell. */
  listRefunds(transaction: string): Promise<ProviderRefund[]>
  transfer(input: TransferInput): Promise<TransferResult>
  verifyTransfer(reference: string): Promise<TransferResult | null>
}

/* ---------- Paystack ---------- */

const API = "https://api.paystack.co"

type PaystackEnvelope<T> = { status?: boolean; message?: string; data?: T }

async function paystack<T>(secret: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
  } catch (e) {
    throw new ProviderError(`Paystack unreachable: ${(e as Error).message}`, false)
  }
  const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null
  if (!res.ok || !json || json.status !== true) {
    const message = json?.message ?? `HTTP ${res.status}`
    // 4xx: Paystack read the request and refused it. 5xx / unparseable: unknown outcome.
    throw new ProviderError(`Paystack ${method} ${path.split("?")[0]}: ${message}`, res.status >= 400 && res.status < 500, res.status)
  }
  return json.data as T
}

const mapChargeStatus = (s: string | undefined): ChargeState["status"] => (s === "success" ? "success" : s === "failed" || s === "reversed" ? "failed" : "pending")

const mapTransferStatus = (s: string | undefined): TransferResult["status"] => (s === "success" ? "succeeded" : s === "failed" || s === "reversed" || s === "rejected" || s === "abandoned" ? "failed" : "pending")

const mapRefundStatus = (s: string | undefined): RefundResult["status"] => (s === "processed" ? "succeeded" : s === "failed" ? "failed" : "pending")

type PaystackTxn = { id?: number | string; reference?: string; status?: string; amount?: number; currency?: string; paid_at?: string | null; paidAt?: string | null; channel?: string | null; gateway_response?: string | null }

export function chargeStateFromPaystack(d: PaystackTxn): ChargeState {
  const paid = d.paid_at ?? d.paidAt ?? null
  return {
    reference: String(d.reference ?? ""),
    status: mapChargeStatus(d.status),
    providerStatus: d.status ?? null,
    amountMinor: Number(d.amount ?? 0),
    currency: String(d.currency ?? ""),
    providerTxnId: d.id != null ? String(d.id) : null,
    paidAt: paid ? new Date(paid) : null,
    channel: d.channel ?? null,
    reason: d.gateway_response ?? null,
    raw: d,
  }
}

function paystackProvider(secret: string): PaymentProvider {
  return {
    kind: "paystack",
    async initialize(input) {
      const d = await paystack<{ authorization_url?: string; access_code?: string }>(secret, "POST", "/transaction/initialize", {
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: { ...input.metadata, cancel_action: input.callbackUrl },
        ...(input.splitCode ? { split_code: input.splitCode } : {}),
        ...(input.channels?.length ? { channels: input.channels } : {}),
      })
      return { authorizationUrl: d.authorization_url ?? null, accessCode: d.access_code ?? null }
    },
    async verify(reference) {
      try {
        const d = await paystack<PaystackTxn>(secret, "GET", `/transaction/verify/${encodeURIComponent(reference)}`)
        return chargeStateFromPaystack(d)
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 404) return null
        throw e
      }
    },
    async refund(input) {
      const d = await paystack<{ id?: number | string; status?: string }>(secret, "POST", "/refund", {
        transaction: input.transactionReference,
        amount: input.amountMinor,
        currency: input.currency,
        merchant_note: input.note.slice(0, 200),
      })
      return { providerRef: String(d.id ?? ""), status: mapRefundStatus(d.status) }
    },
    async listRefunds(transaction) {
      type Row = { id?: number | string; transaction?: number | string | { id?: number | string } | null; amount?: number; currency?: string; status?: string; merchant_note?: string | null; createdAt?: string; created_at?: string }
      const rows = await paystack<Row[]>(secret, "GET", `/refund?transaction=${encodeURIComponent(transaction)}&perPage=100`)
      if (!Array.isArray(rows)) throw new ProviderError("Paystack GET /refund: unexpected reply", false)
      return rows.map((r) => {
        const txn = r.transaction && typeof r.transaction === "object" ? r.transaction.id : r.transaction
        const created = r.createdAt ?? r.created_at
        return {
          id: String(r.id ?? ""),
          transactionId: txn != null ? String(txn) : null,
          amountMinor: Number(r.amount ?? 0),
          currency: String(r.currency ?? ""),
          status: mapRefundStatus(r.status),
          note: r.merchant_note ?? null,
          createdAt: created ? new Date(created) : null,
        }
      }).filter((r) => r.id)
    },
    async transfer(input) {
      const d = await paystack<{ transfer_code?: string; status?: string; reason?: string }>(secret, "POST", "/transfer", {
        source: "balance",
        amount: input.amountMinor,
        currency: input.currency,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason.slice(0, 100),
      })
      return { providerRef: d.transfer_code ?? input.reference, status: mapTransferStatus(d.status), reason: null }
    },
    async verifyTransfer(reference) {
      try {
        const d = await paystack<{ transfer_code?: string; status?: string; reason?: string }>(secret, "GET", `/transfer/verify/${encodeURIComponent(reference)}`)
        return { providerRef: d.transfer_code ?? reference, status: mapTransferStatus(d.status), reason: d.reason ?? null }
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 404) return null
        throw e
      }
    },
  }
}

/* ---------- Bachs ---------- */

/** Yard refuses a second refund on one Bachs charge before anything is sent (requestRefund); this is Bachs' own word if one gets there. */
export const BACHS_ONE_REFUND_MESSAGE =
  "Bachs allows only one refund per payment, and this payment already has one. Refund the rest by hand (from the Bachs dashboard or by bank transfer) and record it."

type BachsError = { error_code?: string; code?: string; message?: string; detail?: string; error?: string | { message?: string; code?: string } }

async function bachs<T>(cfg: BachsConfig, method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(cfg.apiBase + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
  } catch (e) {
    throw new ProviderError(`Bachs unreachable: ${(e as Error).message}`, false)
  }
  const json = (await res.json().catch(() => null)) as (T & BachsError) | null
  if (!res.ok || !json) {
    const err = json && typeof json.error === "object" ? json.error : null
    const code = json?.error_code ?? json?.code ?? err?.code ?? null
    const message = json?.detail ?? json?.message ?? err?.message ?? (typeof json?.error === "string" ? json.error : null) ?? `HTTP ${res.status}`
    // 4xx (other than 408/429): Bachs read the request and refused it. 5xx, 408, 429, unparseable: unknown outcome.
    const definitive = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    throw new ProviderError(`Bachs ${method} ${path.split("?")[0]}: ${code ? `${code}: ` : ""}${String(message).slice(0, 200)}`, definitive, res.status)
  }
  return json as T
}

type BachsCharge = {
  id?: string
  amount?: string
  currency?: string
  status?: string
  substatus?: string | null
  payment_method?: string | null
  payment_method_details?: { type?: string } | null
  created_at?: string
  updated_at?: string
  succeeded_at?: string | null
  reason?: string | null
}

/** The fields Yard reads from a Bachs checkout session (GET /v1/checkout-sessions/{id}); everything else is kept raw. */
export type BachsCheckoutSession = {
  checkout_id?: string
  status?: string
  payment_status?: string | null
  amount?: string
  currency?: string | null
  reference?: string | null
  metadata?: Record<string, unknown> | null
  charge?: BachsCharge | null
  completed_at?: string | null
  checkout_url?: string
}

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v))

/**
 * A Bachs checkout session (with its charge) as Yard's ChargeState. The charge decides when there
 * is one (mapBachsChargeStatus); a completed session that reports a payment but carries no charge
 * object is a success for the session amount; an open session is pending; an expired one failed.
 * Amounts are converted from Bachs decimal strings to minor units; one that can't be converted
 * leaves the payment for review instead of guessing.
 */
export function chargeStateFromBachs(s: BachsCheckoutSession, fallbackReference = ""): ChargeState {
  const sessionStatus = str(s.status).toLowerCase()
  const charge = s.charge ?? null
  const meta = (s.metadata ?? {}) as Record<string, unknown>
  const reference = str(s.reference) || str(meta.paymentReference) || fallbackReference
  let status: ChargeState["status"]
  let review: string | null = null
  let providerStatus: string
  if (charge && charge.status) {
    const m = mapBachsChargeStatus(charge.status)
    status = m.status
    if (m.review) review = `Bachs accepted the payment as ${str(charge.status).toLowerCase()} (not the exact amount asked for)`
    providerStatus = str(charge.substatus) && m.status !== "success" ? str(charge.substatus).toLowerCase() : str(charge.status).toLowerCase()
    // The session ended without payment while the charge still reads open: it's over.
    if (status === "pending" && sessionStatus === "expired") {
      status = "failed"
      providerStatus = "expired"
    }
  } else if (sessionStatus === "completed" && ["paid", "succeeded"].includes(str(s.payment_status).toLowerCase())) {
    status = "success"
    providerStatus = "succeeded"
  } else if (sessionStatus === "expired") {
    status = "failed"
    providerStatus = "expired"
  } else {
    status = "pending"
    providerStatus = sessionStatus || "open"
  }
  const currency = str(charge?.currency || s.currency).toUpperCase()
  let amountMinor = 0
  try {
    amountMinor = bachsAmountToMinor(charge?.amount ?? s.amount, currency)
  } catch (e) {
    if (status === "success") review = `Bachs reported an amount Yard can't read (${(e as Error).message})`
  }
  const paid = charge?.succeeded_at ?? (status === "success" ? (s.completed_at ?? charge?.updated_at ?? null) : null)
  return {
    reference,
    status,
    providerStatus,
    amountMinor,
    currency,
    providerTxnId: charge?.id ? String(charge.id) : null,
    paidAt: paid ? new Date(paid) : null,
    channel: channelFromBachs(charge?.payment_method, charge?.payment_method_details?.type),
    reason: status === "failed" ? str(charge?.reason) || (providerStatus === "expired" ? "The payment page expired before payment" : `Payment ${providerStatus}`) : null,
    raw: s,
    review,
  }
}

type BachsRefund = { refund_id?: string; charge_id?: string; reference?: string | null; status?: string; requested_amount?: string | null; refunded_amount?: string | null; created_at?: string | null; reason?: string | null }

function bachsProvider(cfg: BachsConfig): PaymentProvider {
  return {
    kind: "bachs",
    async initialize(input) {
      const amount = minorToBachsAmount(input.amountMinor, input.currency)
      // Bachs refuses localhost and private addresses as return URLs: leave them out on a local
      // machine (the shopper comes back on their own), as the Bachs docs advise.
      const returnUrls = isPrivateOrigin(input.callbackUrl) ? {} : { success_url: input.callbackUrl, cancel_url: input.callbackUrl }
      const d = await bachs<{ checkout_id?: string; checkout_url?: string }>(
        cfg,
        "POST",
        "/v1/checkout-sessions",
        {
          pricing: { currency: input.currency, amount },
          customer: { email: input.email },
          reference: input.reference,
          metadata: { ...input.metadata, paymentReference: input.reference },
          ...returnUrls,
          ...(input.channels?.length ? { payment_method_types: input.channels } : {}),
          ...(input.expiresInMinutes ? { expires_in_minutes: Math.min(1440, Math.max(1, Math.round(input.expiresInMinutes))) } : {}),
        },
        input.idempotencyKey,
      )
      if (!d.checkout_id || !d.checkout_url) throw new ProviderError("Bachs POST /v1/checkout-sessions: no checkout_id / checkout_url in the reply", false)
      return { authorizationUrl: d.checkout_url, accessCode: d.checkout_id }
    },
    async verify(checkoutId) {
      if (!/^[\w-]{1,128}$/.test(checkoutId)) return null
      try {
        const s = await bachs<BachsCheckoutSession>(cfg, "GET", `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`)
        return chargeStateFromBachs(s)
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 404) return null
        throw e
      }
    },
    async refund(input) {
      if (!input.providerTxnId) throw new ProviderError("This Bachs payment has no charge id on record, so it can't be refunded automatically. Refund it from the Bachs dashboard.", true)
      const full = input.paymentAmountMinor !== undefined && input.amountMinor === input.paymentAmountMinor
      const ref = input.refundId ?? input.transactionReference
      const d = await bachs<BachsRefund>(
        cfg,
        "POST",
        "/v1/refunds",
        {
          charge_id: input.providerTxnId,
          reference: ref,
          reason: input.note.slice(0, 200),
          idempotency_key: `yard-refund-${ref}`,
          // A full refund omits the amount; a partial one is in the settlement currency (refused
          // before this point unless the charge is in a currency Bachs settles in: NGN or USD).
          ...(full ? {} : { amount: minorToBachsAmount(input.amountMinor, input.currency) }),
        },
        `yard-refund-${ref}`,
      )
      if (!d.refund_id) throw new ProviderError("Bachs POST /v1/refunds: no refund_id in the reply", false)
      return { providerRef: d.refund_id, status: mapBachsRefundStatus(d.status) }
    },
    async listRefunds(chargeId) {
      // Bachs takes one refund per charge: the by-charge lookup is the whole list.
      let r: BachsRefund
      try {
        r = await bachs<BachsRefund>(cfg, "GET", `/v1/refunds/by-charge/${encodeURIComponent(chargeId)}`)
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus === 404) return []
        throw e
      }
      if (!r.refund_id) return []
      return [
        {
          id: r.refund_id,
          transactionId: r.charge_id ?? chargeId,
          // In the settlement currency, which Yard doesn't record: the match is by reference (note) only.
          amountMinor: 0,
          currency: "",
          status: mapBachsRefundStatus(r.status),
          // Yard sends its refund id as the Bachs reference: present it as the note tag the matcher reads.
          note: r.reference ? `[yard:${r.reference}]` : null,
          createdAt: r.created_at ? new Date(r.created_at) : null,
        },
      ]
    },
    async transfer() {
      // Payout model A: Bachs collects into Yard's account and Yard pays brands from its own payout
      // runs. Payout batches don't send through Bachs (ledger runPayoutBatch keeps them approved).
      throw new ProviderError("Payouts aren't sent through Bachs. Pay this brand by hand and record it.", false)
    },
    async verifyTransfer() {
      return null
    },
  }
}

/**
 * Bachs webhook signature (X-Bachs-Signature-V2: t=…,v1=…) on the exact raw body under
 * BACHS_WEBHOOK_SECRET, with a 5-minute timestamp tolerance (bachs-core.ts). No secret → refused.
 */
export function verifyBachsSignature(rawBody: string, header: string | null): ReturnType<typeof verifyBachsSignatureV2> {
  return verifyBachsSignatureV2(rawBody, header, paymentsConfig().bachs?.webhookSecrets ?? [])
}

/* ---------- Stub (no keys) ---------- */

/**
 * STUB PROVIDER — used when PAYSTACK_SECRET_KEY is absent. It never moves money and never reports
 * a charge or transfer as successful by itself: initialise returns no payment page, verify reports
 * "pending", transfers stay "pending". Only the development-only simulate endpoints can complete a
 * stub payment, and those rows are labelled provider = 'stub'.
 */
const stubProvider: PaymentProvider = {
  kind: "stub",
  async initialize() {
    log.once("payments-stub", "warn", "[yard] PAYSTACK_SECRET_KEY is not set: checkout uses the payment STUB (nothing is charged).")
    return { authorizationUrl: null, accessCode: null }
  },
  async verify() {
    return null
  },
  async refund() {
    // Only reached for a live-provider payment while the keys are missing: nothing can be refunded.
    throw new ProviderError("Payments aren't connected (PAYSTACK_SECRET_KEY is not set)", false)
  },
  async listRefunds() {
    throw new ProviderError("Payments aren't connected (PAYSTACK_SECRET_KEY is not set)", false)
  },
  async transfer(input) {
    log.once("payments-stub-transfer", "warn", "[yard] PAYSTACK_SECRET_KEY is not set: payouts are recorded but NOT sent (stub).")
    return { providerRef: `stub-${input.reference}`, status: "pending", reason: "Payments aren't connected; nothing was sent." }
  },
  async verifyTransfer() {
    return null
  },
}

/**
 * The provider for this deployment. With payments off there is none: checkout refuses before it
 * gets here (checkout.ts), and anything else that asks (a refund or payout job) gets the stub,
 * which moves nothing and says so.
 */
export function getProvider(): PaymentProvider {
  const cfg = paymentsConfig()
  if (cfg.provider === "paystack" && cfg.secretKey) return paystackProvider(cfg.secretKey)
  if (cfg.provider === "bachs" && cfg.bachs) return bachsProvider(cfg.bachs)
  return stubProvider
}

/**
 * Paystack webhook signature: hex HMAC-SHA512 of the exact raw body under the secret key
 * (PAYSTACK_WEBHOOK_SECRET is tried first when set). Constant-time compare. No keys → false.
 */
export function verifyPaystackSignature(rawBody: string, header: string | null): boolean {
  if (!header || !/^[0-9a-f]{128}$/i.test(header.trim())) return false
  const got = Buffer.from(header.trim().toLowerCase(), "hex")
  for (const key of paymentsConfig().webhookKeys) {
    const want = createHmac("sha512", key).update(rawBody, "utf8").digest()
    if (want.length === got.length && timingSafeEqual(want, got)) return true
  }
  return false
}
