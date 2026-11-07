import type { AddressDraft, ContactDraft, PaymentDraft } from "./rules"
import type { ShippingMethod } from "./shipping"

/*
 * The checkout draft: what the shopper has typed so far, kept for this tab only
 * (sessionStorage), so a reload or a trip back to the bag doesn't lose it. Card number,
 * expiry and security code are never stored. Storage can be unavailable (private mode,
 * blocked site data), so every access is guarded and the checkout works without it.
 */

const KEY = "nocturne-checkout-draft"
const VERSION = 1

export type CheckoutDraft = {
  /** The account the draft belongs to: another sign-in on this tab starts fresh. */
  owner: string
  step: number
  furthest: number
  contact: ContactDraft
  address: AddressDraft
  shipping: Record<string, ShippingMethod>
  payment: Omit<PaymentDraft, "cardNumber" | "expiry" | "cvc">
  /**
   * The checkout attempt's idempotency key (§6.5): a retry after a reload, when the first answer
   * was lost, registers nothing new and returns the same server group.
   */
  idempotencyKey?: string
}

export function readCheckoutDraft(owner: string): CheckoutDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: number; draft?: CheckoutDraft }
    if (parsed.v !== VERSION || !parsed.draft || parsed.draft.owner !== owner) return null
    return parsed.draft
  } catch {
    return null
  }
}

export function writeCheckoutDraft(draft: CheckoutDraft) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ v: VERSION, draft }))
  } catch {
    // Storage full or blocked: the checkout carries on without a saved draft.
  }
}

export function clearCheckoutDraft() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
