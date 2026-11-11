"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDotsIcon as CalendarClock, CalendarPlusIcon as CalendarPlus, CopyIcon as Copy, PencilSimpleIcon as Pencil, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { CurrencyCode } from "@/config/markets"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { brandById } from "@/lib/data/brands"
import { dropAccessLabel, dropWindow } from "@/lib/drops"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { PhoneSort, phoneCellWide, useFocusReturn } from "@/components/studio/business/shared"
import { CATALOGUE_NOTE, dropsDescription } from "./copy"
import { ListSkeleton } from "./form"
import { useGrowth, useGrowthReady } from "./store"
import { brandZone, dropRevenue, localId, dropStatusMeta, dropUnitsSold, formatInZone, notifyCount, relativeTime, studioDropStatus, zoneAbbr, type StudioDropStatus } from "./utils"
import { useServerSession } from "@/lib/session/use-server-session"
import { LiveDropsIndex } from "./live-drops-index"

type Tab = "all" | "scheduled" | "live" | "drafts" | "past"
type Sort = "status" | "release" | "notify" | "name"

/** The phone sort menu: the same orders the desktop column headers give. */
const sortOptions: { value: Sort; label: string }[] = [
  { value: "status", label: "Live and next first" },
  { value: "release", label: "Latest release first" },
  { value: "notify", label: "Most sign-ups" },
  { value: "name", label: "Name, A to Z" },
]

type Row = {
  drop: Drop
  status: StudioDropStatus
  release: number
  end: number
  notify: number
  sold: number
  revenue: number
}

export function DropsIndex() {
  const session = useServerSession()
  const ready = useGrowthReady()
  const now = useNow(30_000)
  if (session.status === "loading") return <ListSkeleton title="Drops" description={dropsDescription} />
  if (session.brand && !session.brand.demo) return <LiveDropsIndex key={session.brand.brand.id} brandId={session.brand.brand.id} canManage={session.brand.permissions.includes("content.publish")} />
  if (!ready || now === null) return <ListSkeleton title="Drops" description={dropsDescription} />
  return <DropsIndexView now={now} />
}

