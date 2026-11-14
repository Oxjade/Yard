"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeftIcon, CheckCircleIcon, LifebuoyIcon, MagnifyingGlassIcon, StorefrontIcon, UserIcon } from "@phosphor-icons/react"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { Segmented } from "@/components/admin/ui/segmented"
import { Composer } from "@/components/inbox/composer"
import { useBelowLg } from "@/components/inbox/hooks"
import { MessageList, ThreadSkeleton } from "@/components/inbox/messages"
import { SupportMark } from "@/components/inbox/support-thread"
import { ConnectionChip, ThreadScroller, type ScrollerApi } from "@/components/inbox/thread-scroller"
import { useThread, type DraftPayload } from "@/components/inbox/use-thread"
import { Button } from "@/components/ui/button"
import type { SupportCaseDto, SupportFilter } from "@/lib/api/contracts/support"
import { errorMessage } from "@/lib/api/errors"
import { adminSupportEndpoints, getSupportCase, listSupport, patchSupportCase, replyAsSupport } from "@/lib/api/support"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import { LoadError, TrustGate } from "./shared"

/*
 * Admin › Support: Yard Support conversations with shoppers and brands. Unread open conversations
 * first. Replies go out as "Yard Support" with the Yard mark: the shopper or brand never sees which
 * admin wrote (this page does). Resolve and reopen post a line in the thread; a new message from
 * the shopper or brand reopens it. Needs support.manage.
 */

const FILTERS: { value: SupportFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
]
const isFilter = (v: string | null): v is SupportFilter => v === "open" || v === "resolved" || v === "all"

export function SupportView() {
  return (
    <div className="@container grid gap-3">
      <AdminPageHead live title="Support" description="Conversations with Yard Support. Shoppers write from their inbox, order pages and the app; brands from Studio. You reply as Yard Support: your name isn't shown to them." />
      <TrustGate feature="Support" anyOf={["support.manage"]}>
        <SupportWorkspace />
      </TrustGate>
    </div>
  )
}

