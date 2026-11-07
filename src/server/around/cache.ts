import "server-only"
import { invalidateMemo, memo } from "../cache"

/**
 * The public place lists are memoised in-process for up to 60 s (§1.6 rule 2: no 'use cache'
 * around DB reads). Every Studio write and every admin decision calls invalidate() after commit,
 * so a change reaches the next request at once; browsers may keep a list for up to a minute.
 */
export const PLACES_TTL_MS = 60_000

export function aroundMemo<T>(key: string, load: () => Promise<T>) {
  return memo(`around:${key}`, PLACES_TTL_MS, load)
}

export function invalidate(): void {
  invalidateMemo("around:")
}
