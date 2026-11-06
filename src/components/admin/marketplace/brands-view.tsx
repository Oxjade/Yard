"use client"

import { useId, useMemo } from "react"
import { ClockIcon, HourglassIcon, IdentificationCardIcon, ShieldWarningIcon, EyeIcon } from "@phosphor-icons/react"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { Initials } from "./bits"
import { BrandDetail } from "./brand-detail"
import { brandActions, brandAllowed, brandDecision, type BrandActionKey } from "./brand-actions"
import { useDecision } from "./decision"
import { categoryName, countryName, daysSince, formatDate, relDays } from "./format"
import { kycMeta, riskMeta } from "./meta"
import { AdminPageHead, PanelRail, StatRow } from "./page-head"
import { InPageLinks, useAdminReady, useSearchParam, writeParams, usePhone } from "./url-state"

const TABS: { value: BrandReviewStatus; label: string; empty: string; emptyBody: string }[] = [
  { value: "pending_review", label: "Pending review", empty: "The review queue is clear", emptyBody: "New brand applications land here as soon as they're submitted." },
  { value: "verified", label: "Verified", empty: "No verified brands", emptyBody: "Brands appear here once they're approved." },
  { value: "restricted", label: "Restricted", empty: "No restricted brands", emptyBody: "Brands with held-back listings or held payouts appear here." },
  { value: "suspended", label: "Suspended", empty: "No suspended brands", emptyBody: "Suspended brands stay here until they're reinstated." },
]
const isTab = (v: string | null): v is BrandReviewStatus => TABS.some((t) => t.value === v)

const n = (v: number) => formatNumber(Math.round(v))
const days = (v: number) => `${n(v)} ${Math.round(v) === 1 ? "day" : "days"}`

