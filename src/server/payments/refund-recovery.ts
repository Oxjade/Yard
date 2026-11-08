/**
 * Refund resend safety (pure: no database, no network, no "server-only", so it is unit-tested).
 *
 * Paystack's POST /refund takes no idempotency key. A send whose outcome is unknown (timeout,
 * connection reset, 5xx) may have created the refund at Paystack, so a later attempt must first
 * ask Paystack (GET /refund?transaction=…) whether the refund already exists, and adopt it instead
 * of sending a second one. Every refund we send carries its Yard id in the merchant note so the
 * lookup can recognise it exactly.
 */

export type ProviderRefund = {
  id: string
  /** Paystack's transaction id for the refunded charge, when the list reports it. */
  transactionId: string | null
  amountMinor: number
  currency: string
  status: "pending" | "succeeded" | "failed"
  note: string | null
  createdAt: Date | null
}

export type RefundForResend = { id: string; amountMinor: number; currency: string; attempts: number; createdAt: Date }

export type ResendDecision = { action: "send" } | { action: "adopt"; providerRef: string; status: "pending" | "succeeded" | "failed" } | { action: "wait"; reason: string }

const tagOf = (refundId: string) => `[yard:${refundId}]`

/** The merchant note sent with a refund: the reason, then the Yard refund id (always kept whole). */
export function refundNote(reason: string, refundId: string): string {
  const tag = tagOf(refundId)
  return `${reason.slice(0, Math.max(0, 200 - tag.length - 1))} ${tag}`.trim()
}

/** The Yard refund id carried in a provider refund's merchant note, if any. */
export function refundIdFromNote(note: unknown): string | null {
  if (typeof note !== "string") return null
  const m = /\[yard:([\w-]{1,64})\]/.exec(note)
  return m ? m[1] : null
}

/**
 * Finds the provider refund that is this Yard refund: one whose note carries its id, or else one
 * on the same Paystack transaction for the same amount and currency, created no earlier than the
 * Yard row (a minute of clock skew allowed), that no other Yard refund already claims.
 */
export function matchProviderRefund(rf: RefundForResend, found: ProviderRefund[], ctx: { transactionId: string | null; takenRefs: ReadonlySet<string> }): ProviderRefund | null {
  const byNote = found.find((p) => refundIdFromNote(p.note) === rf.id)
  if (byNote) return byNote
  if (!ctx.transactionId) return null
  return (
    found.find(
      (p) =>
        !ctx.takenRefs.has(p.id) &&
        !refundIdFromNote(p.note) &&
        p.transactionId === ctx.transactionId &&
        p.amountMinor === rf.amountMinor &&
        p.currency === rf.currency &&
        p.status !== "failed" &&
        (!p.createdAt || p.createdAt.getTime() >= rf.createdAt.getTime() - 60_000),
    ) ?? null
  )
}

/**
 * What to do with a pending refund that has no provider reference. The first attempt sends. Any
 * later attempt (an earlier send may have reached Paystack) looks the refund up first: found →
 * adopt it; lookup failed → wait for the next run (never send blind); not there → send.
 */
export async function decideResend(rf: RefundForResend, lookup: () => Promise<ProviderRefund[]>, ctx: { transactionId: string | null; takenRefs: ReadonlySet<string> }): Promise<ResendDecision> {
  if (rf.attempts <= 0) return { action: "send" }
  let found: ProviderRefund[]
  try {
    found = await lookup()
  } catch (e) {
    return { action: "wait", reason: `Couldn't check the provider for an earlier send: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }
  }
  const hit = matchProviderRefund(rf, found, ctx)
  return hit ? { action: "adopt", providerRef: hit.id, status: hit.status } : { action: "send" }
}

/**
 * The refund-row change a refund webhook calls for. An in-progress event (refund.pending /
 * refund.processing) for a row we already hold as pending still records the provider reference,
 * so the retry job never resends a refund Paystack already has.
 */
export function refundEventChange(
  rf: { status: string; providerRef: string | null },
  status: "pending" | "succeeded" | "failed",
  providerRef: string,
): { kind: "none" } | { kind: "ref"; providerRef: string } | { kind: "final" } | { kind: "ignored" } {
  if (rf.status === status) return status === "pending" && !rf.providerRef && providerRef ? { kind: "ref", providerRef } : { kind: "none" }
  if (rf.status === "succeeded" || rf.status === "failed") return { kind: "ignored" }
  return { kind: "final" }
}
