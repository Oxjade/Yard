import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { log } from "../log"
import { paymentsConfig } from "./config"
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

export type InitInput = { reference: string; email: string; amountMinor: number; currency: string; callbackUrl: string; metadata: Record<string, string>; splitCode?: string | null }
export type InitResult = { authorizationUrl: string | null; accessCode: string | null }

/** A transaction's state as the provider reports it. `pending` covers Paystack's abandoned/ongoing/processing/queued. */
export type ChargeState = {
  reference: string
  status: "success" | "failed" | "pending"
  amountMinor: number
  currency: string
  providerTxnId: string | null
  paidAt: Date | null
  channel: string | null
  reason: string | null
  raw: unknown
}

export type RefundInput = { transactionReference: string; amountMinor: number; currency: string; note: string }
export type RefundResult = { providerRef: string; status: "pending" | "succeeded" | "failed" }

export type TransferInput = { reference: string; amountMinor: number; currency: string; recipientCode: string; reason: string }
export type TransferResult = { providerRef: string; status: "pending" | "succeeded" | "failed"; reason: string | null }

export interface PaymentProvider {
  kind: "paystack" | "stub"
  initialize(input: InitInput): Promise<InitResult>
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

export function getProvider(): PaymentProvider {
  const cfg = paymentsConfig()
  return cfg.provider === "paystack" && cfg.secretKey ? paystackProvider(cfg.secretKey) : stubProvider
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