function SupportWorkspace() {
  const filterParam = useSearchParam("filter")
  const filter: SupportFilter = isFilter(filterParam) ? filterParam : "open"
  const mine = useSearchParam("mine") === "1"
  const caseId = useSearchParam("case")
  const phone = useBelowLg()
  const [term, setTerm] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = window.setTimeout(() => setQ(term.trim()), 250)
    return () => window.clearTimeout(t)
  }, [term])
  const key = `admin:support:list:${filter}:${mine ? "mine" : "all"}:${q}`
  const list = useApi(key, () => listSupport({ filter, mine, q }))
  const revalidateList = list.revalidate
  const refreshSoon = useRef<number | undefined>(undefined)
  const refresh = useCallback(() => {
    window.clearTimeout(refreshSoon.current)
    refreshSoon.current = window.setTimeout(() => void revalidateList(), 250)
  }, [revalidateList])
  useEffect(() => () => window.clearTimeout(refreshSoon.current), [])
  useRealtimeEvent("support.updated", () => refresh())
  useRealtimeEvent("hello", () => refresh())

  const counts = list.data?.counts
  const items = list.data?.items ?? []
  const select = (id: string | null) => writeParams({ case: id })

  const queue = (
    <div className="flex min-h-0 flex-col gap-3">
      <Segmented
        label="Conversations"
        value={filter}
        onChange={(v) => writeParams({ filter: v === "open" ? null : v, case: null })}
        options={FILTERS.map((f) => ({ ...f, count: f.value === "open" ? counts?.open : f.value === "resolved" ? counts?.resolved : undefined, countTone: f.value === "open" ? "attention" : "neutral" }))}
        loading={!counts}
        size="sm"
      />
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search support conversations</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, email or brand" className="h-10 w-full rounded-md border border-line-soft bg-card pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-white/15" />
        </label>
        <Button size="sm" variant={mine ? "primary" : "secondary"} aria-pressed={mine} className="h-10 shrink-0" onClick={() => writeParams({ mine: mine ? null : "1" })}>
          Mine{counts?.mine ? ` · ${counts.mine}` : ""}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading && !list.data ? (
          <ListSkeleton rows={6} />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={() => void list.revalidate()} what="support conversations" />
        ) : !items.length ? (
          <EmptyState icon={LifebuoyIcon} title={q ? `Nothing matches “${q}”` : filter === "resolved" ? "No resolved conversations" : mine ? "Nothing assigned to you" : "No open conversations"} body={q ? "Search looks at shopper names and emails, and brand names and handles." : "When a shopper or a brand messages Yard Support, it shows here."} />
        ) : (
          <ul className="grid gap-0.5" aria-label="Support conversations">
            {items.map((c) => (
              <li key={c.id}>
                <CaseRow c={c} selected={c.id === caseId} onSelect={() => select(c.id)} />
              </li>
            ))}
          </ul>
        )}
        {list.data?.nextCursor ? <p className="px-2 py-3 text-xs text-ink-3">Showing the first {items.length}. Narrow with search or a filter.</p> : null}
      </div>
    </div>
  )

  const thread = caseId ? <CaseThread key={caseId} id={caseId} onBack={phone ? () => select(null) : undefined} layer={phone} onChanged={refresh} /> : null

  if (phone)
    return (
      <>
        <div className="min-h-[60dvh]">{queue}</div>
        {thread && typeof document !== "undefined"
          ? createPortal(
              <div className="fixed inset-0 z-50 flex flex-col bg-obsidian" role="dialog" aria-modal="true" aria-label="Support conversation">
                {thread}
              </div>,
              document.body,
            )
          : null}
      </>
    )

  return (
    <div className="grid h-[calc(100dvh-15rem)] min-h-[560px] grid-cols-[360px_minmax(0,1fr)] gap-5">
      <div className="min-h-0">{queue}</div>
      <div className="min-h-0 overflow-hidden rounded-[14px] border border-white/[0.06] bg-surface">
        {thread ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <span className="mb-2 inline-flex size-12 items-center justify-center rounded-full border border-line">
              <LifebuoyIcon className="size-6 text-ink-2" />
            </span>
            <p className="text-sm text-ink">Pick a conversation</p>
            <p className="max-w-sm text-sm text-ink-2">Unread conversations are at the top. You reply as Yard Support.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PartyIcon({ kind }: { kind: "shopper" | "brand" }) {
  const Icon = kind === "brand" ? StorefrontIcon : UserIcon
  return (
    <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/12 bg-obsidian text-ink-2">
      <Icon className="size-5" />
    </span>
  )
}

function CaseRow({ c, selected, onSelect }: { c: SupportCaseDto; selected: boolean; onSelect: () => void }) {
  const unread = c.unread > 0
  const preview = c.lastMessage ? `${c.lastMessage.side === "support" ? "Yard Support: " : ""}${c.lastMessage.preview}` : "No messages yet"
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-3 text-left transition-colors focus-visible:bg-white/[0.05] focus-visible:outline-none", selected ? "bg-purple/15" : "hover:bg-white/[0.04]")}>
      <PartyIcon kind={c.party.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm text-ink", unread && "font-medium")}>{c.party.name}</span>
          <span className="inline-flex h-5 shrink-0 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] text-ink-2">{c.party.kind === "brand" ? "Brand" : "Shopper"}</span>
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-3">{c.lastMessage ? relativeTime(c.lastMessage.at) : ""}</span>
        </span>
        <span className={cn("mt-0.5 line-clamp-1 text-[13px]", unread ? "font-medium text-ink" : "text-ink-2")}>{preview}</span>
        <span className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-ink-3">
          {c.status === "resolved" ? <span className="inline-flex h-5 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] text-ink-2">Resolved</span> : null}
          {c.assignee ? <span>Assigned to {c.assignee.name}</span> : <span>Unassigned</span>}
        </span>
      </span>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread && "bg-violet")} />
      {unread ? <span className="sr-only">{c.unread} unread</span> : null}
    </button>
  )
}

const circle = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet"

