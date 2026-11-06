"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { BellIcon } from "@phosphor-icons/react"
import { WarningIcon as AlertTriangle, SealCheckIcon as BadgeCheck, BellIcon as Bell, BellSlashIcon as BellOff, CubeIcon as Box, ChecksIcon as CheckCheck, CreditCardIcon as CreditCard, EnvelopeSimpleIcon, EnvelopeSimpleOpenIcon, FlagIcon as Flag, HeartIcon as Heart, MegaphoneIcon as Megaphone, PackageIcon as Package, ArrowCounterClockwiseIcon as RotateCcw, ShieldWarningIcon as ShieldAlert, ShoppingBagOpenIcon as ShoppingBag, SparkleIcon as Sparkles, StorefrontIcon, TruckIcon as Truck, UserPlusIcon as UserPlus, WalletIcon as Wallet, LightningIcon as Zap } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useHydrated } from "@/hooks/use-hydrated"
import { spring } from "@/lib/motion"
import { categoryLabel, useNotifications, type AppNotification, type Audience, type NotificationCategory } from "@/lib/stores/notifications"
import { cn } from "@/lib/utils"

const icons: Partial<Record<NotificationCategory, React.ComponentType<{ className?: string }>>> = {
  order_confirmed: ShoppingBag,
  order_shipped: Truck,
  order_delivered: Package,
  brand_announcement: Megaphone,
  drop_live: Zap,
  wishlist_update: Heart,
  followed_activity: Sparkles,
  refund: RotateCcw,
  new_order: ShoppingBag,
  payment_received: CreditCard,
  low_inventory: Box,
  out_of_stock: Box,
  new_follower: UserPlus,
  drop_performance: Zap,
  campaign_review: Megaphone,
  payout_status: Wallet,
  refund_request: RotateCcw,
  account_status: StorefrontIcon,
  merchant_application: BadgeCheck,
  product_report: Flag,
  payment_failure: CreditCard,
  chargeback: ShieldAlert,
  suspicious_activity: ShieldAlert,
  system_alert: AlertTriangle,
}

const urgent: NotificationCategory[] = ["out_of_stock", "payment_failure", "chargeback", "suspicious_activity", "system_alert", "refund_request"]

