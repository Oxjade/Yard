"use client"

import { useId, useMemo } from "react"
import { EyeIcon, FlagIcon, GavelIcon, ShieldWarningIcon, SealWarningIcon } from "@phosphor-icons/react"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { productById, products } from "@/lib/data"
import type { ModerationItem } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { Thumb } from "./bits"
import { useDecision } from "./decision"
import { formatDateTime, relDays } from "./format"
import { ListingsTable, useRestrictedListings } from "./listings-table"
import { moderationReasonMeta } from "./meta"
import { modActions, modAllowed, modDecision, type ModActionKey } from "./moderation-actions"
import { ModerationDetail } from "./moderation-detail"
import { AdminPageHead, PanelRail, StatRow } from "./page-head"
import { InPageLinks, useAdminReady, useSearchParam, writeParams, usePhone } from "./url-state"

type Status = ModerationItem["status"]
type Tab = Status | "listings"

const STATUS_TABS: { value: Status; label: string; empty: string; emptyBody: string }[] = [
  { value: "open", label: "Open", empty: "Nothing to review", emptyBody: "New reports and automated flags land here." },
  { value: "escalated", label: "Escalated", empty: "Nothing escalated to legal", emptyBody: "Cases you escalate to legal wait here for a decision." },
  { value: "removed", label: "Removed", empty: "No removed listings", emptyBody: "Listings taken down after review are kept here. Reopen a case if a listing was removed in error." },
  { value: "dismissed", label: "Dismissed", empty: "No dismissed cases", emptyBody: "Reports closed with no action are kept here." },
]
const isTab = (v: string | null): v is Tab => v === "listings" || STATUS_TABS.some((t) => t.value === v)
const n = (v: number) => formatNumber(Math.round(v))

