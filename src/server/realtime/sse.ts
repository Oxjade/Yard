import "server-only"
import { randomBytes } from "node:crypto"
import { and, asc, gt, inArray, max, min } from "drizzle-orm"
import { sessionById } from "../auth/session"
import { db } from "../db"
import { realtimeEvents } from "../db/schema"
import { log } from "../log"
import { subscribe, type BusEvent } from "./bus"
import { channels as ch, surfaceChannels } from "./channels"
import { acquireStreamSlot } from "./streams"

/**
 * GET /api/realtime/[surface] (§4.2). One event stream per tab and surface:
 *   retry → replay (redacted rows, `"partial": true`) or resync → hello → live events,
 *   `: ping` every 20 s (each ping re-reads the session row), `bye` after 10 minutes, and
 *   `session.ended` + close the moment the session is ended (sign-out, switch, suspension).
 * The bus is subscribed BEFORE the replay query and live events are buffered until the replay is
 * written, so nothing published while the stream opens falls into the gap between the two.
 */
export type Surface = "market" | "studio" | "admin"

export type StreamIdentity = { surface: Surface; sessionId: string; userId: string; brandId: string | null; ipHash: string | null }

export const PING_MS = 20_000
export const MAX_STREAM_MS = 10 * 60_000
export const REPLAY_LIMIT = 500