function CaseThread({ id, onBack, layer, onChanged }: { id: string; onBack?: () => void; layer?: boolean; onChanged: () => void }) {
  const caseQuery = useApi(`admin:support:case:${id}`, () => getSupportCase(id))
  const c = caseQuery.data?.case
  const scroller = useRef<ScrollerApi | null>(null)
  const [busy, setBusy] = useState<"status" | "assign" | null>(null)
  const send = useCallback((clientId: string, payload: DraftPayload) => replyAsSupport(id, clientId, payload.body ?? ""), [id])
  const t = useThread({ side: "support", conversationId: id, send, active: true, endpoints: adminSupportEndpoints })
  const refreshThread = t.refresh
  const revalidateCase = caseQuery.revalidate
  // Admin events carry ids only: refetch this thread and its header through the API.
  useRealtimeEvent("support.updated", (p) => {
    if (p.conversationId !== id) return
    void refreshThread()
    void revalidateCase()
  })
  const items = useMemo(() => [...t.messages.map((m) => ({ key: m.id, own: m.side === "support" })), ...t.pending.map((p) => ({ key: p.clientId, own: true }))], [t.messages, t.pending])
  const last = items[items.length - 1]

  const act = async (kind: "status" | "assign", body: { status?: "open" | "resolved"; assignee?: "me" | null }) => {
    setBusy(kind)
    try {
      const r = await patchSupportCase(id, body)
      caseQuery.mutate(() => r)
      void t.refresh()
      onChanged()
      revalidatePrefix("/api/admin/queues/counts")
      if (body.status) toast(body.status === "resolved" ? "Marked resolved" : "Reopened", { description: body.status === "resolved" ? "They see a line in the thread. Writing again reopens it." : undefined })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const partyHref = c ? (c.party.kind === "brand" ? (c.party.handle ? `/brands/${encodeURIComponent(c.party.handle)}` : "/admin/brands") : `/admin/users?user=${encodeURIComponent(c.party.id)}`) : null
  return (
    <section aria-label={c ? `Support conversation with ${c.party.name}` : "Support conversation"} className="flex h-full min-h-0 flex-col bg-obsidian">
      <header className={cn("flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-2 py-2 md:px-4", layer && "pt-[max(0.5rem,env(safe-area-inset-top))]")}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back to the queue" className={cn(circle, "glass")}>
            <ArrowLeftIcon className="size-5" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {c ? <PartyIcon kind={c.party.kind} /> : null}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              {partyHref && c ? (
                <Link href={partyHref} className="truncate text-[0.9375rem] font-medium text-ink hover:text-violet">
                  {c.party.name}
                </Link>
              ) : (
                <span className="truncate text-[0.9375rem] text-ink">{caseQuery.error ? "Conversation" : "Loading…"}</span>
              )}
              {c ? <StatusBadge tone={c.status === "open" ? "attention" : "success"}>{c.status === "open" ? "Open" : "Resolved"}</StatusBadge> : null}
            </span>
            {c ? <span className="block truncate text-xs text-ink-3">{c.party.kind === "brand" ? `Brand${c.party.handle ? ` @${c.party.handle}` : ""}` : (c.party.email ?? "Shopper")}{c.assignee ? `, assigned to ${c.assignee.name}` : ""}</span> : null}
          </span>
        </div>
        <ConnectionChip status={t.realtime} className="hidden xl:inline-flex" />
        {c ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" loading={busy === "assign"} onClick={() => void act("assign", { assignee: c.assignee ? null : "me" })}>
              {c.assignee ? "Unassign" : "Assign to me"}
            </Button>
            <Button size="sm" variant={c.status === "open" ? "secondary" : "ghost"} loading={busy === "status"} onClick={() => void act("status", { status: c.status === "open" ? "resolved" : "open" })}>
              {c.status === "open" ? (
                <>
                  <CheckCircleIcon /> Resolve
                </>
              ) : (
                "Reopen"
              )}
            </Button>
          </div>
        ) : null}
      </header>
      {t.status === "loading" || t.status === "idle" ? (
        <ThreadSkeleton />
      ) : t.status === "error" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <LoadError error={t.error} onRetry={() => void t.load()} what="this conversation" />
        </div>
      ) : (
        <ThreadScroller apiRef={scroller} resetKey={id} firstKey={items[0]?.key} lastKey={last?.key ?? "empty"} lastIsOwn={!!last?.own} hasMore={t.hasMore} loadingOlder={t.loadingOlder} onLoadOlder={t.loadOlder}>
          <MessageList side="support" messages={t.messages} pending={t.pending} otherName={c?.party.name ?? "They"} theyreTyping={t.theyreTyping} receipts={t.receipts} canInteract onRetry={t.retry} onDiscard={t.discard} showAuthor />
        </ThreadScroller>
      )}
      {t.status === "ready" ? (
        <>
          <p className="flex items-center gap-1.5 px-4 pt-2 text-[11px] text-ink-3">
            <SupportMark className="size-4 border-0" /> Replies go out as Yard Support. Your name isn&apos;t shown.
          </p>
          <Composer onSend={(payload, preview) => void t.send(payload, preview)} onTyping={t.notifyTyping} uploadTarget={null} placeholder="Reply as Yard Support" className={layer ? "border-t border-line-soft" : ""} />
        </>
      ) : null}
    </section>
  )
}
