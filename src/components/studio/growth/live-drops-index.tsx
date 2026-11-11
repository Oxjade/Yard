"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { CalendarPlusIcon as CalendarPlus, DiceFiveIcon as Dices, ProhibitIcon as CancelIcon, ArrowCounterClockwiseIcon as RetryIcon, EyeIcon as ViewIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { ApiError, api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { dropImageSrc, dropPhaseAt, isApiImage, type StudioDropDto } from "@/lib/api/drops"
import { useApi } from "@/lib/api/use-api"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { useRouter } from "next/navigation"
import { dropsDescription } from "./copy"
import { ListSkeleton } from "./form"
import { loadStudioDrops, studioDropsKey } from "./live-drops"

type Tab = "all" | "scheduled" | "live" | "drafts" | "past"
type LiveRow = { drop: StudioDropDto; status: Tab; statusLabel: string; tone: "info" | "muted" | "success" | "attention" }
const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })

function dateLabel(value: string, hydrated: boolean) {
  return (hydrated ? localDate : utcDate).format(new Date(value))
}

/** The row's tab and label on this device's clock (the server's phase is only as fresh as the last fetch). */
function classify(drop: StudioDropDto, now: number | null): Omit<LiveRow, "drop"> {
  if (drop.status === "cancelled") return { status: "past", statusLabel: "Cancelled", tone: "muted" }
  if (drop.status === "draft") return { status: "drafts", statusLabel: "Draft", tone: "muted" }
  const phase = dropPhaseAt(drop, now)
  if (drop.status === "ended" || phase === "ended") return { status: "past", statusLabel: "Ended", tone: "muted" }
  if (phase === "live" || phase === "early_access" || phase === "entries_open") {
    return { status: "live", statusLabel: phase === "entries_open" ? "Entries open" : phase === "early_access" ? "Early access" : drop.access === "draw" ? (drop.drawnAt ? "Winners buying" : "Draw due") : "Live", tone: "info" }
  }
  return { status: "scheduled", statusLabel: "Scheduled", tone: "attention" }
}

/** Only drafts and scheduled drops that haven't opened can be edited. */
const editable = (row: LiveRow) => row.status === "drafts" || row.status === "scheduled"

