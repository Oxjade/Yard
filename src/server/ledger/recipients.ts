import "server-only"
import { createHash } from "node:crypto"
import { log } from "../log"

/**
 * Transfer recipients (the provider-side handle a payout is sent to). Behind an interface: the
 * live Paystack implementation is used when PAYSTACK_SECRET_KEY is set; otherwise the STUB, which
 * returns a clearly-labelled `RCP_stub_…` code and `provider: "stub"`. Stub recipients are shown
 * as "test account" in Studio and are never sent to a live provider. Network I/O: call outside a
 * transaction.
 */
export type RecipientInput = { brandId: string; country: string; currency: string; bankCode: string; accountNumber: string; accountName: string }
export type RecipientResult = { ok: true; provider: "stub" | "paystack"; recipientCode: string; resolvedName: string | null } | { ok: false; reason: "unsupported_currency" | "rejected" | "unavailable"; message: string }

export interface RecipientProvider {
  readonly id: "stub" | "paystack"
  create(input: RecipientInput): Promise<RecipientResult>
}

const stub: RecipientProvider = {
  id: "stub",
  async create(input) {
    const h = createHash("sha256").update(`${input.brandId}|${input.bankCode}|${input.accountNumber}`).digest("hex").slice(0, 16)
    return { ok: true, provider: "stub", recipientCode: `RCP_stub_${h}`, resolvedName: null }
  },
}

/** Paystack recipient types by currency (https://paystack.com/docs/transfers/creating-transfer-recipients). */
const PAYSTACK_TYPES: Record<string, string> = { NGN: "nuban", GHS: "ghipss", ZAR: "basa", KES: "kepss" }

function paystack(secret: string): RecipientProvider {
  return {
    id: "paystack",
    async create(input) {
      const type = PAYSTACK_TYPES[input.currency]
      if (!type) return { ok: false, reason: "unsupported_currency", message: `Payouts in ${input.currency} aren't supported yet.` }
      try {
        const res = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type, name: input.accountName, account_number: input.accountNumber, bank_code: input.bankCode, currency: input.currency, metadata: { brand_id: input.brandId } }),
          signal: AbortSignal.timeout(15_000),
        })
        const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { recipient_code?: string; details?: { account_name?: string } } } | null
        if (!res.ok || !body?.status || !body.data?.recipient_code) {
          return { ok: false, reason: res.status >= 500 ? "unavailable" : "rejected", message: "The bank couldn't confirm this account. Check the bank and account number." }
        }
        return { ok: true, provider: "paystack", recipientCode: body.data.recipient_code, resolvedName: body.data.details?.account_name ?? null }
      } catch (e) {
        log.warn(`[yard] paystack recipient creation failed: ${e instanceof Error ? e.name : "error"}`)
        return { ok: false, reason: "unavailable", message: "We couldn't reach the payment provider. Try again shortly." }
      }
    },
  }
}

export function recipientProvider(): RecipientProvider {
  const secret = process.env.PAYSTACK_SECRET_KEY
  return secret ? paystack(secret) : stub
}
