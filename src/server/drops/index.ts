import "server-only"
import { eq } from "drizzle-orm"
import type { Executor } from "../db"
import { dropClaims, dropEntries } from "../db/schema/engagement"
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

/** AUTH erasure hook: the shopper's draw entries and drop claims go (an erased account can't buy). */
export async function eraseCustomerData(tx: Executor, userId: string): Promise<{ erased: number }> {
  const e = await tx.delete(dropEntries).where(eq(dropEntries.userId, userId)).returning({ id: dropEntries.id })
  const c = await tx.delete(dropClaims).where(eq(dropClaims.userId, userId)).returning({ id: dropClaims.id })
  return { erased: e.length + c.length }
}
