"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ConversationSummary, MessageDto, SendResult, ThreadDto } from "@/lib/api/contracts/inbox"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { getThread, newClientId, onInboxSettingsChange, postRead, postTyping, react as postReaction, type InboxSide } from "@/lib/api/inbox"
import { useRealtimeEvent, useRealtimeStatus } from "@/lib/realtime/use-realtime"

/**
 * One conversation's live state, shared by the shopper thread and Studio (§6.2). It loads the
 * newest 50 messages, pages older ones, merges realtime events (a replayed `partial` event or a
 * reconnect refetches through the scoped API), keeps optimistic sends with Retry and Discard,
 * posts read receipts while the thread is visible and focused, and throttles typing pings.
 * Without a live stream it refetches every 15 s: real data, never a simulated update.
 */

export type DraftPayload = {
  kind: "text" | "product" | "order" | "image"
  body?: string
  productId?: string
  variantId?: string
  orderRefId?: string
  attachmentIds?: string[]
  quickReplyId?: string
  topic?: string
}

/** What a sending bubble shows before the server answers. */
export type PendingPreview = {
  product?: { productId: string; name: string; variantLabel?: string; price?: { amount: number; currency: string } }
  order?: { orderId: string; reference: string }
  images?: { src: string; width: number | null; height: number | null }[]
}

export type Pending = {
  clientId: string
  payload: DraftPayload
  preview: PendingPreview
  status: "sending" | "failed"
  error?: string
  createdAt: string
}

type State = {
  status: "idle" | "loading" | "ready" | "error"
  error?: unknown
  conversation: ConversationSummary | null
  messages: MessageDto[]
  hasMore: boolean
  receipts: ThreadDto["receipts"]
}

const empty: State = { status: "idle", conversation: null, messages: [], hasMore: false, receipts: { theirs: null, enabled: true } }

function merge(list: MessageDto[], incoming: MessageDto[]) {
  const map = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.seq - b.seq)
}

export type SendFn = (clientId: string, payload: DraftPayload) => Promise<SendResult>

/** Typing pings from the other side within this long after their message are the pre-send one, late. */
const TYPING_AFTER_MESSAGE_MS = 1500

/**
 * Where a thread reads and writes. The inbox's own routes by default; Yard Support threads pass
 * theirs (src/lib/api/support.ts), which answer in the same DTOs.
 */
export type ThreadEndpoints = {
  thread: (id: string, q?: { before?: number; after?: number; limit?: number; q?: string }) => Promise<ThreadDto>
  read: (id: string, upToSeq: number) => Promise<unknown>
  typing: (id: string) => Promise<unknown>
  /** Absent where reactions aren't offered (Yard Support threads). */
  react?: (messageId: string, emoji: "♥" | null) => Promise<{ message: MessageDto }>
}

const inboxEndpoints = (side: InboxSide): ThreadEndpoints => ({
  thread: (id, q) => getThread(side, id, q),
  read: (id, upToSeq) => postRead(side, id, upToSeq),
  typing: (id) => postTyping(side, id),
  react: (messageId, emoji) => postReaction(side, messageId, emoji),
})

/** The viewer's side: a shopper ("customer"), a brand, or Yard Support (an admin, "support"). */
export type ThreadSide = InboxSide | "support"

