"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { api } from "@/lib/api/client"
import type { NotificationDto } from "@/lib/api/contracts/notifications"
import type { RealtimeMeta, RealtimeStatus, Surface } from "@/lib/api/contracts/realtime"
import { resetApiCache, revalidatePrefix } from "@/lib/api/use-api"
import { getServerSessionState, identityKeyFor, recipientFor, refreshServerSession, subscribeServerSession, useIdentityKey, useServerSession } from "@/lib/session/use-server-session"
import { categoryLabel, serverEventKey, useNotifications, type Audience, type NotificationCategory, type ServerItem } from "@/lib/stores/notifications"
import { createConnection, fetchServerNotifications, unreadEndpoint, type Connection } from "./connection"
import { resetUnread, setUnread } from "./unread"

/**
 * The realtime provider (§4.3), mounted once per surface layout (market, studio, admin).
 * Identity-keyed: the EventSource lives in an effect keyed on useIdentityKey(surface), so a
 * sign-in, sign-out, account switch or active-brand change closes the old stream, forgets its
 * lastSeq, clears that surface's unread store and purges srv: notifications of anyone else
 * before a new stream opens. Signed out → no stream (anonymous shoppers get none).
 *
 * It also runs the client half of the server notification bridge (§2.7). Every (re)open — first
 * connect, after a hidden or offline gap, a bye, a session re-check, the switch to polling — runs a
 * full GET /api/notifications: upsertServer for its rows, then reconcileServer drops this
 * recipient's srv: items the server no longer has. Only events that arrive live (not replayed) are
 * applied from their payload: notification.created → upsertServer, notification.read →
 * applyServerRead, notification.removed → removeServer. A replayed (partial) notification event,
 * any polled one, and resync only schedule that full read, so a notification deleted while the tab
 * was away can never come back from the replay log. A live event that lands while a full read is
 * in flight is newer than the read's answer: its key is spared from both the upsert and the drop.
 *
 * Any identity change it observes (sign-in, switch, sign-out, an active-brand change, or a cookie
 * changed by something no tab announced) also resets the API cache, so one account's lists never
 * render under another's.
 */
type Handler = (payload: unknown, meta: RealtimeMeta) => void

