"use client"

import { useMemo, useState } from "react"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { campaignStatusMeta } from "@/components/dashboard/status-badge"
import { campaignTypes, type CampaignStatus } from "@/lib/data/ads"
import { useAdmin } from "@/lib/stores/admin"
import { int, usd } from "../format"
import { SectionTabs } from "../section-tabs"
import { FilterSelect, SearchField } from "../table"
import { CampaignsTable, filterCampaigns, statusOrder } from "./campaigns-table"
import { PlacementsPanel, SlotLegend } from "./placements-panel"
import { placementOrder } from "./placements"
import { PricingPanel } from "./pricing-panel"
import { ReviewQueue } from "./review-queue"

type Tab = "campaigns" | "placements" | "pricing"

export function AdvertisingView() {
  const campaigns = useAdmin((s) => s.campaigns)
  const [tab, setTab] = useState<Tab>("campaigns")
  const [status, setStatus] = useState<string>("all")
  const [query, setQuery] = useState("")

  const inReview = campaigns.filter((c) => c.status === "in_review").length
  const live = campaigns.filter((c) => c.status === "active")
  const booked = campaigns.filter((c) => ["active", "scheduled", "completed"].includes(c.status)).reduce((s, c) => s + c.budget, 0)
  const occupied = placementOrder.filter((p) => live.some((c) => c.placements.includes(p))).length
  const rows = useMemo(() => filterCampaigns(campaigns, status, query), [campaigns, status, query])

  const counts = useMemo(() => {
    const m = new Map<CampaignStatus, number>()
    for (const c of campaigns) m.set(c.status, (m.get(c.status) ?? 0) + 1)
    return m
  }, [campaigns])

  return (
    <div className="grid gap-5">
      <PageHeader title="Advertising" description="Review sponsored campaigns before they run, see who holds each placement and set the fixed prices brands pay.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Advertising figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Waiting for review" value={inReview} format={int} highlight={inReview > 0} hint="decide within 1 business day" />
        <MetricTile density="dense" label="Live campaigns" value={live.length} format={int} hint={`from ${new Set(live.map((c) => c.brandId)).size} brands`} />
        <MetricTile density="dense" label="Booked ad revenue" value={booked} format={usd} hint="live, scheduled and completed" />
        <MetricTile density="dense" label="Placements in use" value={occupied} format={(n) => `${int(n)} of ${placementOrder.length}`} hint="with a live campaign" />
      </section>

      <ReviewQueue />

      <section aria-labelledby="ads-sections-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <h2 id="ads-sections-title" className="sr-only">Campaigns, placements and pricing</h2>
        <SectionTabs
          label="Advertising sections"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "campaigns", label: "All campaigns", short: "Campaigns", count: campaigns.length },
            { value: "placements", label: "Placements", count: placementOrder.length },
            { value: "pricing", label: "Pricing", count: Object.keys(campaignTypes).length },
          ]}
          toolbar={
            tab === "campaigns" ? (
              <>
                <SearchField value={query} onChange={setQuery} label="Search campaigns" placeholder="Search campaigns" className="md:w-48 xl:w-52" />
                <FilterSelect
                  value={status}
                  onChange={setStatus}
                  label="Filter by status"
                  className="md:w-[164px]"
                  options={[{ value: "all", label: `All statuses (${campaigns.length})` }, ...statusOrder.filter((s) => counts.get(s)).map((s) => ({ value: s, label: `${campaignStatusMeta[s].label} (${counts.get(s)})` }))]}
                />
              </>
            ) : tab === "placements" ? (
              <SlotLegend />
            ) : null
          }
        >
          {tab === "campaigns" ? (
            <CampaignsTable
              rows={rows}
              filtered={status !== "all" || !!query.trim()}
              onClear={() => {
                setStatus("all")
                setQuery("")
              }}
            />
          ) : tab === "placements" ? (
            <PlacementsPanel />
          ) : (
            <PricingPanel />
          )}
        </SectionTabs>
      </section>
    </div>
  )
}