export function useThread({ side, conversationId, send: sendFn, active, onConversation, endpoints }: { side: ThreadSide; conversationId: string | null; send: SendFn; active: boolean; onConversation?: (c: ConversationSummary) => void; endpoints?: ThreadEndpoints }) {
  const ep = useMemo(() => endpoints ?? inboxEndpoints(side === "support" ? "brand" : side), [endpoints, side])
  const [state, setState] = useState<State>(empty)
  // A conversation that was marked unread when it opened is read by opening it, once. A mark made
  // later (here or by a teammate) never triggers /read on its own.
  const [openMark, setOpenMark] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [typingUntil, setTypingUntil] = useState<number>(0)
  const realtime = useRealtimeStatus()
  const idRef = useRef(conversationId)
  const stateRef = useRef(state)
  const onConvRef = useRef(onConversation)
  useEffect(() => {
    idRef.current = conversationId
    stateRef.current = state
    onConvRef.current = onConversation
  })

  const applyConversation = useCallback((c: ConversationSummary | undefined | null) => {
    if (!c) return
    setState((s) => (s.conversation && s.conversation.id !== c.id ? s : { ...s, conversation: { ...c, interaction: c.interaction ?? s.conversation?.interaction } }))
    onConvRef.current?.(c)
  }, [])

  const load = useCallback(async () => {
    const id = idRef.current
    if (!id) return
    setState((s) => ({ ...s, status: s.conversation?.id === id ? s.status : "loading", error: undefined }))
    try {
      const t = await ep.thread(id)
      if (idRef.current !== id) return
      setState({ status: "ready", conversation: t.conversation, messages: t.messages, hasMore: t.hasMore, receipts: t.receipts })
      setOpenMark(t.conversation.markedUnread ? id : null)
      onConvRef.current?.(t.conversation)
    } catch (e) {
      if (idRef.current !== id || (e instanceof DOMException && e.name === "AbortError")) return
      setState((s) => (s.conversation?.id === id && s.status === "ready" ? s : { ...empty, status: "error", error: e }))
    }
  }, [ep])

  /** New messages after the newest one we hold, plus the conversation and receipts as they are now. */
  const refresh = useCallback(async () => {
    const id = idRef.current
    const s = stateRef.current
    if (!id || s.status !== "ready") return load()
    const last = s.messages[s.messages.length - 1]?.seq ?? 0
    try {
      const t = await ep.thread(id, { after: last, limit: 100 })
      if (idRef.current !== id) return
      setState((cur) => ({ ...cur, conversation: t.conversation, receipts: t.receipts, messages: merge(cur.messages, t.messages) }))
      setPending((p) => p.filter((x) => !t.messages.some((m) => m.clientId === x.clientId)))
      onConvRef.current?.(t.conversation)
    } catch {
      /* the next event or poll tries again */
    }
  }, [ep, load])

  // Reload the latest window (reactions and removals change older messages).
  const reloadWindow = useCallback(async () => {
    const id = idRef.current
    if (!id) return
    try {
      const t = await ep.thread(id)
      if (idRef.current !== id) return
      setState((cur) => ({ ...cur, status: "ready", conversation: t.conversation, receipts: t.receipts, messages: merge(cur.messages, t.messages), hasMore: cur.messages.length ? cur.hasMore : t.hasMore }))
    } catch {
      /* keep what we have */
    }
  }, [ep])

  useEffect(() => {
    setPending([])
    setTypingUntil(0)
    if (!conversationId) {
      setState({ ...empty, status: "ready" })
      return
    }
    setState({ ...empty, status: "loading" })
    void load()
  }, [conversationId, load])

  const loadOlder = useCallback(async () => {
    const id = idRef.current
    const s = stateRef.current
    if (!id || !s.hasMore || loadingOlder || !s.messages.length) return false
    setLoadingOlder(true)
    try {
      const t = await ep.thread(id, { before: s.messages[0].seq, limit: 50 })
      if (idRef.current !== id) return false
      setState((cur) => ({ ...cur, messages: merge(cur.messages, t.messages), hasMore: t.hasMore }))
      return true
    } catch {
      return false
    } finally {
      setLoadingOlder(false)
    }
  }, [ep, loadingOlder])

  /** Loads older pages until `seq` is in the window (in-thread search). */
  const ensureLoaded = useCallback(
    async (seq: number) => {
      const id = idRef.current
      if (!id) return
      for (let i = 0; i < 20; i++) {
        const s = stateRef.current
        if (!s.messages.length || s.messages[0].seq <= seq || !s.hasMore) return
        const t = await ep.thread(id, { before: s.messages[0].seq, limit: 100 }).catch(() => null)
        if (!t || idRef.current !== id) return
        const merged = merge(stateRef.current.messages, t.messages)
        stateRef.current = { ...stateRef.current, messages: merged, hasMore: t.hasMore }
        setState((cur) => ({ ...cur, messages: merge(cur.messages, t.messages), hasMore: t.hasMore }))
      }
    },
    [ep],
  )

  /* ---------------- realtime */

  const mine = (id: string | undefined) => !!id && id === idRef.current
  /** When (and in which thread) the other side's last message arrived live: see the typing handler. */
  const theirMessageAt = useRef<{ id: string; at: number } | null>(null)
  useRealtimeEvent("message.created", (p, meta) => {
    const id = (p as { message?: { conversationId?: string }; conversationId?: string }).message?.conversationId ?? (p as { conversationId?: string }).conversationId
    if (!mine(id)) return
    if (meta.partial) return void refresh()
    setState((s) => ({ ...s, messages: merge(s.messages, [p.message]) }))
    setPending((list) => list.filter((x) => x.clientId !== p.message.clientId))
    if (p.message.side !== side && p.message.side !== "system") {
      setTypingUntil(0)
      theirMessageAt.current = { id: p.message.conversationId, at: Date.now() }
    }
    applyConversation(p.conversation)
  })
  useRealtimeEvent("message.updated", (p, meta) => {
    const id = (p as { message?: { conversationId?: string } }).message?.conversationId
    if (!mine(id)) return
    if (meta.partial) return void reloadWindow()
    setState((s) => ({ ...s, messages: s.messages.map((m) => (m.id === p.message.id ? p.message : m)) }))
  })
  useRealtimeEvent("conversation.updated", (p, meta) => {
    const id = (p as { conversation?: { id?: string }; id?: string }).conversation?.id ?? (p as { id?: string }).id
    if (!mine(id)) return
    // Blocks and locks change what the composer may do: the thread read carries that.
    void (meta.partial ? refresh() : refresh())
  })
  useRealtimeEvent("typing", (p) => {
    if (!mine(p.conversationId) || p.side === side) return
    // The sender's last ping before Send races the send itself and can be published just after their
    // message. Their client pings at most every 2 s, so a ping within 1.5 s of their message is that
    // stale one: without this, "… is typing…" came back under the reply for up to 5 s.
    const last = theirMessageAt.current
    if (last && last.id === p.conversationId && Date.now() - last.at < TYPING_AFTER_MESSAGE_MS) return
    setTypingUntil(Math.min(Date.parse(p.until), Date.now() + 6000))
  })
  useRealtimeEvent("read", (p) => {
    if (!mine(p.conversationId) || p.side === side) return
    setState((s) => ({ ...s, receipts: { ...s.receipts, theirs: { upToSeq: Math.max(p.upToSeq, s.receipts.theirs?.upToSeq ?? 0), at: p.at } } }))
  })
  useRealtimeEvent("hello", () => {
    if (idRef.current && stateRef.current.status === "ready") void refresh()
  })

  // The shopper switched read receipts on or off (here or in another tab): re-read them.
  useEffect(() => onInboxSettingsChange(() => void refresh()), [refresh])

  // Without a live stream: refetch every 15 s while the thread is open and the tab visible.
  useEffect(() => {
    if (!conversationId || realtime === "open") return
    const t = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 15_000)
    return () => window.clearInterval(t)
  }, [conversationId, realtime, refresh])

  // Typing indicator expiry.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!typingUntil) return
    const ms = typingUntil - Date.now()
    if (ms <= 0) return setTypingUntil(0)
    const t = window.setTimeout(() => tick((n) => n + 1), ms + 50)
    return () => window.clearTimeout(t)
  }, [typingUntil])
  const theyreTyping = typingUntil > Date.now()

  /* ---------------- read receipts */

  const lastPostedRead = useRef(0)
  useEffect(() => {
    lastPostedRead.current = 0
  }, [conversationId])
  const newestTheirs = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]
      if (m.side !== side && m.side !== "system" && m.status === "sent") return m.seq
    }
    return 0
  }, [state.messages, side])
  const [focused, setFocused] = useState(true)
  useEffect(() => {
    const update = () => setFocused(!document.hidden && document.hasFocus())
    update()
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])
  // Marking a conversation unread suppresses the automatic read until the thread is opened again
  // (Studio remounts it per conversation) or a newer message arrives from the other side: a mark
  // alone never triggers /read.
  const [suppressed, setSuppressed] = useState<{ id: string; upTo: number } | null>(null)
  const suppressAutoRead = useCallback(() => {
    const id = idRef.current
    if (!id) return
    lastPostedRead.current = Math.max(lastPostedRead.current, newestTheirs)
    setSuppressed({ id, upTo: newestTheirs })
  }, [newestTheirs])
  const resumeAutoRead = useCallback(() => setSuppressed(null), [])
  const held = !!suppressed && suppressed.id === conversationId && newestTheirs <= suppressed.upTo
  const unreadFlag = !held && !!state.conversation && (state.conversation.unread > 0 || (state.conversation.markedUnread && openMark === conversationId))
  useEffect(() => {
    const id = conversationId
    if (!id || !active || !focused || state.status !== "ready" || held) return
    const target = Math.max(newestTheirs, unreadFlag ? (state.messages[state.messages.length - 1]?.seq ?? 0) : 0)
    if (!target || (target <= lastPostedRead.current && !unreadFlag)) return
    const t = window.setTimeout(() => {
      lastPostedRead.current = target
      setOpenMark(null)
      void ep.read(id, target)
        .then(() => setState((s) => (s.conversation?.id === id ? { ...s, conversation: { ...s.conversation, unread: 0, markedUnread: false } } : s)))
        .catch(() => {
          lastPostedRead.current = 0
        })
    }, 500)
    return () => window.clearTimeout(t)
  }, [conversationId, active, focused, state.status, newestTheirs, unreadFlag, held, ep, state.messages])

  /* ---------------- typing pings */

  const lastTyping = useRef(0)
  const notifyTyping = useCallback(() => {
    const id = idRef.current
    if (!id || realtime !== "open") return
    if (Date.now() - lastTyping.current < 2000) return
    lastTyping.current = Date.now()
    void ep.typing(id).catch(() => {})
  }, [ep, realtime])

  /* ---------------- sending */

  const run = useCallback(
    async (p: Pending) => {
      setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, status: "sending", error: undefined } : x)))
      try {
        const r = await sendFn(p.clientId, p.payload)
        if (idRef.current && r.message.conversationId !== idRef.current) return r
        setState((s) => ({ ...s, status: "ready", messages: merge(s.messages, [r.message]) }))
        setPending((list) => list.filter((x) => x.clientId !== p.clientId))
        applyConversation(r.conversation)
        return r
      } catch (e) {
        const message =
          e instanceof ApiError && e.code === "rate_limited"
            ? `You're sending messages quickly — try again in ${e.retryAfter ?? 30}s.`
            : e instanceof ApiError && e.status === 0
              ? "Not sent. You're offline."
              : errorMessage(e, "Not sent.")
        setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, status: "failed", error: message } : x)))
        if (e instanceof ApiError && (e.code === "blocked" || e.code === "restricted")) void refresh()
        return null
      }
    },
    [sendFn, applyConversation, refresh],
  )

  const send = useCallback(
    (payload: DraftPayload, preview: PendingPreview = {}) => {
      const p: Pending = { clientId: newClientId(), payload, preview, status: "sending", createdAt: new Date().toISOString() }
      setPending((list) => [...list, p])
      return run(p)
    },
    [run],
  )
  const retry = useCallback(
    (clientId: string) => {
      const p = pending.find((x) => x.clientId === clientId)
      if (p) void run(p)
    },
    [pending, run],
  )
  const discard = useCallback((clientId: string) => setPending((list) => list.filter((x) => x.clientId !== clientId)), [])

  const toggleReaction = useCallback(
    async (m: MessageDto) => {
      const on = !m.reaction?.mine
      setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === m.id ? { ...x, reaction: { mine: on, theirs: !!x.reaction?.theirs } } : x)) }))
      try {
        if (!ep.react) throw new Error("Reactions aren't available here.")
        const r = await ep.react(m.id, on ? "♥" : null)
        setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === m.id ? r.message : x)) }))
        return true
      } catch (e) {
        setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === m.id ? m : x)) }))
        throw e
      }
    },
    [ep],
  )

  return {
    ...state,
    pending,
    loadingOlder,
    realtime,
    theyreTyping,
    load,
    refresh,
    loadOlder,
    ensureLoaded,
    send,
    retry,
    discard,
    notifyTyping,
    toggleReaction,
    setConversation: applyConversation,
    suppressAutoRead,
    resumeAutoRead,
  }
}

export type ThreadState = ReturnType<typeof useThread>
