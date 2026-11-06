"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { BellSlashIcon as BellOff, ChecksIcon as CheckCheck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { useHydrated } from "@/hooks/use-hydrated"
import { spring } from "@/lib/motion"
import { categoryLabel, useNotifications, type AppNotification, type Audience } from "@/lib/stores/notifications"
import { cn } from "@/lib/utils"
import { NotificationRow, useVisibleNotifications } from "./notification-bell"

/** The full notifications list for one audience: filter by read state and category. */
export function NotificationsList({ audience }: { audience: Audience }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [category, setCategory] = useState<string>("all")
  const items = useVisibleNotifications(audience)
  const categories = useMemo(() => [...new Set(items.map((n) => categoryLabel[n.category]))], [items])
  const shown = items.filter((n) => (filter === "unread" ? !n.read : true) && (category === "all" || categoryLabel[n.category] === category))
  const unread = items.filter((n) => !n.read).length

  function open(n: AppNotification) {
    markRead(n.id)
    if (n.href) router.push(n.href)
  }

  if (!hydrated) return <ListSkeleton rows={6} />

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} type="button" onClick={() => setFilter(f)} className={cn("relative isolate h-10 rounded-full border px-3.5 text-[12.5px] transition-colors sm:h-8 sm:px-3 pointer-coarse:h-10 pointer-coarse:px-3.5", filter === f ? "border-purple text-ink" : "border-white/10 text-ink-2 hover:text-ink")}>
              {filter === f ? <motion.span layoutId={`nf-${audience}`} transition={spring.indicator} className="absolute inset-0 -z-10 rounded-full bg-purple" /> : null}
              {f === "all" ? `All ${items.length}` : `Unread ${unread}`}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-white/10" aria-hidden />
          {["all", ...categories].map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={cn("h-10 rounded-full border px-3.5 text-[12.5px] transition-colors sm:h-8 sm:px-3 pointer-coarse:h-10 pointer-coarse:px-3.5", category === c ? "border-white/30 bg-white/8 text-ink" : "border-white/10 text-ink-2 hover:text-ink")}>
              {c === "all" ? "All types" : c}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => markAllRead(audience)} disabled={!unread} className="h-10 sm:h-8 pointer-coarse:h-10">
          <CheckCheck /> Mark all as read
        </Button>
      </div>
      <div className="rounded-xl border border-white/8 bg-card p-2">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="inline-flex size-11 items-center justify-center rounded-full border border-white/10"><BellOff className="size-5 text-ink-3" /></span>
            <p className="mt-3 text-sm text-ink">{filter === "unread" ? "Nothing unread" : "No notifications here yet"}</p>
            <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">When something happens that needs you, it shows up here and on the bell.</p>
          </div>
        ) : (
          <ul className="grid gap-0.5">
            <AnimatePresence initial={false}>
              {shown.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={open} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <p className="text-[12px] text-ink-3">Items marked “Sample” come from the development data set; everything else was triggered by actions in this browser.</p>
    </div>
  )
}