export function ModerationView() {
  const ready = useAdminReady()
  const phone = usePhone()
  const qid = useId()
  const moderation = useAdmin((s) => s.moderation)
  const restricted = useRestrictedListings()
  const linkedTab = useSearchParam("tab")
  const caseId = useSearchParam("case")
  const viewing = caseId ? moderation.find((m) => m.id === caseId) : undefined
  const tab: Tab = isTab(linkedTab) ? linkedTab : viewing && !linkedTab ? viewing.status : "open"
  const { ask, dialog } = useDecision(() => document.getElementById(segmentedTabId(qid, tab)))

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
            .filter((m) => m.status === tab)
            // Live queues are worked oldest first; closed cases show the most recent first.
            .sort((a, b) => (tab === "open" || tab === "escalated" ? a.reportedAt.localeCompare(b.reportedAt) : b.reportedAt.localeCompare(a.reportedAt))),
    [moderation, tab],
  )

  const ipCases = moderation.filter((m) => m.reason === "counterfeit" || m.reason === "ip_complaint")
  const ipOpen = ipCases.filter((m) => m.status === "open").length
  const ipEscalated = ipCases.filter((m) => m.status === "escalated").length
  const unresolved = ipOpen + ipEscalated
  // The card counts open and escalated cases, so it links to the oldest of them (which can be
  // in either tab), not to the Open tab alone.
  const ipOldest = ipCases.filter((m) => m.status === "open" || m.status === "escalated").sort((a, b) => a.reportedAt.localeCompare(b.reportedAt))[0]
  const openCase = (m: ModerationItem) => writeParams({ case: m.id })
  const decide = (key: ModActionKey, list: ModerationItem[], announce = true) => {
    const d = modDecision(key, list, { announce })
    if (d) ask(d)
  }

  const columns: Column<ModerationItem>[] = [
    {
      key: "listing",
      header: "Listing",
      sortValue: (m) => m.title.toLowerCase(),
      cell: (m) => {
        const p = m.productId ? productById.get(m.productId) : undefined
        return (
          <button type="button" onClick={() => openCase(m)} className="group flex max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
            <Thumb src={p?.images[0]?.src} />
            <span className="min-w-0">
              <span className="block max-w-[36vw] sm:max-w-[260px] truncate font-medium text-ink group-hover:text-violet">{m.title}</span>
              <span className="block max-w-[36vw] sm:max-w-[260px] truncate text-[11.5px] text-ink-3">
                <span className="sm:hidden">{moderationReasonMeta[m.reason].label}, {m.brandName}</span>
                <span className="hidden sm:inline md:hidden">{m.brandName}, </span>
                <span className="hidden sm:inline">{p ? "In the catalogue" : "Not in the public catalogue"}</span>
              </span>
            </span>
          </button>
        )
      },
    },
    { key: "brand", header: "Brand", hideBelow: "md", sortValue: (m) => m.brandName, cell: (m) => <span className="whitespace-nowrap text-ink-2">{m.brandName}</span> },
    { key: "reason", header: "Reason", hideBelow: "sm", sortValue: (m) => moderationReasonMeta[m.reason].label, cell: (m) => <StatusBadge tone={moderationReasonMeta[m.reason].tone}>{moderationReasonMeta[m.reason].label}</StatusBadge> },
    { key: "by", header: "Reported by", hideBelow: "lg", cell: (m) => <span className="whitespace-nowrap text-ink-2">{m.reportedBy}</span> },
    { key: "at", header: "Reported", hideBelow: "md", sortValue: (m) => m.reportedAt, cell: (m) => <time dateTime={m.reportedAt} title={formatDateTime(m.reportedAt)} className="whitespace-nowrap text-ink-2">{relDays(m.reportedAt)}</time> },
  ]

  const allowedHere = tab === "listings" ? [] : modAllowed[tab]
  const rowActions: RowAction<ModerationItem>[] = [
    { label: "Review case", icon: EyeIcon, onSelect: openCase },
    ...allowedHere.map((key, i) => ({ label: modActions[key].label, icon: modActions[key].icon, destructive: modActions[key].destructive, separatorBefore: i === 0, onSelect: (m: ModerationItem) => decide(key, [m]) })),
  ]
  const bulkActions: BulkAction<ModerationItem>[] = allowedHere.map((key) => ({ label: key === "remove" ? "Remove listings" : modActions[key].label, destructive: modActions[key].destructive, onSelect: (list) => decide(key, list) }))
  const current = STATUS_TABS.find((t) => t.value === tab)

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Moderation"
        description="Work through reports and automated flags, and restrict any listing on the marketplace."
        note="Decisions are recorded here and in the audit log with your reason. The marketplace reads the sample catalogue in this build, so a listing changes there once moderation comes from the backend."
      />

      <InPageLinks>
        <StatRow label="Moderation figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts.open ? "brand" : "default"} icon={FlagIcon} label="Open cases" value={counts.open} format={n} hint="Oldest first" href="/admin/products?tab=open#moderation-queue" hrefLabel="Show open cases" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={GavelIcon} label="Escalated to legal" value={counts.escalated} format={n} hint="Waiting on legal" href="/admin/products?tab=escalated#moderation-queue" hrefLabel="Show escalated cases" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={SealWarningIcon} label="Counterfeit or IP" value={unresolved} format={n} hint={ready ? `${n(ipOpen)} open, ${n(ipEscalated)} with legal` : "Open or escalated"} href={ipOldest ? `/admin/products?case=${ipOldest.id}` : "/admin/products?tab=removed#moderation-queue"} hrefLabel={ipOldest ? "Open the oldest counterfeit or IP case" : "Show removed listings"} ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ShieldWarningIcon} label="Restricted listings" value={restricted.size} format={n} hint={`Of ${n(products.length)} listings`} href="/admin/products?tab=listings#moderation-queue" hrefLabel="Show all listings" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="moderation-queue" title="Moderation queue" description="Open a case for the listing, the evidence and its history. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Moderation status"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t === "open" ? null : t, category: null })}
            loading={!ready}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={[...STATUS_TABS.map((t) => ({ value: t.value as Tab, label: t.label, count: t.value === "open" || t.value === "escalated" ? counts[t.value] : undefined })), { value: "listings" as Tab, label: "All listings" }]}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {tab === "listings" ? (
            <ListingsTable ask={ask} loading={!ready} />
          ) : (
            <DataTable
              key={tab}
              label={`${current?.label} moderation cases`}
              rows={rows}
              columns={columns}
              getId={(m) => m.id}
              loading={!ready}
              search={{ placeholder: "Search listing, brand or reason", text: (m) => [m.title, m.brandName, m.reportedBy, moderationReasonMeta[m.reason].label].join(" ") }}
              rowActions={rowActions}
              bulkActions={phone ? undefined : bulkActions}
              empty={{ title: current?.empty ?? "", body: current?.emptyBody }}
              minWidth={300}
            />
          )}
        </div>
      </Panel>

      <ModerationDetail id={viewing?.id ?? null} open={!!viewing} onDecide={(key, m) => decide(key, [m], false)} onOpenChange={(o) => !o && writeParams({ case: null })} />
      {dialog}
    </Reveal>
  )
}
