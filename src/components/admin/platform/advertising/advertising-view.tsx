"use client"

import { useId, useState } from "react"
import { CoinsIcon, LayoutIcon, MegaphoneIcon, PlayCircleIcon } from "@phosphor-icons/react"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { int, usdCompact } from "../format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { useAdminReady } from "../ready"
import { inPageTab, TabParam, writeTabParam } from "../tab-param"
import { CampaignsTable } from "./campaigns-table"
import { useAllCampaigns, useCampaignDecision } from "./decisions"
import { PlacementsPanel, SlotLegend } from "./placements-panel"
import { placementOrder } from "./placements"
import { PricingPanel } from "./pricing-panel"
import { DECIDE_WITHIN, ReviewQueue } from "./review-queue"

const TABS = ["campaigns", "placements", "pricing"] as const
type Tab = (typeof TABS)[number]

export function AdvertisingView() {
  // The review store holds every campaign, Studio submissions included (the Studio store puts them there).
  const ready = useAdminReady()
  const campaigns = useAllCampaigns()
  const { ask, dialog } = useCampaignDecision()
  const [tab, setTab] = useState<Tab>("campaigns")
  const tid = useId()

  const queue = campaigns.filter((c) => c.status === "in_review").sort((a, b) => a.startDaysFromToday - b.startDaysFromToday)
  const live = campaigns.filter((c) => c.status === "active")
  const booked = campaigns.filter((c) => ["active", "scheduled", "completed"].includes(c.status)).reduce((s, c) => s + c.budget, 0)
  const occupied = placementOrder.filter((p) => live.some((c) => c.placements.includes(p))).length

  function choose(v: Tab) {
    setTab(v)
    writeTabParam(v)
  }
  const open = (v: Tab) => ({ onClickCapture: inPageTab(choose, v, "ad-sections") })

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <TabParam values={TABS} onChange={setTab} />
      <AdminPageHead
        title="Advertising"
        description="Review sponsored campaigns before they run, see who holds each placement and set the fixed prices brands pay."
        note="Decisions and prices are recorded here and in the audit log. In this build the marketplace's sponsored slots read the sample campaign list, so a decision reaches shoppers once the ads backend is connected."
      />

      <StatRow label="Advertising figures">
        <RevealItem className="min-w-0">
          <StatCard surface="admin" variant={ready && queue.length ? "brand" : "default"} icon={MegaphoneIcon} label="In review" value={queue.length} format={int} hint={DECIDE_WITHIN} href="#review-queue" hrefLabel="Open the review queue" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0" {...open("campaigns")}>
          <StatCard surface="admin" icon={PlayCircleIcon} label="Live campaigns" value={live.length} format={int} hint={ready ? `From ${new Set(live.map((c) => c.brandId)).size} brands` : undefined} href="?tab=campaigns#ad-sections" hrefLabel="Open all campaigns" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0" {...open("placements")}>
          <StatCard surface="admin" icon={LayoutIcon} label="Placements in use" value={occupied} format={(n) => `${int(n)} of ${placementOrder.length}`} hint="With a live campaign" href="?tab=placements#ad-sections" hrefLabel="Open placements" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0" {...open("pricing")}>
          <StatCard surface="admin" icon={CoinsIcon} label="Booked ad revenue" value={booked} format={usdCompact} hint="Live, scheduled and completed" href="?tab=pricing#ad-sections" hrefLabel="Open the rate card" ready={ready} className="h-full" />
        </RevealItem>
      </StatRow>

      <ReviewQueue campaigns={campaigns} ready={ready} onDecide={ask} />

      <Panel
        id="ad-sections"
        title="Campaigns, placements and pricing"
        description={tab === "campaigns" ? "Every campaign on the platform, with its slot, dates, spend and delivery." : tab === "placements" ? "Where sponsored items may appear, how many per view, and who holds each slot now." : "The fixed price of each campaign type, and every change to it."}
        className="scroll-mt-24 rounded-[20px]"
        bodyClassName="px-0 pb-0 md:px-0 md:pb-0"
      >
        <div className="flex flex-col @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <PanelRail value={tab}>
            <Segmented
              label="Advertising sections"
              size="sm"
              value={tab}
              onChange={choose}
              loading={!ready}
              idBase={tid}
              panelId={`${tid}-panel`}
              options={[
                { value: "campaigns", label: "Campaigns" },
                { value: "placements", label: "Placements" },
                { value: "pricing", label: "Pricing" },
              ]}
            />
          </PanelRail>
          {tab === "placements" ? <SlotLegend className="px-4 pb-3 md:px-5" /> : null}
        </div>
        <div id={`${tid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(tid, tab)} className={tab === "campaigns" ? "px-4 pb-4 md:px-5 md:pb-5" : "border-t border-[var(--admin-hairline)]"}>
          {tab === "campaigns" ? <CampaignsTable campaigns={campaigns} ready={ready} /> : tab === "placements" ? <PlacementsPanel campaigns={campaigns} /> : <PricingPanel campaigns={campaigns} ready={ready} />}
        </div>
      </Panel>
      {dialog}
    </Reveal>
  )
}
