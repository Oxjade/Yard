import "server-only"
import { yard } from "./state"

/**
 * In-process TTL memo for hot public reads (chart boards, place lists). v2 has no 'use cache'
 * around DB reads (§1.6 rule 2), so this is the cache. The memo stores the promise, so
 * concurrent callers share one load; a rejected load is dropped at once.
 */
export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const m = (yard.memo ??= new Map())
  const hit = m.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load()
  m.set(key, { at: Date.now(), value })
  value.catch(() => {
    if (m.get(key)?.value === value) m.delete(key)
  })
  return value
}

/** Drops every memo whose key starts with `prefix` (for example "charts:" or "around:"). */
export function invalidateMemo(prefix: string) {
  const m = yard.memo
  if (!m) return
  for (const k of [...m.keys()]) if (k.startsWith(prefix)) m.delete(k)
}