type RealtimeContextValue = {
  surface: Surface
  status: RealtimeStatus
  identityKey: string | null
  /** Registers a handler for one event type; returns the unsubscribe function. */
  on: (type: string, handler: Handler) => () => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

const audienceOf: Record<Surface, Audience> = { market: "customer", studio: "merchant", admin: "admin" }

/** GET /api/notifications returns at most this many rows on a full read (server listNotifications). */
const SERVER_PAGE = 100
/** After session.ended left no one signed in: when to re-read the session once more (a switch's new cookie may still be landing). */
const SWITCH_SETTLE_MS = 1500
/** How long replayed or polled notification events wait before the one full read they share. */
const FULL_READ_DEBOUNCE_MS = 300

/**
 * The last identity key each surface's provider saw in this page, across remounts (a provider
 * unmounts when the user leaves that surface). A different key, or null after one, means the
 * cookies changed under this tab: the API cache still holds the old identity's data.
 */
const lastIdentity: Partial<Record<Surface, string | null>> = {}

const knownCategory = (c: string): c is NotificationCategory => Object.prototype.hasOwnProperty.call(categoryLabel, c)

/** A server notification DTO as the store's ServerItem, or null when it isn't for `recipient`. */
function toServerItem(dto: NotificationDto, audience: Audience, recipient: string | null): ServerItem | null {
  const r = `${dto.recipient.kind}:${dto.recipient.id}`
  if (!recipient || r !== recipient) return null
  // An unknown category falls back to the audience's general one rather than an unlabelled row.
  const category = knownCategory(dto.category) ? dto.category : audience === "admin" ? "system_alert" : audience === "merchant" ? "account_status" : "brand_announcement"
  return { key: dto.key, audience, recipient: r, category, title: dto.title, body: dto.body, href: dto.href, at: dto.at, read: dto.read }
}

export function RealtimeProvider({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  const identityKey = useIdentityKey(surface)
  const sessionReady = useServerSession((s) => s.status === "ready")
  const [status, setStatus] = useState<RealtimeStatus>("idle")
  const handlers = useRef(new Map<string, Set<Handler>>())
  const conn = useRef<Connection | null>(null)
  /** Set by the connection effect: schedules the full notification read (debounced). */
  const fullRead = useRef<((delay?: number) => void) | null>(null)
  /** Set by the connection effect: notes a live notification event's keys while a full read is in flight. */
  const noteLive = useRef<((eventKeys: string[] | "all") => void) | null>(null)
  const audience = audienceOf[surface]

  const dispatch = useCallback(
    (type: string, payload: unknown, meta: RealtimeMeta) => {
      const recipient = recipientFor(surface, getServerSessionState())
      const store = useNotifications.getState()
      if (type === "notification.created" || type === "notification.read" || type === "notification.removed") {
        // A replayed or polled copy is only a hint that something changed: the full read decides.
        if (meta.partial) fullRead.current?.(FULL_READ_DEBOUNCE_MS)
        else if (type === "notification.created") {
          const item = toServerItem(payload as NotificationDto, audience, recipient)
          if (item) {
            noteLive.current?.([serverEventKey(item.recipient, item.key)])
            store.upsertServer([item])
          }
        } else {
          const p = payload as { recipient?: { kind: string; id: string }; keys?: string[]; all?: boolean; read?: boolean }
          const r = p.recipient ? `${p.recipient.kind}:${p.recipient.id}` : null
          if (r && r === recipient) {
            const eventKeys = (p.keys ?? []).map((k) => serverEventKey(r, k))
            if (type === "notification.removed") {
              noteLive.current?.(eventKeys)
              store.removeServer(eventKeys)
            } else {
              const read = p.read !== false
              noteLive.current?.(p.all ? "all" : eventKeys)
              if (p.all) store.applyServerRead({ recipient: r, audience }, read)
              else store.applyServerRead({ eventKeys }, read)
            }
          }
        }
      } else if (type === "unread.counts") {
        const n = (payload as { conversations?: unknown }).conversations
        if (typeof n === "number" && n >= 0) setUnread(surface, n)
      } else if (type === "resync") {
        // The log no longer covers the gap, or something was removed on the server: refetch every
        // mounted list and the notifications.
        revalidatePrefix("")
        fullRead.current?.(FULL_READ_DEBOUNCE_MS)
      }
      const set = handlers.current.get(type)
      if (!set) return
      for (const h of [...set]) {
        try {
          h(payload, meta)
        } catch (e) {
          console.error(`[realtime] ${type} handler failed`, e)
        }
      }
    },
    [surface, audience],
  )

  // Purge srv: items of anyone but the current recipient whenever the identity settles (§2.7).
  // Only once the session is known: during the first load the recipient is null for everyone.
  useEffect(() => {
    if (!sessionReady) return
    useNotifications.getState().purgeServerItems(audience, recipientFor(surface, getServerSessionState()))
  }, [identityKey, sessionReady, audience, surface])

  // An identity change observed here (non-null → different, or → null) drops the API cache, even
  // when no tab announced it through afterIdentityChange (the cookie changed elsewhere).
  useEffect(() => {
    if (!sessionReady) return
    const before = lastIdentity[surface]
    if (before && before !== identityKey) resetApiCache()
    lastIdentity[surface] = identityKey
  }, [identityKey, sessionReady, surface])

  useEffect(() => {
    resetUnread(surface)
    // Signed out: no stream. The context reports "idle" whenever the identity key is null.
    if (!identityKey) return
    let alive = true

    const refreshUnread = () => {
      const path = unreadEndpoint[surface]
      if (!path) return
      api<{ conversations: number }>(path)
        .then((r) => {
          if (alive && typeof r?.conversations === "number") setUnread(surface, r.conversations)
        })
        .catch(() => {
          /* the inbox may not be built yet, or the request failed: the badge stays unknown */
        })
    }
    // The full notification read: one at a time; a request while one is in flight runs another
    // after it. Keys touched by live events during the flight are newer than its answer.
    let reading = false
    let again = false
    let timer: number | null = null
    let liveKeys: Set<string> | null = null
    let liveAll = false
    const readFull = () => {
      timer = null
      if (!alive) return
      if (reading) {
        again = true
        return
      }
      reading = true
      liveKeys = new Set()
      liveAll = false
      fetchServerNotifications(surface, null)
        .then(({ items }) => {
          if (!alive) return
          const recipient = recipientFor(surface, getServerSessionState())
          if (!recipient) return
          // A live "mark all read/unread" raced this read: its answer may hold the old read state.
          if (liveAll) {
            again = true
            return
          }
          const spared = liveKeys ?? new Set<string>()
          const list = items
            .map((dto) => toServerItem(dto, audience, recipient))
            .filter((x): x is ServerItem => !!x && !spared.has(serverEventKey(x.recipient, x.key)))
          const store = useNotifications.getState()
          if (list.length) store.upsertServer(list)
          // The server's truth for its window: drop this recipient's srv: items it no longer has.
          // A full page (100 rows) only speaks for rows from its oldest one on.
          const from = items.length >= SERVER_PAGE ? items.reduce((m, i) => (i.at < m ? i.at : m), items[0].at) : null
          store.reconcileServer(audience, recipient, [...list.map((i) => serverEventKey(i.recipient, i.key)), ...spared], from, null)
        })
        .catch((e) => {
          // An identity change's cache reset aborted it: read again (this effect is still current).
          // Otherwise the bell keeps what it has; the next open tries again.
          if (e instanceof DOMException && e.name === "AbortError") again = true
        })
        .finally(() => {
          reading = false
          liveKeys = null
          if (alive && again) {
            again = false
            schedule(FULL_READ_DEBOUNCE_MS)
          }
        })
    }
    const schedule = (delay = 0) => {
      if (!alive || timer !== null) return
      timer = window.setTimeout(readFull, delay)
    }
    fullRead.current = schedule
    noteLive.current = (keys) => {
      if (!reading) return
      if (keys === "all") liveAll = true
      else for (const k of keys) liveKeys?.add(k)
    }

    const c = createConnection({
      surface,
      dispatch,
      setStatus: (s) => {
        if (alive) setStatus(s)
      },
      onSessionEnded: () => {
        // Decide only on a session read made after the stream ended: an older refresh still in
        // flight (or superseded by afterIdentityChange's) would report the identity that just ended.
        const endedAt = Date.now()
        // Signed out as far as that read could tell: a switch ends the old session before its new
        // cookie lands, so a read in between sees no one. Look once more shortly after. (Runs even
        // when this effect is already gone: the identity going to null re-runs it at once.)
        let settled = false
        const settle = (s: ReturnType<typeof getServerSessionState>) => {
          if (settled || s.fetchedAt < endedAt || identityKeyFor(surface, s) !== null) return
          settled = true
          window.setTimeout(() => void refreshServerSession(), SWITCH_SETTLE_MS)
        }
        const decide = () => {
          const s = getServerSessionState()
          if (s.fetchedAt < endedAt) return false
          // A different identity re-runs this effect; the same one (signed in again as the same account) reopens here.
          if (alive && identityKeyFor(surface, s) === identityKey) conn.current?.reopen()
          return true
        }
        void refreshServerSession().then(() => {
          settle(getServerSessionState())
          if (!alive || decide()) return
          const unsubscribe = subscribeServerSession((s) => {
            settle(s)
            if (!alive || decide()) unsubscribe()
          })
        })
      },
      onRefused: () => {
        // Only a different identity changes anything here (the effect re-runs); the connection's backoff retries.
        void refreshServerSession()
      },
      onOpen: () => {
        // Every (re)open follows a gap the replay may not cover faithfully: read everything.
        schedule(0)
        refreshUnread()
      },
    })
    conn.current = c
    for (const type of handlers.current.keys()) c.listen(type)
    c.start()
    return () => {
      alive = false
      if (timer !== null) window.clearTimeout(timer)
      if (fullRead.current === schedule) fullRead.current = null
      noteLive.current = null
      c.stop()
      if (conn.current === c) conn.current = null
    }
  }, [identityKey, surface, audience, dispatch])

  const on = useCallback((type: string, handler: Handler) => {
    let set = handlers.current.get(type)
    if (!set) {
      set = new Set()
      handlers.current.set(type, set)
    }
    set.add(handler)
    conn.current?.listen(type)
    return () => {
      handlers.current.get(type)?.delete(handler)
    }
  }, [])

  const value = useMemo(() => ({ surface, status: identityKey ? status : "idle", identityKey, on }), [surface, status, identityKey, on])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext() {
  return useContext(RealtimeContext)
}