export function relativeTime(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const m = Math.round(diff / 60000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

export const notificationsHref: Record<Audience, string> = { customer: "/notifications", merchant: "/studio/notifications", admin: "/admin/notifications" }

/**
 * One notification: the row opens it (and marks it read); a second control flips read and
 * unread. With a mouse that control is a small "Mark read" pill that appears over the row's
 * corner on hover or keyboard focus, so desktop rows stay quiet. On touch, where nothing
 * hovers, it is always there as a 40px envelope at the row's edge: closed with the unread
 * dot while unread, open once read.
 */
export function NotificationRow({ n, onOpen, compact = false }: { n: AppNotification; onOpen?: (n: AppNotification) => void; compact?: boolean }) {
  const markRead = useNotifications((s) => s.markRead)
  const markUnread = useNotifications((s) => s.markUnread)
  const Icon = icons[n.category] ?? Bell
  const isUrgent = urgent.includes(n.category)
  const State = n.read ? EnvelopeSimpleOpenIcon : EnvelopeSimpleIcon
  return (
    <motion.li layout="position" transition={spring.layout} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="group relative flex min-w-0">
      <button
        type="button"
        onClick={() => onOpen?.(n)}
        className={cn("flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition-colors duration-150 hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline-none", compact ? "px-2.5 py-2.5 pointer-coarse:pr-0" : "px-3 py-3 pointer-coarse:pr-0")}
      >
        <span className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border", isUrgent && !n.read ? "border-acid/40 text-acid" : "border-white/10 text-ink-2")}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 truncate text-[13px]", n.read ? "text-ink-2" : "font-medium text-ink")}>{n.title}</span>
          </span>
          <span className={cn("mt-0.5 block text-[12px] leading-snug text-ink-3", compact ? "line-clamp-2" : "")}>{n.body}</span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
            <span>{categoryLabel[n.category]}</span>
            <span aria-hidden className="size-0.5 rounded-full bg-ink-3" />
            <time dateTime={n.at}>{relativeTime(n.at)}</time>
            {n.sample ? <span className="rounded-[3px] border border-white/10 px-1 text-[10px]">Sample</span> : null}
          </span>
        </span>
        {/* On touch the envelope beside the row carries the unread dot instead. */}
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full pointer-coarse:hidden", !n.read && "bg-violet")} />
        {!n.read ? <span className="sr-only">Unread</span> : null}
      </button>
      <button
        type="button"
        aria-label={n.read ? "Mark unread" : "Mark read"}
        onClick={() => (n.read ? markUnread(n.id) : markRead(n.id))}
        className={cn(
          "absolute top-2 right-2 hidden h-6 items-center rounded-md bg-[#1b1b1b] px-2 text-[11px] text-ink-2 shadow-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-violet group-hover:inline-flex group-focus-within:inline-flex",
          "pointer-coarse:static pointer-coarse:inline-flex pointer-coarse:h-auto pointer-coarse:w-10 pointer-coarse:shrink-0 pointer-coarse:justify-center pointer-coarse:self-stretch pointer-coarse:rounded-lg pointer-coarse:bg-transparent pointer-coarse:px-0 pointer-coarse:shadow-none",
          compact ? "pointer-coarse:items-start pointer-coarse:pt-2.5" : "pointer-coarse:items-start pointer-coarse:pt-3",
        )}
      >
        <span aria-hidden className="pointer-coarse:hidden">{n.read ? "Mark unread" : "Mark read"}</span>
        <span aria-hidden className="relative mt-2 hidden size-5 items-center justify-center pointer-coarse:inline-flex">
          <State className={cn("size-[18px]", n.read ? "text-ink-3" : "text-ink-2")} />
          {!n.read ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-violet ring-2 ring-obsidian" /> : null}
        </span>
      </button>
    </motion.li>
  )
}

/**
 * The notification bell: unread count, a dropdown list with read/unread, mark all as read,
 * and a link to the full page. Items come from real application events; new ones slide in
 * once, existing ones never re-animate.
 */
export function NotificationBell({ audience, className, align = "end" }: { audience: Audience; className?: string; align?: "start" | "end" }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"all" | "unread">("all")
  const all = useNotifications((s) => s.items)
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const items = useMemo(() => all.filter((n) => n.audience === audience), [all, audience])
  const unread = hydrated ? items.filter((n) => !n.read).length : 0
  const shown = (tab === "unread" ? items.filter((n) => !n.read) : items).slice(0, 8)

  function openItem(n: AppNotification) {
    markRead(n.id)
    setOpen(false)
    if (n.href) router.push(n.href)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className={cn("relative inline-flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-white/8 hover:text-ink data-[state=open]:bg-white/10 data-[state=open]:text-ink", className)}>
          <BellIcon className="size-[21px]" />
          <AnimatePresence>
            {unread > 0 ? (
              <motion.span
                key="badge"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={spring.snappy}
                className="absolute top-1.5 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-acid px-1 text-[10px] font-semibold text-obsidian tabular"
              >
                <motion.span key={unread} initial={{ y: -4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.snappy}>
                  {unread > 9 ? "9+" : unread}
                </motion.span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={10} className="w-[min(380px,calc(100vw-1rem))] gap-0 rounded-2xl p-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">Notifications</p>
            <p className="text-[11px] text-ink-3">{unread ? `${unread} unread` : "You're all caught up"}</p>
          </div>
          <button type="button" onClick={() => markAllRead(audience)} disabled={!unread} className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-2 transition-colors hover:bg-white/6 hover:text-ink disabled:pointer-events-none disabled:opacity-40 sm:h-8 pointer-coarse:h-10">
            <CheckCheck className="size-3.5" /> Mark all as read
          </button>
        </div>
        <div role="tablist" aria-label="Filter notifications" className="flex gap-1 px-3 pt-2">
          {(["all", "unread"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cn("relative isolate h-10 min-w-10 rounded-md px-3 text-[12px] capitalize transition-colors sm:h-7 sm:px-2.5 pointer-coarse:h-10 pointer-coarse:px-3", tab === t ? "text-ink" : "text-ink-2 hover:text-ink")}>
              {tab === t ? <motion.span layoutId={`notif-tab-${audience}`} transition={spring.indicator} className="absolute inset-0 -z-10 rounded-md bg-white/8" /> : null}
              {t}
            </button>
          ))}
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
          {shown.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="inline-flex size-10 items-center justify-center rounded-full border border-white/10"><BellOff className="size-4 text-ink-3" /></span>
              <p className="mt-3 text-sm text-ink">{tab === "unread" ? "Nothing unread" : "No notifications yet"}</p>
              <p className="mt-1 text-[12px] text-ink-3">Orders, drops and updates will show up here.</p>
            </div>
          ) : (
            <ul className="grid gap-0.5">
              <AnimatePresence initial={false}>
                {shown.map((n) => (
                  <NotificationRow key={n.id} n={n} onOpen={openItem} compact />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
        <div className="border-t border-white/8 p-2">
          <Link href={notificationsHref[audience]} onClick={() => setOpen(false)} className="flex h-10 items-center justify-center rounded-lg text-[12.5px] text-ink-2 transition-colors hover:bg-white/5 hover:text-ink sm:h-9 pointer-coarse:h-10">
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