export function LiveDropsIndex({ brandId, canManage }: { brandId: string; canManage: boolean }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const now = useNow(30_000)
  const [tab, setTab] = useState<Tab>("all")
  const [confirm, setConfirm] = useState<StudioDropDto | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  // Refreshed every minute, so entry counts, draws and status changes made elsewhere show up.
  const query = useApi(studioDropsKey(brandId), loadStudioDrops, { keepPrevious: false, refreshInterval: 60_000 })
  const rows = useMemo(() => (query.data ?? []).map((drop) => ({ drop, ...classify(drop, now) })), [query.data, now])
  const counts = {
    all: rows.length,
    scheduled: rows.filter((row) => row.status === "scheduled").length,
    live: rows.filter((row) => row.status === "live").length,
    drafts: rows.filter((row) => row.status === "drafts").length,
    past: rows.filter((row) => row.status === "past").length,
  }
  const visible = rows.filter((row) => tab === "all" || row.status === tab)
  const reminderCount = rows.reduce((total, row) => total + row.drop.reminders, 0)
  const drawEntries = rows.reduce((total, row) => total + (row.drop.access === "draw" ? row.drop.entries ?? 0 : 0), 0)

  if (query.isLoading && !query.data) return <ListSkeleton title="Drops" description={dropsDescription} />

  async function lifecycle(drop: StudioDropDto, action: "unschedule" | "cancel" | "draw") {
    setWorkingId(drop.id)
    try {
      if (action === "unschedule") {
        await api(`/api/drops/${encodeURIComponent(drop.id)}/schedule`, { method: "DELETE", body: { expectedVersion: drop.version } })
        toast.success("Drop moved to drafts", { description: drop.name })
      } else if (action === "cancel") {
        await api(`/api/drops/${encodeURIComponent(drop.id)}/cancel`, { body: { expectedVersion: drop.version } })
        toast.success(drop.status === "draft" ? "Draft discarded" : "Drop cancelled", { description: drop.name })
      } else {
        const result = await api<{ counts: { entries: number; won: number } }>(`/api/drops/${encodeURIComponent(drop.id)}/draw`, { method: "POST" })
        toast.success("Draw completed", { description: `${result.counts.won} winners from ${result.counts.entries} entries.` })
      }
      await query.revalidate()
    } catch (error) {
      toast.error(errorMessage(error))
      if (error instanceof ApiError && error.status === 409) void query.revalidate()
    } finally {
      setWorkingId(null)
      setConfirm(null)
    }
  }

  const columns: Column<LiveRow>[] = [
    {
      key: "drop",
      header: "Drop",
      sortValue: (row) => row.drop.name,
      cell: (row) => {
        const content = <span className="group flex min-w-0 items-center gap-3">
          <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface">
            <Image src={dropImageSrc(row.drop.image, "brand")} alt="" fill unoptimized={isApiImage(dropImageSrc(row.drop.image, "brand"))} sizes="44px" className="object-cover" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink group-hover:text-violet md:max-w-[18rem]">{row.drop.name}</span>
            <span className="block truncate text-xs text-ink-3">{row.drop.access === "draw" ? "Draw" : row.drop.access === "early_access" ? "Early access" : "First come"} · limit {row.drop.limitPerCustomer}</span>
          </span>
        </span>
        return canManage && editable(row) ? <Link href={`/studio/drops/${row.drop.id}`} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet">{content}</Link> : content
      },
    },
    { key: "status", header: "Status", sortValue: (row) => row.statusLabel, hideBelow: "md", cell: (row) => <StatusBadge tone={row.tone}>{row.statusLabel}</StatusBadge> },
    { key: "release", header: "Release", sortValue: (row) => Date.parse(row.drop.startsAt), hideBelow: "md", cell: (row) => <time dateTime={row.drop.startsAt} className="whitespace-nowrap text-ink tabular">{dateLabel(row.drop.startsAt, hydrated)}</time> },
    { key: "units", header: "Units", align: "right", sortValue: (row) => row.drop.totalUnits, hideBelow: "lg", cell: (row) => <span className="tabular text-ink">{row.drop.totalUnits.toLocaleString()}</span> },
    { key: "reminders", header: "Reminders", align: "right", sortValue: (row) => row.drop.reminders, hideBelow: "lg", cell: (row) => <span className="tabular text-ink">{row.drop.reminders.toLocaleString()}</span> },
    { key: "entries", header: "Draw entries", align: "right", sortValue: (row) => row.drop.entries ?? -1, hideBelow: "xl", cell: (row) => <span className="tabular text-ink">{row.drop.access === "draw" ? (row.drop.entries ?? 0).toLocaleString() : "—"}</span> },
  ]

  const rowActions: RowAction<LiveRow>[] = [
    { label: "Edit drop", icon: CalendarPlus, onSelect: (row) => router.push(`/studio/drops/${row.drop.id}`), hidden: (row) => !editable(row) },
    { label: "View public page", icon: ViewIcon, onSelect: (row) => router.push(`/drops/${row.drop.slug}`), hidden: (row) => row.status === "drafts" || row.drop.status === "cancelled" },
    { label: "Move to drafts", icon: RetryIcon, onSelect: (row) => void lifecycle(row.drop, "unschedule"), disabled: (row) => workingId === row.drop.id, hidden: (row) => row.status !== "scheduled" },
    {
      label: "Run draw",
      icon: Dices,
      onSelect: (row) => void lifecycle(row.drop, "draw"),
      disabled: (row) => workingId === row.drop.id || now === null || now < Date.parse(row.drop.entryClosesAt ?? row.drop.startsAt),
      disabledReason: (row) => now === null || now < Date.parse(row.drop.entryClosesAt ?? row.drop.startsAt) ? `Entries close ${dateLabel(row.drop.entryClosesAt ?? row.drop.startsAt, hydrated)}.` : undefined,
      hidden: (row) => row.drop.access !== "draw" || !!row.drop.drawnAt || row.drop.status === "cancelled" || row.drop.status === "ended",
    },
    { label: "Cancel drop", icon: CancelIcon, onSelect: (row) => setConfirm(row.drop), destructive: true, disabled: (row) => workingId === row.drop.id, hidden: (row) => !["scheduled", "live"].includes(row.status) },
    { label: "Discard draft", icon: CancelIcon, onSelect: (row) => setConfirm(row.drop), destructive: true, disabled: (row) => workingId === row.drop.id, hidden: (row) => row.status !== "drafts" },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Drops"
        description={dropsDescription}
        actions={canManage ? <Button asChild variant="primary" size="sm"><Link href="/studio/drops/new"><CalendarPlus /> Create drop</Link></Button> : undefined}
      >
        <p className="mt-3 text-xs text-ink-3">Live drops, reminders and draw entries from your brand account. Times are shown in this device&apos;s time zone.</p>
      </PageHeader>

      {query.error && !query.data ? (
        <div role="alert" className="grid max-w-xl gap-3 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base text-ink">Drops couldn&apos;t be loaded</h2>
          <p className="text-sm text-ink-2">{errorMessage(query.error)}</p>
          <Button variant="secondary" size="sm" className="w-fit" loading={query.isValidating} onClick={() => void query.revalidate()}><RetryIcon /> Try again</Button>
        </div>
      ) : (
        <>
          <section aria-label="Drop summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Scheduled" value={counts.scheduled} format={(value) => String(Math.round(value))} hint="Waiting to release" />
            <MetricTile label="Live and open" value={counts.live} format={(value) => String(Math.round(value))} hint="Including early access and draw entry" />
            <MetricTile label="Reminder sign-ups" value={reminderCount} format={(value) => String(Math.round(value))} hint="Across all drops" />
            <MetricTile label="Draw entries" value={drawEntries} format={(value) => String(Math.round(value))} hint="Across draw drops" />
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
            <section id="drop-list" aria-label="Drops" className="grid gap-3">
              <DataTable
                label="Drops"
                rows={visible}
                columns={columns}
                getId={(row) => row.drop.id}
                rowActions={canManage ? rowActions : undefined}
                loading={query.isLoading}
                error={query.error ? errorMessage(query.error) : null}
                onRetry={() => void query.revalidate()}
                initialSort={{ key: "release", dir: "asc" }}
                empty={{
                  title: tab === "drafts" ? "No drafts" : tab === "live" ? "Nothing is live right now" : tab === "past" ? "No past drops yet" : "No drops yet",
                  body: canManage ? "Create a draft from your published products, then schedule its release." : "Drops from this brand will appear here.",
                  action: canManage ? <Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new"><CalendarPlus /> Create drop</Link></Button> : undefined,
                }}
                minWidth={360}
              />
            </section>
          </div>
        </>
      )}

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{confirm?.status === "draft" ? "Discard this draft?" : "Cancel this drop?"}</DialogTitle>
            <DialogDescription className="text-ink-2">{confirm?.status === "draft" ? `${confirm.name} will move to Past as cancelled and can't be scheduled.` : `${confirm?.name} will stop accepting purchases or entries. Any open winner claims will be released.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>{confirm?.status === "draft" ? "Keep draft" : "Keep drop"}</Button>
            <Button variant="destructive-solid" loading={!!workingId} onClick={() => confirm && void lifecycle(confirm, "cancel")}><CancelIcon /> {confirm?.status === "draft" ? "Discard draft" : "Cancel drop"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {query.error && query.data ? <p role="status" className="text-xs text-ink-3">Showing the last loaded data. Refresh to retry the latest changes.</p> : null}
      {!canManage ? <p className="text-xs text-ink-3">Your Studio role can view drops but cannot manage them.</p> : null}
    </div>
  )
}