function DropsIndexView({ now }: { now: number }) {
  const router = useRouter()
  const brandId = useStudio((s) => s.brandId)
  const drops = useStudio((s) => s.drops)
  const upsertDrop = useStudio((s) => s.upsertDrop)
  const removeDrop = useStudio((s) => s.removeDrop)
  const dropMeta = useGrowth((s) => s.dropMeta)
  const setDropMeta = useGrowth((s) => s.setDropMeta)
  const removeDropMeta = useGrowth((s) => s.removeDropMeta)
  const brand = brandById.get(brandId)!
  const zone = brandZone(brand)
  const anchor = getDemoAnchor()
  const [tab, setTab] = useState<Tab>("all")
  const [sort, setSort] = useState<Sort>("status")
  const [confirm, setConfirm] = useState<Row | null>(null)
  // The dialog keeps the last drop while it animates closed.
  const [lastConfirm, setLastConfirm] = useState<Row | null>(null)
  if (confirm && confirm !== lastConfirm) setLastConfirm(confirm)
  const asked = confirm ?? lastConfirm
  // Opened from a row menu: focus returns to the drop's link, or to the list once it's removed.
  const focus = useFocusReturn(() => (asked ? document.querySelector<HTMLElement>(`a[href="/studio/drops/${asked.drop.id}"]`) : null) ?? document.getElementById("drop-list"))

  // Rows arrive sorted by the phone sort menu (live and next up first by default); the column headers re-sort on wider screens.
  const rows: Row[] = (() => {
    const order: Record<StudioDropStatus, number> = { live: 0, scheduled: 1, draft: 2, "sold-out": 3, ended: 3 }
    return drops
      .map((drop) => {
        const status = studioDropStatus(drop, dropMeta[drop.id], now, anchor)
        const { release, end } = dropWindow(drop, anchor)
        return { drop, status, release, end, notify: notifyCount(drop, status, brand.followers), sold: dropUnitsSold(drop), revenue: dropRevenue(drop, brand.currency) }
      })
      .sort((a, b) =>
        sort === "release" ? b.release - a.release : sort === "notify" ? b.notify - a.notify : sort === "name" ? a.drop.name.localeCompare(b.drop.name) : order[a.status] - order[b.status] || (order[a.status] === 3 ? b.release - a.release : a.release - b.release),
      )
  })()

  const counts = {
    all: rows.length,
    scheduled: rows.filter((r) => r.status === "scheduled").length,
    live: rows.filter((r) => r.status === "live").length,
    drafts: rows.filter((r) => r.status === "draft").length,
    past: rows.filter((r) => r.status === "sold-out" || r.status === "ended").length,
  }
  const visible = rows.filter((r) =>
    tab === "all" ? true : tab === "scheduled" ? r.status === "scheduled" : tab === "live" ? r.status === "live" : tab === "drafts" ? r.status === "draft" : r.status === "sold-out" || r.status === "ended",
  )

  const upcomingNotify = rows.filter((r) => r.status === "scheduled" || r.status === "live").reduce((s, r) => s + r.notify, 0)
  const released = rows.filter((r) => r.status === "live" || r.status === "sold-out" || r.status === "ended")
  const unitsSold = released.reduce((s, r) => s + r.sold, 0)
  const unitsReleased = released.reduce((s, r) => s + r.drop.totalUnits, 0)
  const nextUp = rows.filter((r) => r.status === "scheduled").sort((a, b) => a.release - b.release)[0]

  function duplicate(row: Row) {
    const id = localId("d_local_")
    const copy: Drop = { ...row.drop, id, slug: `${row.drop.slug}-copy-${id.slice(-4)}`, name: `${row.drop.name} (copy)`, unitsLeft: row.drop.totalUnits, releaseOffsetHours: (now - anchor) / 3_600_000 + 7 * 24, sponsored: false }
    upsertDrop(copy)
    setDropMeta(id, { draft: true, timeZone: zone.tz, updatedAt: new Date(now).toISOString() })
    toast.success("Draft created", { description: `${copy.name} is ready to edit.` })
    router.push(`/studio/drops/${id}`)
  }

  // The row leaving the list is the confirmation.
  function remove(row: Row) {
    removeDrop(row.drop.id)
    removeDropMeta(row.drop.id)
    setConfirm(null)
  }

  const editable = (r: Row) => r.status === "draft" || r.status === "scheduled"
  const columns: Column<Row>[] = [
    {
      key: "drop",
      header: "Drop",
      sortValue: (r) => r.drop.name,
      cell: (r) => (
        <Link href={`/studio/drops/${r.drop.id}`} className={cn(phoneCellWide, "group flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet")}>
          <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface">
            <Image src={r.drop.image.src} alt="" fill sizes="44px" className="object-cover" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink group-hover:text-violet md:max-w-[16rem]">{r.drop.name}</span>
            <span className="block truncate text-xs text-ink-3">{dropAccessLabel[r.drop.access]}, limit {r.drop.limitPerCustomer}</span>
            {/* Phones: status, timing and sales fold into the first cell. */}
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
              <StatusBadge tone={dropStatusMeta[r.status].tone}>{dropStatusMeta[r.status].label}</StatusBadge>
              <span className="text-xs text-ink-2 tabular">{r.status === "draft" ? "Not scheduled" : r.status === "live" ? `Closes ${relativeTime(r.end, now)}` : r.status === "scheduled" ? `Opens ${relativeTime(r.release, now)}` : `${formatPercent(r.drop.totalUnits ? r.sold / r.drop.totalUnits : 0, 0)} sold`}</span>
            </span>
          </span>
        </Link>
      ),
    },
    { key: "status", header: "Status", sortValue: (r) => dropStatusMeta[r.status].label, hideBelow: "md", cell: (r) => <StatusBadge tone={dropStatusMeta[r.status].tone}>{dropStatusMeta[r.status].label}</StatusBadge> },
    {
      key: "release",
      header: `Release (${zoneAbbr(zone.tz, now)})`,
      sortValue: (r) => r.release,
      hideBelow: "md",
      cell: (r) => (
        <>
          <span className="block whitespace-nowrap text-ink tabular">{formatInZone(r.release, zone.tz)}</span>
          <span className="block text-xs text-ink-3">{r.status === "draft" ? "Draft, not scheduled" : r.status === "live" ? `Closes ${relativeTime(r.end, now)}` : relativeTime(r.release, now)}</span>
        </>
      ),
    },
    { key: "units", header: "Units left", sortValue: (r) => r.drop.unitsLeft, hideBelow: "lg", cell: (r) => <UnitsLeft drop={r.drop} /> },
    { key: "notify", header: "Notify me", align: "right", sortValue: (r) => r.notify, hideBelow: "lg", cell: (r) => (r.notify === 0 ? <span className="text-ink-3">None yet</span> : <span className="text-ink">{formatNumber(r.notify)}</span>) },
    { key: "performance", header: "Performance", sortValue: (r) => r.sold, hideBelow: "md", cell: (r) => <Performance row={r} now={now} currency={brand.currency} /> },
  ]
  const rowActions: RowAction<Row>[] = [
    { label: "Edit drop", icon: Pencil, onSelect: (r) => router.push(`/studio/drops/${r.drop.id}`) },
    { label: "Duplicate as draft", icon: Copy, onSelect: duplicate },
    { label: "Delete or cancel", icon: Trash2, onSelect: setConfirm, destructive: true, disabled: (r) => !editable(r), separatorBefore: true },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Drops"
        description={dropsDescription}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/drops/new"><CalendarPlus /> Schedule a drop</Link>
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <p className="text-xs text-ink-3">{CATALOGUE_NOTE}</p>
        </div>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Plan your first drop"
          body="Schedule a limited release with a countdown and a Notify me button."
          action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new"><CalendarPlus /> Schedule a drop</Link></Button>}
        />
      ) : (
        <>
          <section aria-label="Drop summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Scheduled" value={counts.scheduled} format={(n) => formatNumber(Math.round(n))} hint={nextUp ? `Next ${relativeTime(nextUp.release, now)}` : "None coming up"} />
            <MetricTile label="Live now" value={counts.live} format={(n) => formatNumber(Math.round(n))} hint={counts.live ? "Selling now" : "None live"} />
            <MetricTile label="Notify-me sign-ups" value={upcomingNotify} format={(n) => formatNumber(Math.round(n))} hint="Upcoming and live sample drops" />
            <MetricTile label="Units sold" value={unitsSold} format={(n) => formatNumber(Math.round(n))} hint={unitsReleased ? `${formatPercent(unitsSold / unitsReleased, 0)} sell-through` : "No releases yet"} />
          </section>

          <div className="grid gap-4">
            <StatusTabs
              id="drop-status"
              label="Drop status"
              value={tab}
              onChange={setTab}
              controls="drop-list"
              tabs={[
                { value: "all", label: "All", count: counts.all },
                { value: "scheduled", label: "Scheduled", count: counts.scheduled },
                { value: "live", label: "Live", count: counts.live },
                { value: "drafts", label: "Drafts", count: counts.drafts },
                { value: "past", label: "Past", count: counts.past },
              ]}
            />

            <section id="drop-list" aria-label="Drops" tabIndex={-1} className="grid gap-3 outline-none">
              {/* Phones only: the table shows just its first column there, so sorting moves here. */}
              <div className="flex justify-end md:hidden">
                <PhoneSort value={sort} onChange={setSort} options={sortOptions} />
              </div>
              <DataTable
                label="Drops"
                rows={visible}
                columns={columns}
                getId={(r) => r.drop.id}
                rowActions={rowActions}
                minWidth={300}
                empty={{
                  title: tab === "drafts" ? "No drafts" : tab === "live" ? "Nothing is live right now" : tab === "past" ? "No past drops yet" : "Nothing scheduled",
                  body: tab === "past" ? "Drops show here once they sell out or close." : "Drops you save or schedule show here.",
                  action: <Button variant="secondary" size="sm" onClick={() => setTab("all")}>Show all drops</Button>,
                }}
              />
            </section>
            <p className="text-xs text-ink-3">
              Times are in {zone.city} time ({zoneAbbr(zone.tz, now)}), your brand&apos;s time zone. Notify-me counts and revenue for the sample drops are sample data. Drops you create here have none until the catalogue backend is connected.
            </p>
          </div>
        </>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]" {...focus}>
          <DialogHeader>
            <DialogTitle>{asked?.status === "draft" ? "Delete this draft?" : "Cancel this drop?"}</DialogTitle>
            <DialogDescription className="text-ink-2">
              {asked?.status === "draft"
                ? `${asked?.drop.name} will be removed. This can't be undone.`
                : `${asked?.drop.name} won't release and comes off your schedule. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive-solid" onClick={() => confirm && remove(confirm)}>
              <Trash2 /> {asked?.status === "draft" ? "Delete draft" : "Cancel drop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UnitsLeft({ drop }: { drop: Drop }) {
  const ratio = drop.totalUnits ? drop.unitsLeft / drop.totalUnits : 0
  return (
    <div className="w-28">
      <p className="text-ink tabular">
        {formatNumber(drop.unitsLeft)} <span className="text-ink-3">of {formatNumber(drop.totalUnits)}</span>
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className={cn("h-full rounded-full", ratio === 0 ? "bg-ink-3" : "bg-violet")} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  )
}

function Performance({ row, now, currency }: { row: Row; now: number; currency: CurrencyCode }) {
  if (row.status === "draft") return <span className="text-xs whitespace-nowrap text-ink-3">Not scheduled</span>
  if (row.status === "scheduled") return <span className="block text-sm whitespace-nowrap text-ink-2">Opens {relativeTime(row.release, now)}</span>
  const pct = row.drop.totalUnits ? row.sold / row.drop.totalUnits : 0
  return (
    <span className="block whitespace-nowrap">
      <span className="block text-sm text-ink tabular">{formatPercent(pct, 0)} sold</span>
      <span className="block text-xs text-ink-3 tabular">{formatMoney(row.revenue, currency, { compact: true })} revenue</span>
    </span>
  )
}