export function BrandsView() {
  const ready = useAdminReady()
  const phone = usePhone()
  const qid = useId()
  const applications = useAdmin((s) => s.applications)
  const linkedTab = useSearchParam("tab")
  const reviewId = useSearchParam("review")

  // The open record lives in the URL (?review=app_…), so the palette, the Overview and other
  // screens can link straight to it and a reload reopens it.
  const reviewing = reviewId ? applications.find((a) => a.id === reviewId) : undefined
  // A link to a record shows the tab it's in; otherwise the tab in the URL, else the queue.
  const tab: BrandReviewStatus = isTab(linkedTab) ? linkedTab : reviewing && !linkedTab ? reviewing.status : "pending_review"
  const { ask, dialog } = useDecision(() => document.getElementById(segmentedTabId(qid, tab)))

  const counts = useMemo(() => {
    const c: Record<BrandReviewStatus, number> = { pending_review: 0, verified: 0, restricted: 0, suspended: 0 }
    for (const a of applications) c[a.status]++
    return c
  }, [applications])

  const rows = useMemo(
    () =>
      applications
        .filter((a) => a.status === tab)
        // The review queue is first in, first out; the other lists show the newest first.
        .sort((a, b) => (tab === "pending_review" ? a.submittedAt.localeCompare(b.submittedAt) : b.submittedAt.localeCompare(a.submittedAt))),
    [applications, tab],
  )

  const pending = applications.filter((a) => a.status === "pending_review")
  const oldest = [...pending].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0]
  const kycPending = pending.filter((a) => a.kyc !== "verified").sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
  const kycIncomplete = kycPending.length
  // The KYC card opens the oldest application still missing KYC that the Oldest application
  // card doesn't already open, so the two cards never lead to the same record.
  const kycOldest = kycPending.find((a) => a.id !== oldest?.id) ?? kycPending[0]
  const kycBreakdown = Object.entries(
    kycPending.reduce<Record<string, number>>((m, a) => ({ ...m, [kycMeta[a.kyc].label.toLowerCase()]: (m[kycMeta[a.kyc].label.toLowerCase()] ?? 0) + 1 }), {}),
  )
    .map(([label, count]) => `${count} ${label}`)
    .join(", ")
  const risky = applications.filter((a) => a.risk === "high" && a.status !== "suspended")

  const open = (a: BrandApplication) => writeParams({ review: a.id })
  const decide = (key: BrandActionKey, list: BrandApplication[], announce = true) => {
    const d = brandDecision(key, list, { announce })
    if (d) ask(d)
  }

  const columns: Column<BrandApplication>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (a) => a.brandName.toLowerCase(),
      cell: (a) => (
        <button type="button" onClick={() => open(a)} className="group flex max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <Initials name={a.brandName} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink group-hover:text-violet">{a.brandName}</span>
            <span className="block truncate text-[11.5px] text-ink-3">
              <span className="sm:hidden">{riskMeta[a.risk].label} risk, KYC {kycMeta[a.kyc].label.toLowerCase()}</span>
              <span className="hidden sm:inline">@{a.handle}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "country", header: "Country", hideBelow: "md", sortValue: (a) => countryName(a.country), cell: (a) => <span className="whitespace-nowrap text-ink-2">{countryName(a.country)}</span> },
    { key: "category", header: "Category", hideBelow: "lg", cell: (a) => <span className="whitespace-nowrap text-ink-2">{categoryName(a.category)}</span> },
    { key: "submitted", header: "Submitted", hideBelow: "md", sortValue: (a) => a.submittedAt, cell: (a) => <time dateTime={a.submittedAt} title={formatDate(a.submittedAt)} className="whitespace-nowrap text-ink-2">{relDays(a.submittedAt)}</time> },
    { key: "kyc", header: "KYC", hideBelow: "sm", cell: (a) => <StatusBadge tone={kycMeta[a.kyc].tone}>{kycMeta[a.kyc].label}</StatusBadge> },
    { key: "risk", header: "Risk", hideBelow: "sm", sortValue: (a) => ["low", "medium", "high"].indexOf(a.risk), cell: (a) => <StatusBadge tone={riskMeta[a.risk].tone}>{riskMeta[a.risk].label}</StatusBadge> },
    { key: "products", header: "Products", align: "right", hideBelow: "lg", sortValue: (a) => a.products, cell: (a) => <span className="text-ink">{a.products}</span> },
  ]

  const allowedHere = brandAllowed[tab]
  const rowActions: RowAction<BrandApplication>[] = [
    { label: "Open review", icon: EyeIcon, onSelect: open },
    ...allowedHere.map((key, i) => ({ label: brandActions[key].label, icon: brandActions[key].icon, destructive: brandActions[key].destructive, separatorBefore: i === 0, onSelect: (a: BrandApplication) => decide(key, [a]) })),
  ]
  const bulkActions: BulkAction<BrandApplication>[] = allowedHere.map((key) => ({ label: brandActions[key].verb, destructive: brandActions[key].destructive, onSelect: (list) => decide(key, list) }))
  const current = TABS.find((t) => t.value === tab)!

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Brands"
        description="Review new applications, check verification and act on brands that break marketplace rules."
        note="Decisions are recorded here and in the audit log with your reason. The marketplace reads the sample catalogue in this build, so storefronts change once brand status comes from the backend."
      />

      <InPageLinks>
        <StatRow label="Review figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts.pending_review ? "brand" : "default"} icon={HourglassIcon} label="Awaiting review" value={counts.pending_review} format={n} hint="Worked first in, first out" href="/admin/brands?tab=pending_review#brand-review" hrefLabel="Show the review queue" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ClockIcon} label="Oldest application" value={oldest ? daysSince(oldest.submittedAt) : 0} format={days} hint={oldest ? `${oldest.brandName}, target 2 days` : "Nothing waiting"} href={oldest ? `/admin/brands?review=${oldest.id}` : "/admin/brands?tab=pending_review#brand-review"} hrefLabel={oldest ? `Open ${oldest.brandName}` : "Show the review queue"} ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={IdentificationCardIcon} label="KYC incomplete" value={kycIncomplete} format={n} hint={kycBreakdown || "Nothing waiting on KYC"} href={kycOldest ? `/admin/brands?review=${kycOldest.id}` : "/admin/brands?tab=pending_review#brand-review"} hrefLabel={kycOldest ? `Open ${kycOldest.brandName}, KYC ${kycMeta[kycOldest.kyc].label.toLowerCase()}` : "Show the review queue"} ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ShieldWarningIcon} label="High risk, live" value={risky.length} format={n} hint={risky.length === 1 ? `${risky[0].brandName}, not suspended` : "Not suspended"} href={risky.length === 1 ? `/admin/brands?review=${risky[0].id}` : "/admin/brands?tab=restricted#brand-review"} hrefLabel={risky.length === 1 ? `Open ${risky[0].brandName}` : "Show restricted brands"} ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="brand-review" title="Brand review" description="Open a brand for its verification checklist, notes and history. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Brand status"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t === "pending_review" ? null : t })}
            loading={!ready}
            idBase={qid}
            panelId={`${qid}-panel`}
            // Only the queue carries a count: the Segmented shows any count above zero in acid, which is for work waiting.
            options={TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === "pending_review" ? counts[t.value] : undefined }))}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          <DataTable
            key={tab}
            label={`${current.label} brands`}
            rows={rows}
            columns={columns}
            getId={(a) => a.id}
            loading={!ready}
            search={{ placeholder: "Search brands, handles or countries", text: (a) => [a.brandName, a.handle, countryName(a.country), categoryName(a.category)].join(" ") }}
            rowActions={rowActions}
            bulkActions={phone ? undefined : bulkActions}
            empty={{ title: current.empty, body: current.emptyBody }}
            initialPageSize={10}
            minWidth={300}
          />
        </div>
      </Panel>

      <BrandDetail
        id={reviewing?.id ?? null}
        open={!!reviewing}
        onDecide={(key, a) => decide(key, [a], false)}
        onOpenChange={(o) => {
          if (!o) writeParams({ review: null })
        }}
      />
      {dialog}
    </Reveal>
  )
}
