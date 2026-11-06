import "server-only"
import { NotImplemented } from "../http/errors"

/**
 * F2 owns the SSE endpoint (§4.2): GET /api/realtime/[surface] streams `retry`, replay
 * (partial, redacted), `hello`, live events, a 20 s `: ping` that re-reads the session row, a
 * 10-minute `bye`, and closes on `session.ended`. These are the signatures F1 drafted.
 */
export type Surface = "market" | "studio" | "admin"

export type StreamIdentity = { surface: Surface; sessionId: string; userId: string; brandId: string | null; ipHash: string | null }

/** Builds the event-stream Response for an authenticated identity. */
export async function openStream(identity: StreamIdentity, req: Request): Promise<Response> {
  void identity
  void req
  throw new NotImplemented("realtime.openStream")
}

/** Encodes one SSE frame: `id: <seq>\nevent: <type>\ndata: <json>\n\n` (no id for ephemeral events). */
export function frame(type: string, data: unknown, id?: number) {
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** The JSON polling fallback: redacted events after `after` on the identity's channels. */
export async function pollEvents(identity: StreamIdentity, after: number): Promise<{ events: { seq: number; type: string; payload: unknown; partial: true }[]; lastSeq: number }> {
  void identity
  void after
  throw new NotImplemented("realtime.pollEvents")
}
