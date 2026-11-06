"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { ArrowCounterClockwiseIcon, ChatsCircleIcon, FunnelSimpleIcon, MagnifyingGlassIcon, SealCheckIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import type { ConversationSummary, ConversationsPage } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { listConversations } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import { spring } from "@/lib/motion"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"

/** Newest activity first: the last message, else when the conversation started. */
const sortAt = (c: ConversationSummary) => c.lastMessage?.at ?? c.createdAt
export const sortConversations = (list: ConversationSummary[]) => [...list].sort((a, b) => sortAt(b).localeCompare(sortAt(a)) || b.id.localeCompare(a.id))

/**
 * Merges live summaries into a list page as they arrive (a new message jumps its row to the top),
 * then refetches shortly after so filters, counts and anything the event didn't carry settle.
 */
export function useLiveList<T extends ConversationsPage>(mutate: (fn: (cur: T | undefined) => T | undefined) => void, revalidate: () => unknown, belongs: (c: ConversationSummary) => boolean) {
  const timer = useRef<number | undefined>(undefined)
  const soon = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void revalidate(), 400)
  }, [revalidate])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const apply = useCallback(
    (c: ConversationSummary | undefined, partial: boolean) => {
      if (!partial && c) {
        mutate((cur) => {
          if (!cur) return cur
          const has = cur.items.some((x) => x.id === c.id)
          const items = has ? cur.items.map((x) => (x.id === c.id ? { ...x, ...c, interaction: x.interaction } : x)) : belongs(c) ? [c, ...cur.items] : cur.items
          return { ...cur, items: sortConversations(items.filter(belongs)) }
        })
      }
      soon()
    },
    [mutate, belongs, soon],
  )
  useRealtimeEvent("message.created", (p, meta) => apply(meta.partial ? undefined : p.conversation, meta.partial))
  useRealtimeEvent("message.updated", (p, meta) => apply(meta.partial ? undefined : p.conversation, meta.partial))
  useRealtimeEvent("conversation.updated", (p, meta) => apply(meta.partial ? undefined : p.conversation, meta.partial))
  useRealtimeEvent("read", () => soon())
}

const filterLabel = { blocked: "Show blocked", archived: "Archived" } as const

