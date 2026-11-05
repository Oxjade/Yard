"use client"

import { useMemo, useState } from "react"
import { FlagIcon as Flag, MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { productById, products } from "@/lib/data"
import type { ModerationItem } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { DataTable, SearchField, Thumb, type Column } from "./data-table"
import { formatDateTime, relDays } from "./format"
import { ListingsTable, useRestrictedListings } from "./listings-table"
import { moderationReasonMeta } from "./meta"
import { ModerationDetail } from "./moderation-detail"
import { QueueTabs } from "./queue-tabs"
import { useUrlRecord } from "./use-url-record"

type Status = ModerationItem["status"]
type Tab = Status | "listings"

const STATUS_TABS: { value: Status; label: string; empty: string; emptyBody: string }[] = [
  { value: "open", label: "Open", empty: "Nothing to review", emptyBody: "New reports and automated flags land here." },
  { value: "escalated", label: "Escalated", empty: "Nothing escalated to legal", emptyBody: "Cases you escalate to legal wait here for a decision." },
  { value: "removed", label: "Removed", empty: "No removed listings", emptyBody: "Listings taken down after review are kept here. Reopen a case if a listing was removed in error." },
  { value: "dismissed", label: "Dismissed", empty: "No dismissed cases", emptyBody: "Reports closed with no action are kept here." },
]

const n = (v: number) => formatNumber(Math.round(v))

function matches(m: ModerationItem, q: string) {
  return !q || [m.title, m.brandName, m.reportedBy, moderationReasonMeta[m.reason].label].join(" ").toLowerCase().includes(q)
}

export function ModerationView() {
  const moderation = useAdmin((s) => s.moderation)
  const restricted = useRestrictedListings()
  const [tab, setTab] = useState<Tab>("open")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const q = query.trim().toLowerCase()
  const clearUrl = useUrlRecord("case", (id) => {
    const m = moderation.find((x) => x.id === id)
    if (!m) return
    setTab(m.status)
    setSelected(m.id)
    setOpen(true)
  })

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, escalated: 0, removed: 0, dismissed: 0 }
    for (const m of moderation) c[m.status]++
    return c
  }, [moderation])

  const rows = useMemo(
    () =>
      tab === "listings"
        ? []
        : moderation
            .filter((m) => m.status === tab && matches(m, q))
            // Live queues are worked oldest first; closed cases show the most recent first.
            .sort((a, b) => (tab === "open" || tab === "escalated" ? a.reportedAt.localeCompare(b.reportedAt) : b.reportedAt.localeCompare(a.reportedAt))),
    [moderation, tab, q],
  )

  const counterfeitOrIp = moderation.filter((m) => (m.reason === "counterfeit" || m.reason === "ip_complaint") && (m.status === "open" || m.status === "escalated")).length

  const columns: Column<ModerationItem>[] = [
    {
      key: "listing",
      header: "Listing",
      primary: true,
      cell: (m) => {
        const p = m.productId ? productById.get(m.productId) : undefined
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <Thumb src={p?.images[0]?.src} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{m.title}</span>
              <span className="block truncate text-[11px] text-ink-3">{p ? "In the catalogue" : "Not in the public catalogue"}</span>
            </span>
          </span>
        )
      },
    },
    { key: "brand", header: "Brand", cell: (m) => <span className="whitespace-nowrap text-ink-2">{m.brandName}</span> },
    { key: "reason", header: "Reason", cell: (m) => <StatusBadge tone={moderationReasonMeta[m.reason].tone}>{moderationReasonMeta[m.reason].label}</StatusBadge> },
    { key: "by", header: "Reported by", cell: (m) => <span className="whitespace-nowrap text-ink-2">{m.reportedBy}</span> },
    { key: "at", header: "Reported", cell: (m) => <time dateTime={m.reportedAt} title={formatDateTime(m.reportedAt)} className="whitespace-nowrap text-ink-2">{relDays(m.reportedAt)}</time> },
  ]

  const current = STATUS_TABS.find((t) => t.value === tab)

  return (
    <div className="grid gap-5">
      <PageHeader title="Moderation" description="Work through reports and automated flags, and restrict any listing on the marketplace.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Moderation figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Open cases" value={counts.open} format={n} highlight={counts.open > 0} hint="oldest first" />
        <MetricTile density="dense" label="Escalated to legal" value={counts.escalated} format={n} highlight={counts.escalated > 0} hint="waiting on a decision" />
        <MetricTile density="dense" label="Counterfeit or IP" value={counterfeitOrIp} format={n} hint="unresolved" />
        <MetricTile density="dense" label="Restricted listings" value={restricted.size} format={n} hint={`of ${n(products.length)} listings`} />
      </section>

      <section aria-labelledby="moderation-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <h2 id="moderation-title" className="sr-only">Moderation queue</h2>
        <QueueTabs
          label="Moderation status"
          value={tab}
          onValueChange={setTab}
          tabs={[
            ...STATUS_TABS.map((t) => ({ value: t.value as Tab, label: t.label, count: counts[t.value], urgent: t.value === "open" || t.value === "escalated" })),
            { value: "listings" as Tab, label: "All listings", short: "Listings", count: products.length, divider: true },
          ]}
          toolbar={tab === "listings" ? undefined : <SearchField value={query} onChange={setQuery} label="Search cases" placeholder="Search listing, brand or reason" />}
        >
          {tab === "listings" ? (
            <ListingsTable />
          ) : rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(m) => m.id}
              onOpen={(m) => {
                setSelected(m.id)
                setOpen(true)
              }}
              openLabel={(m) => `Review ${m.title}`}
              selectedKey={open ? selected : null}
              caption={`${current?.label} moderation cases`}
              minWidth={820}
              mobileRow={(m) => {
                const p = m.productId ? productById.get(m.productId) : undefined
                return {
                  lead: <Thumb src={p?.images[0]?.src} />,
                  title: m.title,
                  meta: `${m.brandName}, ${relDays(m.reportedAt).toLowerCase()}`,
                  trail: <StatusBadge tone={moderationReasonMeta[m.reason].tone}>{moderationReasonMeta[m.reason].label}</StatusBadge>,
                }
              }}
            />
          ) : q ? (
            <EmptyState icon={SearchX} className="m-4" title={`No ${current?.label.toLowerCase()} cases match “${query.trim()}”`} body="Search by listing title, brand, reporter or reason." action={<Button size="sm" variant="secondary" onClick={() => setQuery("")}>Clear search</Button>} />
          ) : (
            <EmptyState icon={Flag} className="m-4" title={current?.empty ?? ""} body={current?.emptyBody} />
          )}
        </QueueTabs>
      </section>

      <ModerationDetail
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
