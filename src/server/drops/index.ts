import "server-only"
import { tick } from "./jobs"

/**
 * Drops and draws (ENGAGEMENT v3). Contract for CHECKOUT: checkDropLimit(tx, { customerId,
 * variantIds, lines?, checkoutId? }) inside the checkout transaction, then confirmDropClaims(tx,
 * checkoutId) on payment and releaseDropClaims(tx, checkoutId) on failure (both optional: pending
 * claims also expire after CLAIM_TTL_MIN).
 */
export const IMPL: string = "ENGAGEMENT-v3-2026-11-08"

export { checkDropLimit, confirmDropClaims, releaseDropClaims, CLAIM_TTL_MIN, type DropLimitInput, type DropLimitResult, type DropViolation } from "./limits"
export { DRAW_ALGORITHM, entryKey } from "./draw"
export { phaseOf, loadDrop, type DropRow, type DropPhase } from "./service"
export { default as dropsSeed } from "./seed"

export const jobs = {
  /** Every minute: early access, reminders, draws, starts, winner windows, ends, claim expiry. */
  tick: async () => tick(),
}
