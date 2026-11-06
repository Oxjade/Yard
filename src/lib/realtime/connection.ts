"use client"

import { api, ApiError } from "@/lib/api/client"
import type { NotificationDto } from "@/lib/api/contracts/notifications"
import { realtimeEvents, type PollResult, type RealtimeMeta, type RealtimeStatus, type Surface } from "@/lib/api/contracts/realtime"

/**
 * One surface's live connection (§4.3), owned by RealtimeProvider and rebuilt whenever the
 * identity key changes. EventSource first: the browser reconnects by itself with Last-Event-ID
 * after a network blip (the server says `retry: 3000`). After 3 failures within 60 s, or without
 * EventSource, it polls GET /api/realtime/<surface>/poll every 15 s while the tab is visible and
 * tries the stream again after 5 minutes. A tab hidden for 60 s closes its stream and reopens
 * with ?lastEventId= when it's visible again. `navigator.onLine === false` → offline.
 */
export type Dispatch = (type: string, payload: unknown, meta: RealtimeMeta) => void

export type ConnectionHooks = {
  surface: Surface
  dispatch: Dispatch
  setStatus: (s: RealtimeStatus) => void
  /** The stream said session.ended: re-read the session, and reopen at once if the identity is unchanged. */
  onSessionEnded: () => void
  /**
   * The stream was refused (401, 429, 503…) or a poll answered 401: re-read the session only. A
   * changed identity rebuilds the connection; otherwise the backoff decides when to try again.
   */
  onRefused: () => void
  /** The stream (or the first poll) is up: refresh notifications and unread counts. */
  onOpen: (first: boolean) => void
}

export const POLL_MS = 15_000
export const HIDDEN_CLOSE_MS = 60_000
export const FAILURE_WINDOW_MS = 60_000
export const SSE_RETRY_FROM_POLL_MS = 5 * 60_000

/** Every event type the contract knows, plus control frames, so the EventSource listens for each by name. */
const CONTRACT_TYPES = [...Object.keys(realtimeEvents), "resync", "hello", "bye", "session.ended"]