/** Encodes one SSE frame: `id: <seq>\nevent: <type>\ndata: <json>\n\n` (no id for ephemeral events). */
export function frame(type: string, data: unknown, id?: number) {
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`
}

/** A replayed (stored, redacted) event: the durable payload plus `partial: true`. */
const partial = (payload: unknown) => ({ ...((payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>), partial: true as const })

function parseSeq(v: string | null | undefined) {
  if (v == null || !/^\d{1,12}$/.test(v.trim())) return null
  return Number(v.trim())
}

/** The id the client already has: the Last-Event-ID header (EventSource reconnects) or ?lastEventId= (a reopen by hand). */
export function lastEventIdOf(req: Request) {
  return parseSeq(req.headers.get("last-event-id")) ?? parseSeq(new URL(req.url).searchParams.get("lastEventId"))
}

/** Oldest and newest retained seq across the whole log (the sequence is global). */
async function bounds() {
  const d = await db()
  const [row] = await d.select({ lo: min(realtimeEvents.seq), hi: max(realtimeEvents.seq) }).from(realtimeEvents)
  return { lo: row?.lo ?? null, hi: row?.hi ?? 0 }
}

/**
 * Stored events after `after` on `list`, oldest first. `resync` is true when the log no longer
 * holds everything after `after` (purged after 24 h) or more than the limit is waiting: the client
 * then refetches its lists instead of trusting a partial replay.
 */
async function storedAfter(list: string[], after: number) {
  const { lo, hi } = await bounds()
  if (lo !== null && after < lo - 1) return { rows: [], resync: true, head: hi }
  const d = await db()
  const rows = await d
    .select({ seq: realtimeEvents.seq, type: realtimeEvents.type, payload: realtimeEvents.payload })
    .from(realtimeEvents)
    .where(and(inArray(realtimeEvents.channel, list), gt(realtimeEvents.seq, after)))
    .orderBy(asc(realtimeEvents.seq))
    .limit(REPLAY_LIMIT)
  return { rows, resync: rows.length >= REPLAY_LIMIT, head: Math.max(hi, rows.at(-1)?.seq ?? 0) }
}

/** Builds the event-stream Response for an authenticated identity. Throws busy/rate_limited past a stream cap. */
export async function openStream(identity: StreamIdentity, req: Request): Promise<Response> {
  const list = surfaceChannels(identity.surface, { userId: identity.userId, sessionId: identity.sessionId, brandId: identity.brandId })
  const sessionChannel = ch.session(identity.sessionId)
  const lastEventId = lastEventIdOf(req)
  const enc = new TextEncoder()

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  let maxAge: ReturnType<typeof setTimeout> | null = null
  let release: () => void = () => {}

  const cleanup = () => {
    closed = true
    unsubscribe?.()
    unsubscribe = null
    if (ping) clearInterval(ping)
    if (maxAge) clearTimeout(maxAge)
    ping = maxAge = null
    release()
  }
  const write = (s: string) => {
    if (closed || !controller) return
    try {
      controller.enqueue(enc.encode(s))
    } catch {
      cleanup()
    }
  }
  const end = (last?: string) => {
    if (closed) return
    if (last) write(last)
    const c = controller
    cleanup()
    try {
      c?.close()
    } catch {
      /* already closed by the client */
    }
  }

  // Caps first: a refused stream never opens (throws 503 busy / 429).
  release = acquireStreamSlot({ id: randomBytes(8).toString("hex"), surface: identity.surface, sessionId: identity.sessionId, userId: identity.userId, ipHash: identity.ipHash, close: (reason) => end(frame("bye", { reason })) })

  const deliver = (e: BusEvent) => {
    if (e.type === "session.ended" && e.channel === sessionChannel) {
      end(frame("session.ended", e.payload ?? { reason: "ended" }))
      return
    }
    write(frame(e.type, e.payload, e.seq))
  }

  const revalidate = async () => {
    try {
      const row = await sessionById(identity.sessionId)
      const valid = !!row && row.userId === identity.userId && (identity.surface !== "studio" || row.activeBrandId === identity.brandId)
      if (!valid) end(frame("session.ended", { reason: "expired" }))
    } catch (e) {
      log.error("[yard] stream ping", e)
    }
  }

  const init = async () => {
    // Subscribe first and buffer, so an event committed while the replay runs isn't lost.
    let buffer: BusEvent[] | null = []
    unsubscribe = subscribe(list, (e) => {
      if (buffer) buffer.push(e)
      else deliver(e)
    })
    let replayedUpTo = 0
    let head: number
    if (lastEventId !== null) {
      const r = await storedAfter(list, lastEventId)
      if (r.resync) write(frame("resync", {}))
      for (const row of r.rows) {
        write(frame(row.type, partial(row.payload), row.seq))
        replayedUpTo = row.seq
      }
      head = r.head
    } else {
      head = (await bounds()).hi
    }
    if (closed) return
    write(frame("hello", { lastSeq: Math.max(head, replayedUpTo, lastEventId ?? 0), serverTime: new Date().toISOString() }))
    const pending = buffer
    buffer = null
    for (const e of pending) if (e.seq === undefined || e.seq > replayedUpTo) deliver(e)
    ping = setInterval(() => {
      write(": ping\n\n")
      void revalidate()
    }, PING_MS)
    maxAge = setTimeout(() => end(frame("bye", { reason: "refresh" })), MAX_STREAM_MS)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      write("retry: 3000\n\n")
      init().catch((e) => {
        log.error("[yard] stream open", e)
        end(frame("bye", { reason: "error" }))
      })
    },
    cancel() {
      cleanup()
    },
  })
  req.signal?.addEventListener("abort", cleanup, { once: true })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: Next's compression (dev and start) skips the response, so nothing buffers it.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

/** The JSON polling fallback (§4.3): redacted events after `after` on the identity's channels. */
export async function pollEvents(identity: StreamIdentity, after: number | null): Promise<{ events: { seq: number; type: string; payload: unknown; partial: true }[]; lastSeq: number; resync: boolean }> {
  const list = surfaceChannels(identity.surface, { userId: identity.userId, sessionId: identity.sessionId, brandId: identity.brandId })
  if (after === null) return { events: [], lastSeq: (await bounds()).hi, resync: false }
  const r = await storedAfter(list, after)
  return {
    events: r.rows.map((row) => ({ seq: row.seq, type: row.type, payload: row.payload, partial: true as const })),
    lastSeq: Math.max(r.head, after),
    resync: r.resync,
  }
}
