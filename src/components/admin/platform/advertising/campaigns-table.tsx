"use client"

import { useMemo } from "react"
import { MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { campaignStatusMeta, StatusBadge } from "@/components/dashboard/status-badge"
import { brandById } from "@/lib/data"
import { campaignTypes, type Campaign, type CampaignStatus } from "@/lib/data/ads"
import { formatPercent } from "@/lib/money"
import { campaignWindow, formatRange, int, usd } from "../format"
import { PlatformTable, type Column } from "../table"
import { placementRules } from "./placements"

export const statusOrder: CampaignStatus[] = ["in_review", "active", "scheduled", "paused", "completed", "rejected", "draft"]

export function filterCampaigns(campaigns: Campaign[], status: string, query: string) {
  const q = query.trim().toLowerCase()
  return campaigns
    .filter((c) => status === "all" || c.status === status)
    .filter((c) => !q || [c.name, brandById.get(c.brandId)?.name ?? "", campaignTypes[c.type].name].join(" ").toLowerCase().includes(q))
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.startDaysFromToday - b.startDaysFromToday)
}

/** Every campaign on the platform with its slot, dates, spend and delivery. Read-only. */
export function CampaignsTable({ rows, filtered, onClear }: { rows: Campaign[]; filtered: boolean; onClear: () => void }) {
  const columns: Column<Campaign>[] = useMemo(
    () => [
      {
        key: "campaign",
        header: "Campaign",
        cell: (c) => (
          <span className="block min-w-0 max-w-[280px]">
            <span className="block truncate font-medium text-ink">{c.name}</span>
            <span className="block truncate text-[11px] text-ink-3" title={c.rejectionReason}>
              {c.status === "rejected" && c.rejectionReason ? `Rejected: ${c.rejectionReason}` : brandById.get(c.brandId)?.name}
            </span>
          </span>
        ),
      },
      { key: "type", header: "Type", cell: (c) => <span className="whitespace-nowrap text-ink-2">{campaignTypes[c.type].name}</span> },
      {
        key: "placements",
        header: "Placements",
        cell: (c) => (
          <span className="block max-w-[220px] truncate text-ink-2" title={c.placements.map((p) => placementRules[p].name).join(", ")}>
            {c.placements.map((p) => placementRules[p].name).join(", ")}
          </span>
        ),
      },
      {
        key: "dates",
        header: "Dates",
        cell: (c) => {
          const w = campaignWindow(c.startDaysFromToday, c.days)
          return <span className="whitespace-nowrap text-ink-2 tabular">{formatRange(w.start, w.end)}</span>
        },
      },
      { key: "budget", header: "Budget", align: "right", cell: (c) => <span className="text-ink">{usd(c.budget)}</span> },
      { key: "status", header: "Status", cell: (c) => <StatusBadge tone={campaignStatusMeta[c.status].tone}>{campaignStatusMeta[c.status].label}</StatusBadge> },
      { key: "impressions", header: "Impressions", align: "right", cell: (c) => <span className="text-ink-2">{c.results.impressions ? int(c.results.impressions) : "—"}</span> },
      { key: "ctr", header: "Click rate", align: "right", cell: (c) => <span className="text-ink-2">{c.results.impressions ? formatPercent(c.results.clicks / c.results.impressions, 1) : "—"}</span> },
    ],
    [],
  )

  if (!rows.length) {
    return (
      <div className="p-4">
        <EmptyState
          icon={SearchX}
          title={filtered ? "No campaigns match" : "No campaigns yet"}
          body={filtered ? "Try another status, or search by campaign or brand name." : "Campaigns appear here as soon as a brand books a placement."}
          action={filtered ? <Button size="sm" variant="secondary" onClick={onClear}>Clear filters</Button> : undefined}
        />
      </div>
    )
  }

  return (
    <PlatformTable
      rows={rows}
      columns={columns}
      rowKey={(c) => c.id}
      caption="All campaigns"
      minWidth={980}
      mobileRow={(c) => {
        const w = campaignWindow(c.startDaysFromToday, c.days)
        return {
          title: c.name,
          meta: `${brandById.get(c.brandId)?.name ?? "Unknown brand"}, ${formatRange(w.start, w.end)}`,
          trail: (
            <>
              <StatusBadge tone={campaignStatusMeta[c.status].tone}>{campaignStatusMeta[c.status].label}</StatusBadge>
              <span className="text-[11px] text-ink-2 tabular">{usd(c.budget)}</span>
            </>
          ),
          below: c.status === "rejected" && c.rejectionReason ? <p className="text-[11px] text-ink-3">Rejected: {c.rejectionReason}</p> : undefined,
        }
      }}
    />
  )
}
