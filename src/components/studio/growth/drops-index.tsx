"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock, CalendarPlus, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
import { ListSkeleton } from "./form"
import { useGrowth, useGrowthReady } from "./store"
import { brandZone, dropRevenue, localId, dropStatusMeta, dropUnitsSold, formatInZone, notifyCount, relativeTime, studioDropStatus, zoneAbbr, type StudioDropStatus } from "./utils"

type Tab = "all" | "scheduled" | "live" | "drafts" | "past"

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
  const ready = useGrowthReady()
  const now = useNow(30_000)
  if (!ready || now === null) return <ListSkeleton />
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
  const [confirm, setConfirm] = useState<Row | null>(null)

  const rows: Row[] = (() => {
    const order: Record<StudioDropStatus, number> = { live: 0, scheduled: 1, draft: 2, "sold-out": 3, ended: 3 }
    return drops
      .map((drop) => {
        const status = studioDropStatus(drop, dropMeta[drop.id], now, anchor)
        const { release, end } = dropWindow(drop, anchor)
        return { drop, status, release, end, notify: notifyCount(drop, status, brand.followers), sold: dropUnitsSold(drop), revenue: dropRevenue(drop, brand.currency) }
      })
      .sort((a, b) => order[a.status] - order[b.status] || (order[a.status] === 3 ? b.release - a.release : a.release - b.release))
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
    toast("Draft created", { description: `${copy.name} is ready to edit.` })
    router.push(`/studio/drops/${id}`)
  }

  function remove(row: Row) {
    removeDrop(row.drop.id)
    removeDropMeta(row.drop.id)
    setConfirm(null)
    toast(row.status === "draft" ? "Draft deleted" : "Drop cancelled", {
      description: row.status === "draft" ? `${row.drop.name} was removed.` : `${row.drop.name} won't release. Followers who asked for a reminder are told it's cancelled.`,
    })
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Drops"
        description="Limited releases with a countdown. Followers who tap Notify me hear the moment a drop goes live."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/drops/new"><CalendarPlus /> Schedule a drop</Link>
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Plan your first drop"
          body="Schedule a limited release with a countdown your followers get notified about."
          action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new"><CalendarPlus /> Schedule a drop</Link></Button>}
        />
      ) : (
        <>
          <section aria-label="Drop summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Scheduled" value={counts.scheduled} format={(n) => formatNumber(Math.round(n))} hint={nextUp ? `next ${relativeTime(nextUp.release, now)}` : "none coming up"} />
            <MetricTile label="Live now" value={counts.live} format={(n) => formatNumber(Math.round(n))} hint={counts.live ? "selling right now" : undefined} />
            <MetricTile label="Notify-me sign-ups" value={upcomingNotify} format={(n) => formatNumber(Math.round(n))} hint="upcoming and live drops" />
            <MetricTile label="Units sold" value={unitsSold} format={(n) => formatNumber(Math.round(n))} hint={unitsReleased ? `${formatPercent(unitsSold / unitsReleased, 0)} sell-through` : "no releases yet"} />
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

            <section id="drop-list" aria-label="Drops" className="overflow-hidden rounded-lg border border-line-soft bg-card">
              {visible.length === 0 ? (
                <div className="p-4 md:p-5">
                  <EmptyState
                    icon={CalendarClock}
                    title={tab === "drafts" ? "No drafts" : tab === "live" ? "Nothing is live right now" : tab === "past" ? "No past drops yet" : "Nothing scheduled"}
                    body={tab === "past" ? "Drops show here once they sell out or close." : "Drops you save or schedule show here."}
                    action={<Button variant="secondary" size="sm" onClick={() => setTab("all")}>Show all drops</Button>}
                  />
                </div>
              ) : (
                <>
                  {/* Phone: one card per drop */}
                  <ul className="divide-y divide-line-soft md:hidden">
                    {visible.map((row) => (
                      <li key={row.drop.id} className="flex gap-3 p-4">
                        <Link href={`/studio/drops/${row.drop.id}`} className="relative size-16 shrink-0 overflow-hidden rounded-md bg-surface">
                          <Image src={row.drop.image.src} alt="" fill sizes="64px" className="object-cover" />
                        </Link>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <Link href={`/studio/drops/${row.drop.id}`} className="min-w-0 text-sm font-medium text-ink">
                              <span className="line-clamp-2">{row.drop.name}</span>
                            </Link>
                            <RowMenu row={row} onDuplicate={duplicate} onDelete={setConfirm} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <StatusBadge tone={dropStatusMeta[row.status].tone}>{dropStatusMeta[row.status].label}</StatusBadge>
                            <span className="text-xs text-ink-2 tabular">{formatInZone(row.release, zone.tz)} {zoneAbbr(zone.tz, row.release)}</span>
                          </div>
                          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <dt className="text-ink-3">Units left</dt>
                              <dd className="mt-0.5 text-ink tabular">{formatNumber(row.drop.unitsLeft)}/{formatNumber(row.drop.totalUnits)}</dd>
                            </div>
                            <div>
                              <dt className="text-ink-3">Notify me</dt>
                              <dd className="mt-0.5 text-ink tabular">{row.status === "draft" ? "None yet" : formatNumber(row.notify)}</dd>
                            </div>
                            <div>
                              <dt className="text-ink-3">Performance</dt>
                              <dd className="mt-0.5"><Performance row={row} now={now} currency={brand.currency} compact /></dd>
                            </div>
                          </dl>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Tablet and up: the table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[920px] text-left text-sm">
                      <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Drop</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Release ({zoneAbbr(zone.tz, now)})</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Units left</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Notify me</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Performance</th>
                          <th scope="col" className="px-4 py-2.5 font-normal md:px-5"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {visible.map((row) => (
                          <tr key={row.drop.id} className="transition-colors hover:bg-white/[0.02]">
                            <td className="px-4 py-3 md:px-5">
                              <Link href={`/studio/drops/${row.drop.id}`} className="group flex items-center gap-3">
                                <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface">
                                  <Image src={row.drop.image.src} alt="" fill sizes="44px" className="object-cover" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-ink group-hover:text-violet">{row.drop.name}</span>
                                  <span className="block truncate text-xs text-ink-3">{dropAccessLabel[row.drop.access]}, limit {row.drop.limitPerCustomer}</span>
                                </span>
                              </Link>
                            </td>
                            <td className="px-3 py-3"><StatusBadge tone={dropStatusMeta[row.status].tone}>{dropStatusMeta[row.status].label}</StatusBadge></td>
                            <td className="px-3 py-3">
                              <span className="block whitespace-nowrap text-ink tabular">{formatInZone(row.release, zone.tz)}</span>
                              <span className="block text-xs text-ink-3">{row.status === "live" ? `closes ${relativeTime(row.end, now)}` : relativeTime(row.release, now)}</span>
                            </td>
                            <td className="px-3 py-3">
                              <UnitsLeft drop={row.drop} />
                            </td>
                            <td className="px-3 py-3 text-right text-ink tabular">{row.status === "draft" ? <span className="text-ink-3">None yet</span> : formatNumber(row.notify)}</td>
                            <td className="px-3 py-3"><Performance row={row} now={now} currency={brand.currency} /></td>
                            <td className="px-4 py-3 text-right md:px-5"><RowMenu row={row} onDuplicate={duplicate} onDelete={setConfirm} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <p className="text-xs text-ink-3">
              Times are in {zone.city} time ({zoneAbbr(zone.tz, now)}), your brand&apos;s time zone. Notify-me counts and revenue are sample data until the store is connected.
            </p>
          </div>
        </>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{confirm?.status === "draft" ? "Delete this draft?" : "Cancel this drop?"}</DialogTitle>
            <DialogDescription className="text-ink-2">
              {confirm?.status === "draft"
                ? `${confirm?.drop.name} will be removed. This can't be undone.`
                : `${confirm?.drop.name} won't release. ${confirm ? formatNumber(confirm.notify) : 0} people asked to be notified; they'll be told it's cancelled. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => confirm && remove(confirm)}>
              <Trash2 /> {confirm?.status === "draft" ? "Delete draft" : "Cancel drop"}
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

function Performance({ row, now, currency, compact }: { row: Row; now: number; currency: CurrencyCode; compact?: boolean }) {
  if (row.status === "draft") return <span className="text-xs text-ink-3">Not scheduled</span>
  if (row.status === "scheduled") {
    return (
      <span className={cn("block text-ink-2", compact ? "text-xs" : "text-sm")}>
        Opens {relativeTime(row.release, now)}
      </span>
    )
  }
  const pct = row.drop.totalUnits ? row.sold / row.drop.totalUnits : 0
  return (
    <span className="block">
      <span className={cn("block text-ink tabular", compact ? "text-xs" : "text-sm")}>{formatPercent(pct, 0)} sold</span>
      {!compact ? <span className="block text-xs text-ink-3 tabular">{formatMoney(row.revenue, currency, { compact: true })} revenue</span> : null}
    </span>
  )
}

function RowMenu({ row, onDuplicate, onDelete }: { row: Row; onDuplicate: (r: Row) => void; onDelete: (r: Row) => void }) {
  const editable = row.status === "draft" || row.status === "scheduled"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.drop.name}`} className="-my-1 shrink-0">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href={`/studio/drops/${row.drop.id}`}>
            <Pencil /> {editable ? "Edit drop" : "View drop"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDuplicate(row)}>
          <Copy /> Duplicate as draft
        </DropdownMenuItem>
        {editable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
              <Trash2 /> {row.status === "draft" ? "Delete draft" : "Cancel drop"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