export function createConnection(h: ConnectionHooks) {
  const types = new Set<string>(CONTRACT_TYPES)
  let es: EventSource | null = null
  let disposed = false
  let mode: "sse" | "poll" = typeof window !== "undefined" && typeof window.EventSource === "function" ? "sse" : "poll"
  /** Set after bye(replaced): another tab of this session took the slot, so don't fight it for one. */
  let yielded = false
  let failures: number[] = []
  let lastSeq: number | null = null
  let lastIdSeen = ""
  let opened = false
  let pollTimer: number | null = null
  let sseRetryTimer: number | null = null
  let hiddenTimer: number | null = null
  let pausedForHidden = false
  let offline = typeof navigator !== "undefined" && navigator.onLine === false

  const clearTimer = (t: number | null) => {
    if (t !== null) window.clearTimeout(t)
  }

  function noteSeq(seq: number | undefined) {
    if (seq !== undefined && (lastSeq === null || seq > lastSeq)) lastSeq = seq
  }

  function opening() {
    h.onOpen(!opened)
    opened = true
  }

  function handleFrame(type: string, ev: MessageEvent<string>) {
    if (disposed) return
    let data: unknown = {}
    try {
      data = ev.data ? JSON.parse(ev.data) : {}
    } catch {
      return
    }
    // A durable event carries an id line; EventSource repeats the last id on events that don't.
    let seq: number | undefined
    if (ev.lastEventId && ev.lastEventId !== lastIdSeen) {
      lastIdSeen = ev.lastEventId
      const n = Number(ev.lastEventId)
      if (Number.isFinite(n)) seq = n
    }
    noteSeq(seq)
    let partial = false
    if (data && typeof data === "object" && (data as { partial?: unknown }).partial === true) {
      partial = true
      const { partial: _drop, ...rest } = data as Record<string, unknown>
      void _drop
      data = rest
    }
    switch (type) {
      case "hello": {
        const hello = data as { lastSeq?: number }
        if (typeof hello.lastSeq === "number") noteSeq(hello.lastSeq)
        failures = []
        h.setStatus("open")
        opening()
        return
      }
      case "bye": {
        const reason = (data as { reason?: string }).reason
        closeSse()
        if (reason === "replaced") {
          // A fifth stream on this session (another tab) replaced this one: poll instead of evicting it back.
          yielded = true
          startPolling()
        } else if (reason === "error") {
          // The server couldn't open the stream: back off like any other failure.
          if (noteFailure()) startPolling()
          else sseRetryTimer = window.setTimeout(openSse, 3000 * failures.length)
        } else openSse()
        return
      }
      case "session.ended": {
        closeSse()
        h.setStatus("connecting")
        h.onSessionEnded()
        return
      }
    }
    h.dispatch(type, data, { seq, partial })
  }

  function listen(type: string) {
    if (!es) return
    es.addEventListener(type, (ev) => handleFrame(type, ev as MessageEvent<string>))
  }

  function noteFailure() {
    const now = Date.now()
    failures = [...failures.filter((t) => now - t < FAILURE_WINDOW_MS), now]
    return failures.length >= 3
  }

  function closeSse() {
    if (es) {
      es.onerror = null
      es.close()
      es = null
    }
  }

  function openSse() {
    if (disposed || offline) return
    closeSse()
    if (mode !== "sse") return
    const url = `/api/realtime/${h.surface}${lastSeq !== null ? `?lastEventId=${lastSeq}` : ""}`
    h.setStatus(opened ? "retrying" : "connecting")
    let source: EventSource
    try {
      source = new EventSource(url)
    } catch {
      mode = "poll"
      startPolling()
      return
    }
    es = source
    for (const t of types) listen(t)
    source.onerror = () => {
      if (disposed || es !== source) return
      const tooMany = noteFailure()
      if (source.readyState === EventSource.CLOSED || tooMany) {
        // Closed for good (401, 429, 503…) or failing repeatedly: stop the browser's own retries.
        closeSse()
        if (tooMany) {
          startPolling()
          return
        }
        // A refusal may mean the session ended: let the provider re-check who is signed in.
        h.onRefused()
        clearTimer(sseRetryTimer)
        sseRetryTimer = window.setTimeout(openSse, 3000 * failures.length)
      } else {
        h.setStatus("retrying")
      }
    }
  }

  async function poll() {
    pollTimer = null
    if (disposed || offline) return
    if (!document.hidden) {
      try {
        const r = await api<PollResult>(`/api/realtime/${h.surface}/poll`, { query: { after: lastSeq ?? undefined } })
        if (disposed) return
        if (r.resync) h.dispatch("resync", {}, { partial: true })
        for (const e of r.events) {
          noteSeq(e.seq)
          h.dispatch(e.type, e.payload, { seq: e.seq, partial: true })
        }
        noteSeq(r.lastSeq)
        h.setStatus("polling")
        if (!opened) opening()
      } catch (e) {
        if (disposed) return
        if (e instanceof ApiError && e.status === 401) h.onRefused()
        h.setStatus(e instanceof ApiError && e.status === 0 ? "offline" : "polling")
      }
    }
    if (!disposed) pollTimer = window.setTimeout(poll, POLL_MS)
  }

  function startPolling() {
    closeSse()
    mode = "poll"
    h.setStatus("polling")
    clearTimer(pollTimer)
    pollTimer = window.setTimeout(poll, 0)
    clearTimer(sseRetryTimer)
    // Try the stream again later, unless another tab holds this session's slots or there's no EventSource.
    if (!yielded && typeof window.EventSource === "function")
      sseRetryTimer = window.setTimeout(() => {
        if (disposed || offline) return
        clearTimer(pollTimer)
        pollTimer = null
        failures = []
        mode = "sse"
        openSse()
      }, SSE_RETRY_FROM_POLL_MS)
  }

  function resume() {
    if (disposed || offline) return
    if (mode === "sse") openSse()
    else startPolling()
  }

  const onVisibility = () => {
    if (document.hidden) {
      clearTimer(hiddenTimer)
      hiddenTimer = window.setTimeout(() => {
        hiddenTimer = null
        if (!document.hidden || disposed) return
        pausedForHidden = true
        closeSse()
        clearTimer(pollTimer)
        pollTimer = null
        h.setStatus("idle")
      }, HIDDEN_CLOSE_MS)
    } else {
      clearTimer(hiddenTimer)
      hiddenTimer = null
      if (pausedForHidden) {
        pausedForHidden = false
        resume()
      }
    }
  }
  const onOffline = () => {
    offline = true
    closeSse()
    clearTimer(pollTimer)
    pollTimer = null
    h.setStatus("offline")
  }
  const onOnline = () => {
    offline = false
    failures = []
    resume()
  }

  return {
    start() {
      document.addEventListener("visibilitychange", onVisibility)
      window.addEventListener("offline", onOffline)
      window.addEventListener("online", onOnline)
      if (offline) h.setStatus("offline")
      else if (mode === "sse") openSse()
      else startPolling()
    },
    /** Listens for an event type the contract doesn't list (a handler registered for it). */
    listen(type: string) {
      if (types.has(type)) return
      types.add(type)
      listen(type)
    },
    /** Reopens after the session was re-checked and the identity is unchanged. */
    reopen() {
      failures = []
      if (!yielded) mode = typeof window.EventSource === "function" ? "sse" : "poll"
      resume()
    },
    stop() {
      disposed = true
      closeSse()
      clearTimer(pollTimer)
      clearTimer(sseRetryTimer)
      clearTimer(hiddenTimer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    },
  }
}

export type Connection = ReturnType<typeof createConnection>

/** The kind each surface reads as (?as= on /api/notifications). */
export const actorKindOf: Record<Surface, "shopper" | "brand" | "admin"> = { market: "shopper", studio: "brand", admin: "admin" }

/** GET /api/notifications?as=&after= for the bridge (§2.7). */
export function fetchServerNotifications(surface: Surface, after: string | null) {
  return api<{ items: NotificationDto[] }>("/api/notifications", { query: { as: actorKindOf[surface], after: after ?? undefined } })
}

/** The inbox unread endpoints (cluster I); the admin surface has none. */
export const unreadEndpoint: Record<Surface, string | null> = { market: "/api/inbox/unread", studio: "/api/studio/inbox/unread", admin: null }
