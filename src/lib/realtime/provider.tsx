"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { api } from "@/lib/api/client"
import type { NotificationDto } from "@/lib/api/contracts/notifications"
import type { RealtimeMeta, RealtimeStatus, Surface } from "@/lib/api/contracts/realtime"
import { revalidatePrefix } from "@/lib/api/use-api"
import { getServerSessionState, identityKeyFor, recipientFor, refreshServerSession, subscribeServerSession, useIdentityKey, useServerSession } from "@/lib/session/use-server-session"
import { categoryLabel, useNotifications, type Audience, type NotificationCategory, type ServerItem } from "@/lib/stores/notifications"
import { createConnection, fetchServerNotifications, unreadEndpoint, type Connection } from "./connection"
import { resetUnread, setUnread } from "./unread"

/**
 * The realtime provider (§4.3), mounted once per surface layout (market, studio, admin).
 * Identity-keyed: the EventSource lives in an effect keyed on useIdentityKey(surface), so a
 * sign-in, sign-out, account switch or active-brand change closes the old stream, forgets its
 * lastSeq, clears that surface's unread store and purges srv: notifications of anyone else
 * before a new stream opens. Signed out → no stream (anonymous shoppers get none).
 *
 * It also runs the client half of the server notification bridge (§2.7): on open it fetches
 * GET /api/notifications and hands the rows to upsertServer; notification.created does the same
 * and notification.read applies through applyServerRead (no call back to the server).
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
  const audience = audienceOf[surface]

  const dispatch = useCallback(
    (type: string, payload: unknown, meta: RealtimeMeta) => {
      const recipient = recipientFor(surface, getServerSessionState())
      const store = useNotifications.getState()
      if (type === "notification.created") {
        const item = toServerItem(payload as NotificationDto, audience, recipient)
        if (item) store.upsertServer([item])
      } else if (type === "notification.read") {
        const p = payload as { recipient?: { kind: string; id: string }; keys?: string[]; all?: boolean; read?: boolean }
        const r = p.recipient ? `${p.recipient.kind}:${p.recipient.id}` : null
        if (r && r === recipient) {
          const read = p.read !== false
          if (p.all) store.applyServerRead({ recipient: r, audience }, read)
          else store.applyServerRead({ eventKeys: (p.keys ?? []).map((k) => `srv:${r}:${k}`) }, read)
        }
      } else if (type === "unread.counts") {
        const n = (payload as { conversations?: unknown }).conversations
        if (typeof n === "number" && n >= 0) setUnread(surface, n)
      } else if (type === "resync") {
        // The log no longer covers the gap: refetch every mounted list.
        revalidatePrefix("")
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

  useEffect(() => {
    resetUnread(surface)
    // Signed out: no stream. The context reports "idle" whenever the identity key is null.
    if (!identityKey) return
    let notificationsAfter: string | null = null
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
    const refreshNotifications = () => {
      fetchServerNotifications(surface, notificationsAfter)
        .then(({ items }) => {
          if (!alive) return
          const recipient = recipientFor(surface, getServerSessionState())
          const list = items.map((dto) => toServerItem(dto, audience, recipient)).filter((x): x is ServerItem => !!x)
          if (list.length) useNotifications.getState().upsertServer(list)
          for (const i of items) if (!notificationsAfter || i.at > notificationsAfter) notificationsAfter = i.at
        })
        .catch(() => {
          /* the bell keeps what it has; the next open tries again */
        })
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
        const decide = () => {
          const s = getServerSessionState()
          if (s.fetchedAt < endedAt) return false
          // A different identity re-runs this effect; the same one (signed in again as the same account) reopens here.
          if (alive && identityKeyFor(surface, s) === identityKey) conn.current?.reopen()
          return true
        }
        void refreshServerSession().then(() => {
          if (!alive || decide()) return
          const unsubscribe = subscribeServerSession(() => {
            if (!alive || decide()) unsubscribe()
          })
        })
      },
      onRefused: () => {
        // Only a different identity changes anything here (the effect re-runs); the connection's backoff retries.
        void refreshServerSession()
      },
      onOpen: () => {
        refreshNotifications()
        refreshUnread()
      },
    })
    conn.current = c
    for (const type of handlers.current.keys()) c.listen(type)
    c.start()
    return () => {
      alive = false
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
