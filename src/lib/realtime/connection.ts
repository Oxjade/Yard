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
 * A tab whose stream another tab replaced (`bye replaced`, a 5th stream on the session) polls,
 * and tries the stream again whenever it becomes visible or focused, and every 75 s while it stays
 * visible: hidden tabs close their streams after 60 s, so a slot is usually free by then.
 * Every (re)open, and the first poll after switching to polling, calls onOpen.
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
/** A replaced tab's retry while visible: after the other tabs' 60 s hidden close, plus a margin. */
export const SSE_RETRY_YIELDED_MS = HIDDEN_CLOSE_MS + 15_000
/** At most one visibility/focus-driven retry per this long, so flipping tabs doesn't churn streams. */
const YIELDED_RETRY_MIN_GAP_MS = 10_000

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
  /** True from startPolling until the first successful poll, which announces the (re)open. */
  let pollFresh = false
  let lastYieldedRetry = 0
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
        if (pollFresh) {
          pollFresh = false
          opening()
        }
      } catch (e) {
        if (disposed) return
        if (e instanceof ApiError && e.status === 401) h.onRefused()
        h.setStatus(e instanceof ApiError && e.status === 0 ? "offline" : "polling")
      }
    }
    if (!disposed) pollTimer = window.setTimeout(poll, POLL_MS)
  }

  /** Back to the stream from polling (the retry timer, or a replaced tab becoming visible). */
  function retrySse() {
    sseRetryTimer = null
    if (disposed || offline || typeof window.EventSource !== "function") return
    clearTimer(pollTimer)
    pollTimer = null
    failures = []
    yielded = false
    mode = "sse"
    openSse()
  }

  function startPolling() {
    closeSse()
    mode = "poll"
    pollFresh = true
    h.setStatus("polling")
    clearTimer(pollTimer)
    pollTimer = window.setTimeout(poll, 0)
    clearTimer(sseRetryTimer)
    sseRetryTimer = null
    if (typeof window.EventSource !== "function") return
    // Try the stream again later. A replaced tab tries sooner, but only while it's visible: a
    // hidden one waits until it's shown again (onVisibility), so it never takes a slot it won't use.
    sseRetryTimer = window.setTimeout(
      () => {
        if (yielded && document.hidden) {
          sseRetryTimer = null
          return
        }
        retrySse()
      },
      yielded ? SSE_RETRY_YIELDED_MS : SSE_RETRY_FROM_POLL_MS,
    )
  }

  /** A replaced tab the user is looking at again: try the stream now (at most once per 10 s). */
  function retryIfYielded() {
    if (!yielded || mode !== "poll" || disposed || offline || document.hidden) return
    const now = Date.now()
    if (now - lastYieldedRetry < YIELDED_RETRY_MIN_GAP_MS) return
    lastYieldedRetry = now
    clearTimer(sseRetryTimer)
    retrySse()
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
        // A replaced tab shown again tries the stream first; everything else resumes as it was.
        if (yielded && !offline && typeof window.EventSource === "function") {
          lastYieldedRetry = Date.now()
          clearTimer(sseRetryTimer)
          retrySse()
        } else resume()
      } else retryIfYielded()
    }
  }
  const onFocus = () => retryIfYielded()
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
      window.addEventListener("focus", onFocus)
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
      window.removeEventListener("focus", onFocus)
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
