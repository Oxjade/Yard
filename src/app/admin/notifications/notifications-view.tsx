"use client"

import { useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence } from "motion/react"
import { BellSlashIcon, CaretDownIcon, ChecksIcon, FunnelSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/dashboard/empty-state"
import { NotificationRow } from "@/components/feedback/notification-bell"
import { Bone } from "@/components/feedback/skeletons"
import { Reveal } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { useNotificationsReady } from "@/components/admin/platform/ready"
import { categoryLabel, useNotifications, type AppNotification } from "@/lib/stores/notifications"

const ALL = "all"
/** The categories the bell marks as urgent, in words for the status line. */
const URGENT: Partial<Record<AppNotification["category"], string>> = {
  payment_failure: "payment failures",
  chargeback: "chargebacks",
  refund_request: "refund requests",
  suspicious_activity: "risk alerts",
  system_alert: "system alerts",
}
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

/** Today, yesterday, earlier this week, older: by the viewer's calendar. */
function groupOf(iso: string, now: Date) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(now) - day(new Date(iso))) / 86_400_000)
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return "Earlier this week"
  return "Older"
}

export function AdminNotificationsView() {
  const router = useRouter()
  const ready = useNotificationsReady()
  const tid = useId()
  const all = useNotifications((s) => s.items)
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [category, setCategory] = useState<string>(ALL)

  const items = useMemo(() => all.filter((n) => n.audience === "admin"), [all])
  const unread = items.filter((n) => !n.read)
  const urgent = unread.filter((n) => URGENT[n.category])
  const urgentKinds = [...new Set(urgent.map((n) => URGENT[n.category]!))]
  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of items) m.set(categoryLabel[n.category], (m.get(categoryLabel[n.category]) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  const shown = items.filter((n) => (filter === "unread" ? !n.read : true) && (category === ALL || categoryLabel[n.category] === category))
  const groups = useMemo(() => {
    const now = new Date()
    const out: { label: string; items: AppNotification[] }[] = []
    for (const n of shown) {
      const label = groupOf(n.at, now)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(n)
      else out.push({ label, items: [n] })
    }
    return out
  }, [shown])

  function open(n: AppNotification) {
    markRead(n.id)
    if (n.href) router.push(n.href)
  }

  function readAll() {
    markAllRead("admin")
    // The button disables itself once nothing is unread; keep keyboard focus on the inbox.
    document.getElementById(segmentedTabId(tid, filter))?.focus()
  }

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Notifications"
        description="Brand applications, listing reports, payment failures, chargebacks and system alerts, as they happen."
        note="Items marked Sample come from the development data set. Everything else was triggered by actions in this browser."
      />

      <Panel
        title="Inbox"
        description={ready && urgent.length ? `${urgent.length} unread ${urgent.length === 1 ? "is" : "are"} urgent: ${list(urgentKinds)}. Open one to go to the record it's about.` : "Open one to go to the record it's about. Opening marks it read."}
        action={
          <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={readAll} disabled={!ready || !unread.length}>
            <ChecksIcon aria-hidden /> <span className="hidden sm:inline">Mark all as read</span>
            <span className="sm:hidden">Read all</span>
          </Button>
        }
        className="rounded-[20px]"
        bodyClassName="px-0 pb-0 md:px-0 md:pb-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 md:px-5">
          <Segmented
            label="Show"
            size="sm"
            value={filter}
            onChange={setFilter}
            loading={!ready}
            idBase={tid}
            panelId={`${tid}-panel`}
            options={[
              { value: "all", label: "All" },
              // Unread is a plain total, not work waiting on a person: grey, not the attention acid.
              { value: "unread", label: "Unread", count: unread.length, countTone: "neutral" },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="h-10 sm:h-8" disabled={!ready}>
                <FunnelSimpleIcon aria-hidden />
                {category === ALL ? "All types" : category}
                <CaretDownIcon aria-hidden className="size-3.5 text-ink-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="text-[11px] text-ink-3">Type</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={category} onValueChange={setCategory}>
                <DropdownMenuRadioItem value={ALL}>
                  All types <span className="ml-auto pl-4 text-[11px] text-ink-3 tabular">{items.length}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {categories.map(([label, n]) => (
                  <DropdownMenuRadioItem key={label} value={label}>
                    {label} <span className="ml-auto pl-4 text-[11px] text-ink-3 tabular">{n}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div id={`${tid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(tid, filter)} className="border-t border-[var(--admin-hairline)] px-2 py-2 md:px-3">
          {!ready ? (
            <ul aria-hidden className="grid gap-0.5">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex items-start gap-3 px-3 py-3">
                  <Bone className="size-8 shrink-0 rounded-full" />
                  <div className="grid flex-1 gap-2">
                    <Bone className="h-3.5 w-1/2" />
                    <Bone className="h-3 w-3/4" />
                    <Bone className="h-2.5 w-24" />
                  </div>
                </li>
              ))}
            </ul>
          ) : shown.length === 0 ? (
            <div className="p-2">
              <EmptyState
                icon={BellSlashIcon}
                title={filter === "unread" ? "Nothing unread" : category !== ALL ? `No ${category.toLowerCase()} notifications` : "No notifications yet"}
                body={filter === "unread" ? "Everything here has been read." : "When something needs the platform team, it shows up here and on the bell."}
                action={
                  filter !== "all" || category !== ALL ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setFilter("all")
                        setCategory(ALL)
                      }}
                    >
                      Show everything
                    </Button>
                  ) : undefined
                }
                className="border-0 py-12"
              />
            </div>
          ) : (
            // Keyed by the filters: changing a filter swaps the list at once; only items that
            // leave because they were read animate out.
            <div key={`${filter}-${category}`}>
              {groups.map((g) => (
                <section key={g.label} aria-label={g.label} className="pb-1">
                  <h3 className="px-3 pt-3 pb-1 text-[11px] text-ink-3">{g.label}</h3>
                  <ul className="grid gap-0.5">
                    <AnimatePresence initial={false}>
                      {g.items.map((n) => (
                        <NotificationRow key={n.id} n={n} onOpen={open} />
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </Reveal>
  )
}
