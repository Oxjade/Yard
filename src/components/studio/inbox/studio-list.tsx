"use client"

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowCounterClockwiseIcon, ChatsCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { Tag, useLiveList } from "@/components/inbox/conversation-list"
import { waitingFor } from "@/components/inbox/format"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { Initials } from "@/components/studio/business/shared"
import { Button } from "@/components/ui/button"
import { SampleChip } from "@/components/ui/sample-chip"
import type { ConversationSummary, ConversationsPage, StudioFilter } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { blockCustomer, listStudioConversations } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { useNow } from "@/hooks/use-now"
import { spring } from "@/lib/motion"
import { needsRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const empties: Record<StudioFilter, { title: string; body: string }> = {
  open: { title: "No open conversations", body: "Everything's answered or resolved. New questions from shoppers land here." },
  unread: { title: "No unread messages", body: "You're up to date." },
  resolved: { title: "Nothing resolved yet", body: "Resolve a conversation once the shopper has what they need. It reopens if they write again." },
  spam: { title: "No spam", body: "Conversations you mark as spam leave Open and wait here." },
  blocked: { title: "No blocked customers", body: "Customers you block can't message you. They'd be listed here, with Unblock." },
}

/** Studio's conversation list (§6.2): status tabs with counts, brand-scoped search, live rows. */
export function StudioList({
  selected,
  onSelect,
  filter,
  onFilter,
  q,
  onQuery,
  canManage,
  onPage,
  className,
}: {
  selected: string | null
  onSelect: (c: ConversationSummary) => void
  filter: StudioFilter
  onFilter: (f: StudioFilter) => void
  q: string
  onQuery: (q: string) => void
  canManage: boolean
  onPage?: (p: ConversationsPage) => void
  className?: string
}) {
  const [term, setTerm] = useState(q)
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (term !== q) onQuery(term)
    }, 250)
    return () => window.clearTimeout(t)
  }, [term, q, onQuery])
  const key = `studio:inbox:list:${filter}:${q}`
  const { data, error, isLoading, mutate, revalidate } = useApi(key, () => listStudioConversations({ filter, q: q || undefined }))
  const [moreState, setMore] = useState<{ key: string; items: ConversationSummary[]; next: string | null } | null>(null)
  const more = moreState?.key === key ? moreState : null
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => {
    if (data) onPage?.(data)
  }, [data, onPage])

  const belongs = useCallback(
    (c: ConversationSummary) => {
      const spam = c.spamState === "confirmed"
      const blocked = c.blocked.byMe
      if (filter === "spam") return spam
      if (filter === "blocked") return blocked
      if (spam || blocked) return false
      if (filter === "unread") return c.unread > 0 || c.markedUnread
      if (filter === "resolved") return c.status === "resolved"
      return c.status === "open"
    },
    [filter],
  )
  useLiveList(mutate as never, revalidate, belongs)

  const items = [...(data?.items ?? []), ...(more?.items ?? []).filter((m) => !data?.items.some((d) => d.id === m.id))]
  const next = more ? more.next : (data?.nextCursor ?? null)
  const counts = data?.counts
  const total = counts ? counts.open + counts.resolved + counts.spam + counts.blocked : null

  const unblock = async (c: ConversationSummary) => {
    if (!c.customer) return
    try {
      await blockCustomer(c.customer.id, false)
      toast(`Unblocked ${c.customer.name}`, { description: "They can message you again." })
      void revalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="px-3 pt-3 md:px-4">
        <StatusTabs
          id="inbox-tabs"
          label="Conversations"
          value={filter}
          onChange={onFilter}
          controls="inbox-list"
          tabs={[
            { value: "open", label: "Open", count: counts?.open },
            { value: "unread", label: "Unread", count: counts?.unread },
            { value: "resolved", label: "Resolved", count: counts?.resolved },
            { value: "spam", label: "Spam", count: counts?.spam },
            { value: "blocked", label: "Blocked", count: counts?.blocked },
          ]}
        />
        <label className="relative mt-3 block">
          <span className="sr-only">Search conversations</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search customers and messages" className="h-9 w-full rounded-md border border-line bg-transparent pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-2/50 pointer-coarse:h-10" />
        </label>
      </div>
      <div id="inbox-list" role="tabpanel" aria-labelledby={`inbox-tabs-${filter}`} className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3 md:px-3">
        {isLoading ? (
          <div className="px-2 pt-2">
            <ListSkeleton rows={8} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center" role="alert">
            <p className="text-sm text-ink">Couldn&apos;t load conversations</p>
            <p className="max-w-xs text-xs text-ink-2">{errorMessage(error)}</p>
            <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </div>
        ) : !items.length ? (
          q ? (
            <EmptyState className="mx-2 mt-2" icon={MagnifyingGlassIcon} title={`No conversations match “${q}”`} body="Search looks at customer names and messages in this filter." />
          ) : total === 0 ? (
            <EmptyState className="mx-2 mt-2" icon={ChatsCircleIcon} title="No messages yet" body="When shoppers ask about your pieces, sizing or delivery, their questions land here." />
          ) : (
            <EmptyState className="mx-2 mt-2" icon={ChatsCircleIcon} title={empties[filter].title} body={empties[filter].body} />
          )
        ) : (
          <ul className="grid gap-0.5" aria-label="Conversations">
            <AnimatePresence initial={false}>
              {items.map((c) => (
                <StudioRow key={c.id} c={c} selected={c.id === selected} onSelect={onSelect} onUnblock={filter === "blocked" ? () => void unblock(c) : undefined} canManage={canManage} />
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
                  const r = await listStudioConversations({ filter, q: q || undefined, cursor: next })
                  setMore((m) => ({ key, items: [...(m?.key === key ? m.items : []), ...r.items], next: r.nextCursor }))
                } catch (e) {
                  toast.error(errorMessage(e))
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

function StudioRow({ c, selected, onSelect, onUnblock, canManage }: { c: ConversationSummary; selected: boolean; onSelect: (c: ConversationSummary) => void; onUnblock?: () => void; canManage: boolean }) {
  const now = useNow(60_000)
  const name = c.customer?.name ?? "Shopper"
  const unread = c.unread > 0 || c.markedUnread
  const waiting = now !== null && c.status === "open" && c.lastMessage?.side === "customer" && now - Date.parse(c.lastMessage.at) > 3600_000 ? waitingFor(c.lastMessage.at, now) : null
  const preview = c.lastMessage ? `${c.lastMessage.side === "brand" ? "You: " : ""}${c.lastMessage.preview}` : ""
  return (
    <motion.li layout="position" transition={spring.layout} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(c)}
        aria-current={selected ? "true" : undefined}
        className={cn("flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:bg-white/[0.05] focus-visible:outline-none", selected ? "bg-purple/15" : "hover:bg-white/[0.04]")}
      >
        <Initials name={name} className="mt-0.5 size-9" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-sm", unread ? "font-medium text-ink" : "text-ink")}>{name}</span>
            {c.sample ? <SampleChip /> : null}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-3">{c.lastMessage ? relativeTime(c.lastMessage.at) : ""}</span>
          </span>
          <span className={cn("mt-0.5 line-clamp-1 text-[13px]", unread ? "font-medium text-ink" : "text-ink-2")}>{preview}</span>
          {waiting || c.status === "resolved" || c.blocked.byThem ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
              {waiting ? <span>Waiting {waiting}</span> : null}
              {c.status === "resolved" ? <Tag>Resolved</Tag> : null}
              {c.blocked.byThem ? <Tag>Not accepting messages</Tag> : null}
            </span>
          ) : null}
        </span>
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", unread && "bg-violet")} />
        {unread ? <span className="sr-only">Unread</span> : null}
      </button>
      {onUnblock ? (
        <Button size="sm" variant="secondary" onClick={onUnblock} disabled={!canManage} title={canManage ? undefined : needsRole("inbox.manage")} className="mr-1 shrink-0">
          Unblock
        </Button>
      ) : null}
    </motion.li>
  )
}
