"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon, ArrowUpIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { Filters } from "@/components/admin/marketplace/filters"
import { campaignStatusMeta, StatusBadge } from "@/components/dashboard/status-badge"
import { brandById } from "@/lib/data"
import { campaignTypes, type Campaign, type CampaignStatus } from "@/lib/data/ads"
import { formatPercent } from "@/lib/money"
import { campaignWindow, formatRange, int, usd } from "../format"
import { resolveCreative } from "./creative"
import { useRequested } from "./decisions"
import { placementRules } from "./placements"

export const statusOrder: CampaignStatus[] = ["in_review", "active", "scheduled", "paused", "completed", "rejected", "draft"]
const ALL = "all"

/** Every campaign on the platform with its slot, dates, spend and delivery. */
export function CampaignsTable({ campaigns, ready }: { campaigns: Campaign[]; ready: boolean }) {
  const router = useRouter()
  const [status, setStatus] = useState<string>(ALL)
  const requested = useRequested(campaigns)

  const sorted = useMemo(() => [...campaigns].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.startDaysFromToday - b.startDaysFromToday), [campaigns])
  const rows = useMemo(() => (status === ALL ? sorted : sorted.filter((c) => c.status === status)), [sorted, status])
  const counts = useMemo(() => {
    const m = new Map<CampaignStatus, number>()
    for (const c of campaigns) m.set(c.status, (m.get(c.status) ?? 0) + 1)
    return m
  }, [campaigns])

  /**
   * Campaigns are decided in the review queue above, where the creative and the checks are,
   * so a campaign in review links there instead of offering approve and reject in a row menu
   * that would be greyed out on every other row.
   */
  function review(c: Campaign) {
    const el = document.getElementById(`review-${c.id}`)
    if (!el) return
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
    el.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true })
  }

  const badge = (c: Campaign) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone={campaignStatusMeta[c.status].tone}>{requested.has(c.id) ? "Second approval" : campaignStatusMeta[c.status].label}</StatusBadge>
      {c.status === "in_review" ? (
        <Button size="sm" variant="secondary" className="h-10 sm:h-7 sm:px-2.5 sm:text-[12px]" onClick={() => review(c)} aria-label={`Review ${c.name} in the queue`}>
          <ArrowUpIcon aria-hidden /> Review
        </Button>
      ) : null}
    </span>
  )

  const columns: Column<Campaign>[] = [
    {
      key: "campaign",
      header: "Campaign",
      sortValue: (c) => c.name.toLowerCase(),
      cell: (c) => (
        <span className="block min-w-0 max-w-[55vw] sm:max-w-[240px]">
          <span className="block truncate font-medium text-ink">{c.name}</span>
          <span className="block truncate text-[11px] text-ink-3" title={c.rejectionReason}>
            {c.status === "rejected" && c.rejectionReason ? `Rejected: ${c.rejectionReason}` : brandById.get(c.brandId)?.name}
            {/* Phones fold the budget in here; its own column starts at the small breakpoint. */}
            <span className="sm:hidden">, {usd(c.budget)}</span>
          </span>
          <span className="mt-1.5 block sm:hidden">{badge(c)}</span>
        </span>
      ),
    },
    {
      key: "type",
      header: "Type and placements",
      // The table sits beside the sidebar, so wide-only columns fold by the table's own width.
      hideBelowContainer: "5xl",
      sortValue: (c) => campaignTypes[c.type].name,
      cell: (c) => {
        const where = c.placements.map((p) => placementRules[p].name).join(", ")
        return (
          <span className="block min-w-0 max-w-[220px]">
            <span className="block truncate text-ink-2">{campaignTypes[c.type].name}</span>
            <span className="block truncate text-[11px] text-ink-3" title={where}>{where}</span>
          </span>
        )
      },
    },
    {
      key: "dates",
      header: "Dates",
      hideBelow: "md",
      sortValue: (c) => c.startDaysFromToday,
      cell: (c) => {
        const w = campaignWindow(c.startDaysFromToday, c.days)
        return <span className="whitespace-nowrap text-ink-2 tabular">{formatRange(w.start, w.end)}</span>
      },
    },
    { key: "budget", header: "Budget", align: "right", hideBelow: "sm", sortValue: (c) => c.budget, cell: (c) => <span className="text-ink">{usd(c.budget)}</span> },
    {
      key: "status",
      header: "Status",
      sortValue: (c) => statusOrder.indexOf(c.status),
      hideBelow: "sm",
      cell: (c) => badge(c),
    },
    {
      key: "delivery",
      header: "Delivery",
      align: "right",
      hideBelowContainer: "4xl",
      sortValue: (c) => c.results.impressions,
      cell: (c) =>
        c.results.impressions ? (
          <span className="block whitespace-nowrap">
            <span className="block text-ink-2">{int(c.results.impressions)} views</span>
            <span className="block text-[11px] text-ink-3">{formatPercent(c.results.clicks / c.results.impressions, 1)} click rate</span>
          </span>
        ) : (
          <span className="text-ink-3">None yet</span>
        ),
    },
  ]

  // Every campaign resolves to a marketplace page (its product, drop, collection or brand).
  const rowActions: RowAction<Campaign>[] = [
    { label: "Open what it promotes", icon: ArrowSquareOutIcon, onSelect: (c) => { const href = resolveCreative(c).href; if (href) router.push(href) }, disabled: (c) => !resolveCreative(c).href, disabledReason: () => "Its brand's page isn't in the marketplace." },
  ]

  return (
    <DataTable
      label="All campaigns"
      rows={ready ? rows : []}
      loading={!ready}
      columns={columns}
      getId={(c) => c.id}
      rowActions={rowActions}
      minWidth={0}
      density="dense"
      search={{ placeholder: "Search campaigns or brands", text: (c) => `${c.name} ${brandById.get(c.brandId)?.name ?? ""} ${campaignTypes[c.type].name}` }}
      toolbar={
        <Filters
          noun="campaigns"
          results={rows.length}
          onClear={() => setStatus(ALL)}
          filters={[
            {
              key: "status",
              label: "Status",
              value: status,
              onChange: setStatus,
              all: { value: ALL, label: `All statuses (${campaigns.length})` },
              options: statusOrder.filter((s) => counts.get(s)).map((s) => ({ value: s, label: `${campaignStatusMeta[s].label} (${counts.get(s)})` })),
              width: "w-[190px]",
            },
          ]}
        />
      }
      empty={{
        title: status === ALL ? "No campaigns yet" : `No ${campaignStatusMeta[status]?.label.toLowerCase() ?? ""} campaigns`,
        body: status === ALL ? "Campaigns appear here as soon as a brand books a placement." : "Try another status.",
        action: status === ALL ? undefined : <Button size="sm" variant="secondary" onClick={() => setStatus(ALL)}>Show every status</Button>,
      }}
    />
  )
}
