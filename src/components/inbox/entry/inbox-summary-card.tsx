"use client"

import Link from "next/link"
import { ArrowCounterClockwiseIcon, ChatsCircleIcon } from "@phosphor-icons/react"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { SampleChip } from "@/components/ui/sample-chip"
import { listConversations } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import { useUnread } from "@/lib/realtime/unread"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** The Inbox card on /you (§7.3; N mounts it): unread count and the 3 latest conversations. */
export function InboxSummaryCard({ className }: { className?: string }) {
  const signedIn = useServerSession((s) => !!s.shopper)
  const unread = useUnread("market")
  const { data, error, isLoading, revalidate } = useApi(signedIn ? "inbox:summary" : null, () => listConversations())
  if (!signedIn) return null
  const latest = data?.items.slice(0, 3) ?? []
  return (
    <section aria-labelledby="inbox-summary" className={cn("rounded-lg border border-line-soft bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="inbox-summary" className="flex items-center gap-2 text-sm text-ink">
          <ChatsCircleIcon className="size-4 text-ink-2" aria-hidden /> Inbox
        </h2>
        <span className="text-xs text-ink-2 tabular">{unread === null ? "" : unread ? `${unread} unread` : "All read"}</span>
      </div>
      <div className="mt-4">
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : error ? (
          <div className="flex items-center gap-2 text-xs text-ink-2" role="alert">
            Couldn&apos;t load your messages.
            <Button size="sm" variant="ghost" onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </div>
        ) : !latest.length ? (
          <p className="text-sm text-ink-2">No messages yet. Ask a brand about sizing, stock or delivery from any storefront or product.</p>
        ) : (
          <ul className="grid gap-1">
            {latest.map((c) => {
              const b = brandById.get(c.brand.id)
              const isUnread = c.unread > 0 || c.markedUnread
              return (
                <li key={c.id}>
                  <Link href={`/inbox?thread=${c.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.04]">
                    {b ? <BrandMark brand={b} size="sm" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm text-ink">
                        <span className={cn("truncate", isUnread && "font-medium")}>{c.brand.name}</span>
                        {c.sample ? <SampleChip /> : null}
                      </span>
                      <span className="line-clamp-1 text-xs text-ink-2">{c.lastMessage?.preview ?? "No messages yet"}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">{c.lastMessage ? relativeTime(c.lastMessage.at) : ""}</span>
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", isUnread && "bg-violet")} />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <Button asChild variant="secondary" size="sm" className="mt-4">
        <Link href="/inbox">Open inbox</Link>
      </Button>
    </section>
  )
}
