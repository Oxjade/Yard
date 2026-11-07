import "server-only"
import type { EventEmitter } from "node:events"

/**
 * Process-wide singletons, kept on globalThis so Turbopack's HMR re-evaluation of a module never
 * opens a second database, bus or limiter (§10 "HMR module duplication"). Store promises, not
 * results, so concurrent first callers share one boot.
 */
export type YardState = {
  /** The PGlite + drizzle boot promise (src/server/db/client.ts). */
  db?: Promise<unknown>
  /** Journal entry count applied at boot, for the "schema changed" notice. */
  migrations?: { applied: number; checkedAt: number; warned: boolean; applying?: Promise<unknown> }
  env?: unknown
  keys?: unknown
  bus?: EventEmitter
  limiter?: unknown
  /** SSE stream registry (F2, §4.2). */
  streams?: unknown
  /** Schedulers started (src/server/schedulers.ts). */
  schedulers?: boolean
  /** The IMPL each scheduled job last ran with, so a change is logged once. */
  jobImpl?: Record<string, string>
  /** Messages already logged once. */
  logged?: Set<string>
  /** In-process TTL memos (src/server/cache.ts). */
  memo?: Map<string, { at: number; value: Promise<unknown> }>
  /** Free-form slots for feature modules (per-key mutexes and the like). */
  slots?: Record<string, unknown>
}

const g = globalThis as unknown as { __yard?: YardState }
export const yard: YardState = (g.__yard ??= {})
