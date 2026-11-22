/**
 * One-tap batches in Studio: "Accept all" for Suggestions from Yard and "Add all" for pieces from
 * the brand's own website. Pure (no imports), so the rules are unit-tested under `tsx --test`:
 *
 * - which items a batch takes (the ids asked for, or every pending one; never one that isn't
 *   pending any more, never an edit whose product changed since Yard suggested it);
 * - each item through the existing single-item path, one at a time, each in its own transaction:
 *   a failure rolls back only that item, which stays pending with the reason;
 * - an action key (idempotency): the same key answers with the first run's result, nothing twice.
 */

export type BatchSkip = { id: string; reason: string }
export type BatchResult = { accepted: string[]; skipped: BatchSkip[] }

/** At most this many items in one batch (a mass website import is typically a few dozen). */
export const BATCH_MAX = 200

export const NOT_PENDING_REASON = "Already answered or withdrawn. Reload to see where it stands."
export const STALE_REASON = "The product changed since Yard suggested this. Open it to review the changes first."

export type PendingSuggestion = { id: string; kind: string; productId: string | null; baseVersion: number | null }

/**
 * The batch's plan: `ids` (deduplicated, in the order asked) or, without ids, every pending
 * suggestion (oldest first, as given). An edit is taken only against the product version it was
 * made for (the same rule as the claim auto-accept); otherwise it's skipped and stays pending.
 */
export function planSuggestionBatch(ids: string[] | undefined, pending: PendingSuggestion[], productVersions: ReadonlyMap<string, number>): { take: string[]; skipped: BatchSkip[] } {
  const byId = new Map(pending.map((p) => [p.id, p]))
  const wanted = ids ? [...new Set(ids)] : pending.map((p) => p.id)
  const take: string[] = []
  const skipped: BatchSkip[] = []
  for (const id of wanted.slice(0, BATCH_MAX)) {
    const p = byId.get(id)
    if (!p) skipped.push({ id, reason: NOT_PENDING_REASON })
    else if (p.kind === "edit" && (p.baseVersion == null || p.productId == null || productVersions.get(p.productId) !== p.baseVersion)) skipped.push({ id, reason: STALE_REASON })
    else take.push(id)
  }
  return { take, skipped }
}

/** Runs `one` for each id in turn. A throw skips that id with its reason and the batch carries on. */
export async function runBatch(ids: string[], one: (id: string) => Promise<unknown>, reasonOf: (e: unknown) => string = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 200)): Promise<BatchResult> {
  const out: BatchResult = { accepted: [], skipped: [] }
  for (const id of ids) {
    try {
      await one(id)
      out.accepted.push(id)
    } catch (e) {
      out.skipped.push({ id, reason: reasonOf(e) })
    }
  }
  return out
}

/** The plan's skips first, then the run's, in one result. */
export const mergeBatch = (planSkipped: BatchSkip[], run: BatchResult): BatchResult => ({ accepted: run.accepted, skipped: [...planSkipped, ...run.skipped] })

/**
 * An action key: a retry of the same request (a double tap, a flaky connection) answers with the
 * result the first run saved instead of running again. Concurrent runs with the same key are the
 * caller's to serialise (the server holds one lock per brand around this).
 */
export async function onceForKey<T extends object>(key: string, store: { load: (key: string) => Promise<T | null>; save: (key: string, result: T) => Promise<void> }, run: () => Promise<T>): Promise<T & { replayed?: boolean }> {
  const earlier = await store.load(key)
  if (earlier) return { ...earlier, replayed: true }
  const result = await run()
  await store.save(key, result)
  return result
}

/** "Yard prepared 12 products for you. Accept all in one tap" (Studio overview card and the brand emails). */
export const preparedLine = (n: number) => `Yard prepared ${n} ${n === 1 ? "product" : "products"} for you. Accept ${n === 1 ? "it" : "all"} in one tap`

/** Where the overview card and the emails link: the list, with Accept all in focus. */
export const ACCEPT_ALL_HREF = "/studio/products/suggestions?focus=accept-all"
