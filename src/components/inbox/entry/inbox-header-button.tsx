"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { ChatsCircleIcon } from "@phosphor-icons/react"
import { floatIcon } from "@/components/market/market-header"
import { useUnread } from "@/lib/realtime/unread"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** "Inbox, 3 unread". */
export const inboxLabel = (n: number | null) => (n ? `Inbox, ${n} unread` : "Inbox")

/**
 * The marketplace header's Inbox button (§6.2; N mounts it): a 40 px floating icon, signed in
 * only, with an ink unread pill like the notification bell's beside it (capped at "9+"; acid is
 * kept for the page's one primary action). The count comes from the server (the realtime
 * provider fills the unread store) and shows nothing until known.
 */
export function InboxHeaderButton({ className }: { className?: string }) {
  const signedIn = useServerSession((s) => !!s.shopper)
  const unread = useUnread("market")
  if (!signedIn) return null
  return (
    <Link href="/inbox" aria-label={inboxLabel(unread)} className={cn(floatIcon, className)}>
      <ChatsCircleIcon className="size-[21px]" />
      {unread ? (
        <motion.span key={`inbox-${unread}`} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 22 }} className="absolute top-1 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-obsidian tabular">
          {unread > 9 ? "9+" : unread}
        </motion.span>
      ) : null}
    </Link>
  )
}
