import "server-only"
import { busy, rateLimited } from "../http/errors"
import { log } from "../log"
import { recordAbuse } from "../security/rate-limit"
import { yard } from "../state"

/**
 * SSE stream caps (§4.2), kept on yard.streams so an HMR re-evaluation shares one registry.
 * Each open stream holds a bus listener, timers and a replay query on the single PGlite
 * connection, so these caps protect everyone:
 *  - 4 per session: a fifth sends `bye {reason: "replaced"}` to the session's oldest and closes it;
 *  - 12 per user and surface across all of that user's sessions: a 13th replaces that user's oldest
 *    stream on the surface (`bye replaced`), so one account signed in many times (the IP unknown)
 *    can't hold the process budget on its own; every demo account at its cap is still under 300;
 *  - 20 per client IP, only when the IP is known (§5.1): refused with 429;
 *  - 300 per process: refused with 503 busy and Retry-After: 30.
 * Every refusal, and every replacement by the per-user cap, writes an abuse_events row (rule
 * stream_cap, detail.userId), at most one per key per minute.
 */
export type StreamSlot = { id: string; surface: "market" | "studio" | "admin"; sessionId: string; userId: string; ipHash: string | null; close: (reason: string) => void }

export const STREAM_CAPS = { perSession: 4, perUserSurface: 12, perIp: 20, perProcess: 300 } as const

type Open = StreamSlot & { openedAt: number }
type Registry = { all: Map<string, Open> }

function registry(): Registry {
  return (yard.streams ??= { all: new Map() }) as Registry
}

const bySession = (r: Registry, sessionId: string) => [...r.all.values()].filter((s) => s.sessionId === sessionId).sort((a, b) => a.openedAt - b.openedAt)
const byIp = (r: Registry, ipHash: string) => [...r.all.values()].filter((s) => s.ipHash === ipHash)
const byUser = (r: Registry, userId: string, surface: StreamSlot["surface"]) => [...r.all.values()].filter((s) => s.userId === userId && s.surface === surface)

function refuse(key: string, slot: StreamSlot, detail: Record<string, unknown>) {
  void recordAbuse(`stream_cap:${key}`, { kind: "system", id: null, ipHash: slot.ipHash }, "realtime.open", "stream_cap", { sessionId: slot.sessionId, userId: slot.userId, ...detail }).catch((e) => log.error("[yard] stream_cap abuse row", e))
}

/**
 * Registers a stream before it opens. Evicts the session's oldest beyond 4, and the user's oldest
 * on this surface beyond 12 (each gets `bye` replaced); refuses past the per-IP or process cap.
 * Returns the release function, which is idempotent and must run on every close path.
 */
export function acquireStreamSlot(slot: StreamSlot): () => void {
  const r = registry()
  const mine = bySession(r, slot.sessionId)
  const sessionEvict = mine.length >= STREAM_CAPS.perSession ? mine.slice(0, mine.length - STREAM_CAPS.perSession + 1) : []
  // The user's other streams on this surface, across sessions, oldest first.
  const userOpen = byUser(r, slot.userId, slot.surface)
    .filter((s) => !sessionEvict.includes(s))
    .sort((a, b) => a.openedAt - b.openedAt)
  const userEvict = userOpen.length >= STREAM_CAPS.perUserSurface ? userOpen.slice(0, userOpen.length - STREAM_CAPS.perUserSurface + 1) : []
  const evict = [...sessionEvict, ...userEvict]
  const freed = evict.length

  if (r.all.size - freed >= STREAM_CAPS.perProcess) {
    refuse("process", slot, { cap: STREAM_CAPS.perProcess, open: r.all.size })
    throw busy(30, "Live updates are busy right now. Yard will try again shortly.")
  }
  if (slot.ipHash) {
    const sameIp = byIp(r, slot.ipHash).length - evict.filter((e) => e.ipHash === slot.ipHash).length
    if (sameIp >= STREAM_CAPS.perIp) {
      refuse(`ip:${slot.ipHash}`, slot, { cap: STREAM_CAPS.perIp, open: sameIp })
      throw rateLimited(30, "Too many live connections from this network. Close a few Yard tabs and try again.")
    }
  }
  if (userEvict.length) refuse(`user:${slot.surface}:${slot.userId}`, slot, { cap: STREAM_CAPS.perUserSurface, open: userOpen.length, surface: slot.surface, replaced: userEvict.length })

  for (const old of evict) {
    r.all.delete(old.id)
    try {
      old.close("replaced")
    } catch (e) {
      log.error("[yard] closing a replaced stream", e)
    }
  }
  r.all.set(slot.id, { ...slot, openedAt: Date.now() })
  let released = false
  return () => {
    if (released) return
    released = true
    registry().all.delete(slot.id)
  }
}

/** Open streams right now: the whole process, plus one session's and one IP's (admin health and tests). */
export function streamCounts(filter: { sessionId?: string; ipHash?: string | null; userId?: string; surface?: StreamSlot["surface"] } = {}): { total: number; bySession: number; byIp: number; byUser: number } {
  const r = registry()
  return {
    total: r.all.size,
    bySession: filter.sessionId ? bySession(r, filter.sessionId).length : 0,
    byIp: filter.ipHash ? byIp(r, filter.ipHash).length : 0,
    byUser: filter.userId && filter.surface ? byUser(r, filter.userId, filter.surface).length : 0,
  }
}
