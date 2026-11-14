"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { ArrowCounterClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react"
import { YardLogo } from "@/components/brand/yard-logo"
import { Button } from "@/components/ui/button"
import type { ConversationSummary } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { sendSupportMessage, supportEndpoints, type SupportParty } from "@/lib/api/support"
import { cn } from "@/lib/utils"
import { Composer, type ComposerApi, type OrderChip } from "./composer"
import { MessageList, ThreadSkeleton } from "./messages"
import { ConnectionChip, ThreadScroller, type ScrollerApi } from "./thread-scroller"
import { useThread, type DraftPayload } from "./use-thread"

const circle = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet"

/** Yard's mark for Yard Support: the logo on black, the size of a brand mark. */
export function SupportMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center border border-white/12 bg-obsidian", className)}>
      <YardLogo decorative className="h-2.5 w-auto" />
    </span>
  )
}

type Props = {
  party: SupportParty
  /** The thread's id when it exists (null until the first message creates it). */
  conversationId: string | null
  /** An order to attach to the next message (from "Get help from Yard" on an order). */
  initialOrder?: OrderChip | null
  onCreated?: (c: ConversationSummary) => void
  /** The attached order went out (the page drops it from its address, so it isn't attached again). */
  onOrderSent?: () => void
  onConversation?: (c: ConversationSummary) => void
  onBack?: () => void
  /** True on phones, where the thread is a full-screen layer. */
  layer?: boolean
  className?: string
}

/**
 * The party's Yard Support thread: the inbox's messages, scroller and pill composer over
 * /api/support (shopper) or /api/studio/support (brand). Yard's replies show as "Yard Support"
 * with the Yard mark; there are no reactions and nothing to report, block or archive here.
 */
export function SupportThread({ party, conversationId, initialOrder, onCreated, onOrderSent, onConversation, onBack, layer, className }: Props) {
  const [order, setOrder] = useState<OrderChip | null>(initialOrder ?? null)
  const composer = useRef<ComposerApi | null>(null)
  const scroller = useRef<ScrollerApi | null>(null)
  const endpoints = useMemo(() => supportEndpoints(party), [party])
  const createdRef = useRef<string | null>(null)

  const send = useCallback(
    async (clientId: string, payload: DraftPayload) => {
      const r = await sendSupportMessage(
        party,
        party === "shopper"
          ? { clientId, kind: payload.kind === "order" || payload.kind === "image" ? payload.kind : "text", body: payload.body, attachmentIds: payload.attachmentIds, orderRefId: payload.kind === "order" ? payload.orderRefId : undefined }
          : { clientId, kind: payload.kind === "image" ? "image" : "text", body: payload.body, attachmentIds: payload.attachmentIds },
      )
      if (payload.kind === "order") onOrderSent?.()
      if (!conversationId && !createdRef.current) {
        createdRef.current = r.conversation.id
        onCreated?.(r.conversation)
      }
      return r
    },
    [party, conversationId, onCreated, onOrderSent],
  )

  const t = useThread({ side: party === "shopper" ? "customer" : "brand", conversationId, send, active: true, onConversation, endpoints })
  const side = party === "shopper" ? "customer" : "brand"
  const items = useMemo(() => [...t.messages.map((m) => ({ key: m.id, own: m.side === side })), ...t.pending.map((p) => ({ key: p.clientId, own: true }))], [t.messages, t.pending, side])
  const last = items[items.length - 1]
  const conv = t.conversation

  const header = (
    <header className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-line-soft px-2 md:px-4", layer && "h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]")}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back to conversations" className={cn(circle, "glass")}>
          <ArrowLeftIcon className="size-5" />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
        <SupportMark className="size-9" />
        <span className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-medium text-ink">Yard Support</span>
          <span className="block truncate text-xs text-ink-3">{conv?.status === "resolved" ? "Resolved. Writing again reopens it." : "The Yard team. We usually reply within a day."}</span>
        </span>
      </div>
      {conversationId ? <ConnectionChip status={t.realtime} className="hidden sm:inline-flex" /> : null}
    </header>
  )

  let body: React.ReactNode
  if (conversationId && (t.status === "loading" || t.status === "idle")) body = <ThreadSkeleton />
  else if (conversationId && t.status === "error")
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load your conversation with Yard Support.</p>
        <p className="max-w-xs text-xs text-ink-2">{errorMessage(t.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void t.load()}>
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </div>
    )
  else
    body = (
      <ThreadScroller apiRef={scroller} resetKey={conversationId ?? `support:new:${party}`} firstKey={items[0]?.key} lastKey={last?.key ?? "empty"} lastIsOwn={!!last?.own} hasMore={t.hasMore} loadingOlder={t.loadingOlder} onLoadOlder={t.loadOlder}>
        {!t.messages.length && !t.pending.length ? (
          <div className="px-2 py-10 text-center">
            <SupportMark className="mx-auto mb-3 size-12" />
            <p className="text-sm text-ink">Message Yard Support</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-ink-2">
              {party === "shopper"
                ? "Questions about an order, a payment, your account or anything on Yard. Our team replies here and in your notifications."
                : "Questions about selling on Yard, your storefront, payouts or anything in Studio. Our team replies here and in your Studio notifications."}
            </p>
          </div>
        ) : null}
        <MessageList side={side} messages={t.messages} pending={t.pending} otherName="Yard Support" theyreTyping={t.theyreTyping} receipts={t.receipts} canInteract onRetry={t.retry} onDiscard={t.discard} />
      </ThreadScroller>
    )

  return (
    <section aria-label="Conversation with Yard Support" className={cn("flex h-full min-h-0 flex-col bg-obsidian", className)}>
      {header}
      {body}
      {conversationId && t.status !== "ready" ? null : (
        <Composer
          apiRef={composer}
          onSend={(payload, preview) => {
            void t.send(payload, preview)
          }}
          onTyping={t.notifyTyping}
          // Photos upload into the thread, so they're offered once it exists (after the first message).
          uploadTarget={conversationId ? { purpose: "inbox_attachment", as: party === "shopper" ? "shopper" : "brand", conversationId } : null}
          order={party === "shopper" ? order : null}
          onClearOrder={() => setOrder(null)}
          placeholder="Message Yard Support"
          className={layer ? "border-t border-line-soft" : ""}
        />
      )}
    </section>
  )
}
