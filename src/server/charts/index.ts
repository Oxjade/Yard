import "server-only"
import { NotImplemented } from "../http/errors"

/**
 * Charts contract (F1 draft; cluster C replaces the bodies and IMPL in wave 2, keeping the
 * signatures). Everything uses db(), so a caller's transaction carries through (§1.3).
 */
export const IMPL: string = "stub"

/** Closes the day's editions at 00:00 UTC for every period and scope used in the last 7 days. */
export async function closeEditions(): Promise<void> {
  throw new NotImplemented("charts.closeEditions")
}

/**
 * Drops cached boards (all, or those a brand appears on) after a status or flag change. The stub
 * caches nothing, so it has nothing to drop: a no-op rather than a throw, because admin decisions
 * call it inside their transaction.
 */
export function invalidate(brandId?: string): void {
  void brandId
}

/** Scheduler jobs, resolved afresh on every tick (§1.3 Schedulers). */
export const jobs = { closeEditions }
