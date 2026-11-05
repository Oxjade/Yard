"use client"

import { useMemo, useState } from "react"
import { SealCheckIcon as BadgeCheck, MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { BrandDetail } from "./brand-detail"
import { DataTable, Initials, SearchField, type Column } from "./data-table"
import { categoryName, countryName, daysSince, formatDate, relDays } from "./format"
import { kycMeta, riskMeta } from "./meta"
import { QueueTabs } from "./queue-tabs"
import { useUrlRecord } from "./use-url-record"

const TABS: { value: BrandReviewStatus; label: string; empty: string; emptyBody: string }[] = [
  { value: "pending_review", label: "Pending review", empty: "The review queue is clear", emptyBody: "New brand applications land here as soon as they're submitted." },
  { value: "verified", label: "Verified", empty: "No verified brands", emptyBody: "Brands appear here once they're approved." },
  { value: "restricted", label: "Restricted", empty: "No restricted brands", emptyBody: "Brands with hidden listings or held payouts appear here." },
  { value: "suspended", label: "Suspended", empty: "No suspended brands", emptyBody: "Suspended brands appear here until they're reinstated." },
]

const n = (v: number) => formatNumber(Math.round(v))

function matches(a: BrandApplication, q: string) {
  if (!q) return true
  return [a.brandName, a.handle, countryName(a.country), a.category].join(" ").toLowerCase().includes(q)
}

export function BrandsView() {
  const applications = useAdmin((s) => s.applications)
  const [tab, setTab] = useState<BrandReviewStatus>("pending_review")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const q = query.trim().toLowerCase()
  const clearUrl = useUrlRecord("review", (id) => {
    const app = applications.find((a) => a.id === id)
    if (!app) return
    setTab(app.status)
    setSelected(app.id)
    setOpen(true)
  })

  const counts = useMemo(() => {
    const c: Record<BrandReviewStatus, number> = { pending_review: 0, verified: 0, restricted: 0, suspended: 0 }
    for (const a of applications) c[a.status]++
    return c
  }, [applications])

  const rows = useMemo(
    () =>
      applications
        .filter((a) => a.status === tab && matches(a, q))
        // The review queue is first in, first out; the other lists show the newest first.
        .sort((a, b) => (tab === "pending_review" ? a.submittedAt.localeCompare(b.submittedAt) : b.submittedAt.localeCompare(a.submittedAt))),
    [applications, tab, q],
  )

  const elsewhere = useMemo(() => {
    if (!q || rows.length) return null
    const hit = TABS.find((t) => t.value !== tab && applications.some((a) => a.status === t.value && matches(a, q)))
    return hit ? { tab: hit, count: applications.filter((a) => a.status === hit.value && matches(a, q)).length } : null
  }, [applications, q, rows.length, tab])

  const pending = applications.filter((a) => a.status === "pending_review")
  const oldest = pending.reduce((d, a) => Math.max(d, daysSince(a.submittedAt)), 0)
  const kycIncomplete = pending.filter((a) => a.kyc !== "verified").length
  const highRisk = applications.filter((a) => a.risk === "high" && a.status !== "suspended").length

  const columns: Column<BrandApplication>[] = [
    {
      key: "brand",
      header: "Brand",
      primary: true,
      cell: (a) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Initials name={a.brandName} />
          <span className="truncate font-medium text-ink">{a.brandName}</span>
        </span>
      ),
    },
    { key: "handle", header: "Handle", cell: (a) => <span className="whitespace-nowrap text-ink-2">@{a.handle}</span> },
    { key: "country", header: "Country", cell: (a) => <span className="whitespace-nowrap text-ink-2">{countryName(a.country)}</span> },
    { key: "category", header: "Category", cell: (a) => <span className="whitespace-nowrap text-ink-2">{categoryName(a.category)}</span> },
    { key: "submitted", header: "Submitted", cell: (a) => <time dateTime={a.submittedAt} title={formatDate(a.submittedAt)} className="whitespace-nowrap text-ink-2">{relDays(a.submittedAt)}</time> },
    { key: "kyc", header: "KYC", cell: (a) => <StatusBadge tone={kycMeta[a.kyc].tone}>{kycMeta[a.kyc].label}</StatusBadge> },
    { key: "risk", header: "Risk", cell: (a) => <StatusBadge tone={riskMeta[a.risk].tone}>{riskMeta[a.risk].label}</StatusBadge> },
    { key: "products", header: "Products", align: "right", cell: (a) => <span className="text-ink">{a.products}</span> },
  ]

  const current = TABS.find((t) => t.value === tab)!

  return (
    <div className="grid gap-5">
      <PageHeader title="Brands" description="Review new applications, check verification and act on brands that break marketplace rules.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Review figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Awaiting review" value={counts.pending_review} format={n} highlight={counts.pending_review > 0} hint="first in, first out" />
        <MetricTile density="dense" label="Oldest application" value={oldest} format={(v) => `${n(v)} ${Math.round(v) === 1 ? "day" : "days"}`} hint="target: 2 days" />
        <MetricTile density="dense" label="KYC incomplete" value={kycIncomplete} format={n} hint="in the review queue" />
        <MetricTile density="dense" label="High risk, not suspended" value={highRisk} format={n} highlight={highRisk > 0} />
      </section>

      <section aria-labelledby="brands-queue-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <h2 id="brands-queue-title" className="sr-only">Brand review</h2>
        <QueueTabs
          label="Brand status"
          value={tab}
          onValueChange={setTab}
          tabs={TABS.map((t) => ({ value: t.value, label: t.label, short: t.value === "pending_review" ? "Pending" : undefined, count: counts[t.value], urgent: t.value === "pending_review" }))}
          toolbar={<SearchField value={query} onChange={setQuery} label="Search brands" placeholder="Search brands, handles, countries" />}
        >
          {rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(a) => a.id}
              onOpen={(a) => {
                setSelected(a.id)
                setOpen(true)
              }}
              openLabel={(a) => `Open ${a.brandName}`}
              selectedKey={open ? selected : null}
              caption={`${current.label} brands`}
              mobileRow={(a) => ({
                lead: <Initials name={a.brandName} />,
                title: a.brandName,
                meta: `${countryName(a.country)}, ${relDays(a.submittedAt).toLowerCase()}`,
                trail: (
                  <>
                    <StatusBadge tone={riskMeta[a.risk].tone}>{riskMeta[a.risk].label} risk</StatusBadge>
                    <span className="text-[11px] text-ink-3">KYC {kycMeta[a.kyc].label.toLowerCase()}</span>
                  </>
                ),
              })}
            />
          ) : q ? (
            <EmptyState
              icon={SearchX}
              className="m-4"
              title={`No ${current.label.toLowerCase()} brands match “${query.trim()}”`}
              body={elsewhere ? `${elsewhere.count} ${elsewhere.count === 1 ? "brand matches" : "brands match"} in ${elsewhere.tab.label.toLowerCase()}.` : "Check the spelling, or search by handle or country."}
              action={
                elsewhere ? (
                  <Button size="sm" variant="secondary" onClick={() => setTab(elsewhere.tab.value)}>Show {elsewhere.tab.label.toLowerCase()}</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setQuery("")}>Clear search</Button>
                )
              }
            />
          ) : (
            <EmptyState icon={BadgeCheck} className="m-4" title={current.empty} body={current.emptyBody} />
          )}
        </QueueTabs>
      </section>

      <BrandDetail
        id={selected}
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) clearUrl()
        }}
      />
    </div>
  )
}