/** The shopper's conversation list (§6.2), styled like NotificationRow. */
export function ConversationList({ selected, onSelect, filter, onFilter, q, onQuery, className }: { selected: string | null; onSelect: (c: ConversationSummary) => void; filter: "blocked" | "archived" | null; onFilter: (f: "blocked" | "archived" | null) => void; q: string; onQuery: (q: string) => void; className?: string }) {
  const [term, setTerm] = useState(q)
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (term !== q) onQuery(term)
    }, 250)
    return () => window.clearTimeout(t)
  }, [term, q, onQuery])
  const key = `inbox:list:${filter ?? "all"}:${q}`
  const { data, error, isLoading, mutate, revalidate } = useApi(key, () => listConversations({ q: q || undefined, filter: filter ?? undefined }))
  const [moreState, setMore] = useState<{ key: string; items: ConversationSummary[]; next: string | null } | null>(null)
  const more = moreState?.key === key ? moreState : null
  const [loadingMore, setLoadingMore] = useState(false)
  const belongs = useCallback(
    (c: ConversationSummary) => (filter === "blocked" ? c.blocked.byMe : filter === "archived" ? c.archived && !c.blocked.byMe : !c.archived && !c.blocked.byMe),
    [filter],
  )
  useLiveList(mutate as never, revalidate, belongs)

  const items = [...(data?.items ?? []), ...(more?.items ?? []).filter((m) => !data?.items.some((d) => d.id === m.id))]
  const next = more ? more.next : (data?.nextCursor ?? null)

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 pb-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search messages</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search brands and messages" className="h-10 w-full rounded-full border border-line-soft bg-card pr-4 pl-10 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-white/15" />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={filter ? `Filter: ${filterLabel[filter]}` : "Filter conversations"} className={cn("relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors", filter ? "border-purple/60 bg-purple/15 text-violet" : "border-line-soft bg-card text-ink-2 hover:text-ink")}>
              <FunnelSimpleIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="text-xs text-ink-3">Show</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={filter === "blocked"} onCheckedChange={(v) => onFilter(v ? "blocked" : null)}>
              Show blocked
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={filter === "archived"} onCheckedChange={(v) => onFilter(v ? "archived" : null)}>
              Archived
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filter ? (
        <div className="flex items-center justify-between gap-2 pb-2 text-xs text-ink-2">
          <span>{filter === "blocked" ? "Brands you've blocked" : "Archived conversations"}</span>
          <button type="button" className="rounded-full px-2 py-1 text-ink hover:bg-white/[0.05]" onClick={() => onFilter(null)}>
            Back to inbox
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-1 pt-2">
            <ListSkeleton rows={6} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center" role="alert">
            <p className="text-sm text-ink">Couldn&apos;t load your messages.</p>
            <p className="max-w-xs text-xs text-ink-2">{errorMessage(error)}</p>
            <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </div>
        ) : !items.length ? (
          q ? (
            <EmptyState icon={MagnifyingGlassIcon} title={`No conversations match “${q}”`} body="Search looks at brand names and the messages you can see." />
          ) : filter === "blocked" ? (
            <EmptyState icon={ChatsCircleIcon} title="No blocked brands" body="Brands you block can't message you. They'd show here." />
          ) : filter === "archived" ? (
            <EmptyState icon={ChatsCircleIcon} title="No archived conversations" body="Archive a conversation from its menu to tidy your inbox. It comes back when someone writes." />
          ) : (
            <EmptyState
              icon={ChatsCircleIcon}
              title="No messages yet"
              body="Ask a brand about sizing, stock or delivery — start from any storefront or product."
              action={
                <Button asChild variant="secondary">
                  <Link href="/brands">Browse brands</Link>
                </Button>
              }
            />
          )
        ) : (
          <ul className="grid gap-0.5" aria-label="Conversations">
            <AnimatePresence initial={false}>
              {items.map((c) => (
                <ConversationRow key={c.id} c={c} selected={c.id === selected} onSelect={onSelect} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {next && !isLoading && !error ? (
          <div className="flex justify-center py-3">
            <Button
              size="sm"
              variant="ghost"
              loading={loadingMore}
              onClick={async () => {
                setLoadingMore(true)
                try {
                  const r = await listConversations({ q: q || undefined, filter: filter ?? undefined, cursor: next })
                  setMore((m) => ({ key, items: [...(m?.key === key ? m.items : []), ...r.items], next: r.nextCursor }))
                } finally {
                  setLoadingMore(false)
                }
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ConversationRow({ c, selected, onSelect }: { c: ConversationSummary; selected: boolean; onSelect: (c: ConversationSummary) => void }) {
  const brand = brandById.get(c.brand.id)
  const unread = c.unread > 0 || c.markedUnread
  const preview = c.lastMessage ? `${c.lastMessage.side === "customer" && !c.lastMessage.held ? "You: " : ""}${c.lastMessage.preview}` : "No messages yet"
  return (
    <motion.li layout="position" transition={spring.layout} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <button
        type="button"
        onClick={() => onSelect(c)}
        aria-current={selected ? "true" : undefined}
        className={cn("flex w-full items-start gap-3 rounded-xl px-2.5 py-3 text-left transition-colors focus-visible:bg-white/[0.05] focus-visible:outline-none", selected ? "bg-purple/15" : "hover:bg-white/[0.04]")}
      >
        {brand ? <BrandMark brand={brand} size="sm" className="size-10" /> : <span className="size-10 shrink-0 rounded-md border border-white/12" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-sm", unread ? "font-medium text-ink" : "text-ink")}>{c.brand.name}</span>
            {c.brand.verified ? <SealCheckIcon weight="fill" className="size-3.5 shrink-0 text-violet" aria-label="Verified" /> : null}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-3">{c.lastMessage ? relativeTime(c.lastMessage.at) : ""}</span>
          </span>
          <span className={cn("mt-0.5 line-clamp-1 text-[13px]", unread ? "font-medium text-ink" : "text-ink-2")}>{preview}</span>
          {c.status === "resolved" || c.blocked.byMe || c.archived || c.sample || c.muted ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {c.status === "resolved" ? <Tag>Resolved</Tag> : null}
              {c.blocked.byMe ? <Tag>Blocked</Tag> : null}
              {c.archived ? <Tag>Archived</Tag> : null}
              {c.muted ? <Tag>Muted</Tag> : null}
              {c.sample ? <SampleChip /> : null}
            </span>
          ) : null}
        </span>
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread && "bg-violet")} />
        {unread ? <span className="sr-only">Unread</span> : null}
      </button>
    </motion.li>
  )
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] text-ink-2">{children}</span>
}
