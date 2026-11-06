import "server-only"
import { NotImplemented } from "../http/errors"

/**
 * F2: per-session (4), per-IP (20) and per-process (300) stream caps, kept on yard.streams
 * (§4.2). Signatures drafted by F1.
 */
export type StreamSlot = { id: string; sessionId: string; ipHash: string | null; close: (reason: string) => void }

/** Registers a stream, evicting the session's oldest beyond 4. Throws busy (503) past the process cap. */
export function acquireStreamSlot(slot: StreamSlot): () => void {
  void slot
  throw new NotImplemented("realtime.acquireStreamSlot")
}

/** Open streams right now (admin health and tests). */
export function streamCounts(): { total: number; bySession: number; byIp: number } {
  throw new NotImplemented("realtime.streamCounts")
}
