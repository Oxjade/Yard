"use client"

import { useId, useMemo } from "react"
import { EyeIcon, FlagIcon, ProhibitIcon, ShieldWarningIcon, UsersIcon } from "@phosphor-icons/react"
import { DataTable, bulkBarControl, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { useNow } from "@/hooks/use-now"
import type { PlatformUser } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { Initials } from "./bits"
import { useDecision } from "./decision"
import { countryName, formatDate, relDays } from "./format"
import { userStatusMeta } from "./meta"
import { AdminPageHead, PanelRail, StatRow } from "./page-head"
import { InPageLinks, useAdminReady, useSearchParam, writeParams, usePhone } from "./url-state"
import { userActions, userAllowed, userDecision, type UserActionKey } from "./user-actions"
import { UserDetail } from "./user-detail"

type Filter = "all" | "reported" | PlatformUser["status"]
const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: "all", label: "All", empty: "No shopper accounts yet" },
  { value: "reported", label: "Reported", empty: "No reported accounts are still active" },
  { value: "active", label: "Active", empty: "No active accounts" },
  { value: "restricted", label: "Restricted", empty: "No restricted accounts" },
  { value: "suspended", label: "Suspended", empty: "No suspended accounts" },
]
const isFilter = (v: string | null): v is Filter => FILTERS.some((f) => f.value === v)
const n = (v: number) => formatNumber(Math.round(v))

type Status = PlatformUser["status"]
const allows = (key: UserActionKey) => (u: PlatformUser) => userAllowed[u.status].includes(key)

/** Why an account's menu greys out a decision: it's in that status already, or has to be reinstated first. */
const unavailable = (key: UserActionKey) => (u: PlatformUser) => (userActions[key].to === u.status ? `Already ${userStatusMeta[u.status].label.toLowerCase()}.` : "Reinstate the account first.")

/** Why a bulk decision applies to none of the selected accounts ("Only active accounts can be restricted."). */
function onlyFrom(key: UserActionKey) {
  const from = (Object.keys(userAllowed) as Status[]).filter((s) => userAllowed[s].includes(key)).map((s) => userStatusMeta[s].label.toLowerCase())
  return `Only ${from.join(" or ")} accounts can be ${userActions[key].done}.`
}

function inFilter(u: PlatformUser, f: Filter) {
  if (f === "all") return true
  if (f === "reported") return u.reports > 0 && u.status === "active"
  return u.status === f
}

export function UsersView() {
  const ready = useAdminReady()
  // Relative days count from the same today as every other Control Center page.
  const now = useNow(60_000)
  const phone = usePhone()
  const qid = useId()
  const users = useAdmin((s) => s.users)
  const linked = useSearchParam("status")
  const filter: Filter = isFilter(linked) ? linked : "all"
  // /admin/users?user=<id> opens that account, so other screens can link to it.
  const userId = useSearchParam("user")
  const open = !!userId && users.some((u) => u.id === userId)
  // When the control that asked has gone: back to the selection bar while rows stay selected, else the status tab.
  const { ask, dialog } = useDecision(() => bulkBarControl(document.getElementById(`${qid}-panel`)) ?? document.getElementById(segmentedTabId(qid, filter)))

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: users.length, reported: 0, active: 0, restricted: 0, suspended: 0 }
    for (const u of users) {
      c[u.status]++
      if (inFilter(u, "reported")) c.reported++
    }
    return c
  }, [users])

  const rows = useMemo(
    () =>
      users
        .filter((u) => inFilter(u, filter))
        // Accounts with reports first, then the most recently active.
        .sort((a, b) => b.reports - a.reports || b.lastActive.localeCompare(a.lastActive) || a.name.localeCompare(b.name)),
    [users, filter],
  )

  const openUser = (u: PlatformUser) => writeParams({ user: u.id })
  // The row menu and the bulk bar only offer a decision for accounts it applies to. What `ask`
  // returns goes back to the bulk bar, so a decision that reports a cancel keeps the selection.
  const decide = (key: UserActionKey, list: PlatformUser[]) => {
    const d = userDecision(key, list)
    return d ? ask(d) : false
  }

  const columns: Column<PlatformUser>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (u) => u.name.toLowerCase(),
      cell: (u) => (
        <button type="button" onClick={() => openUser(u)} className="group flex max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <Initials name={u.name} round />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink group-hover:text-violet">{u.name}</span>
            <span className="block max-w-[200px] truncate text-[11.5px] text-ink-3 md:hidden">
              <span className="sm:hidden">{userStatusMeta[u.status].label}{u.reports ? `, ${u.reports} ${u.reports === 1 ? "report" : "reports"}` : ""}</span>
              <span className="hidden sm:inline">{u.email}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "email", header: "Email", hideBelow: "md", cell: (u) => <span className="block max-w-[220px] truncate text-ink-2">{u.email}</span> },
    { key: "country", header: "Country", hideBelow: "lg", sortValue: (u) => countryName(u.country), cell: (u) => <span className="whitespace-nowrap text-ink-2">{countryName(u.country)}</span> },
    { key: "joined", header: "Joined", hideBelow: "lg", sortValue: (u) => u.joinedAt, cell: (u) => <time dateTime={u.joinedAt} className="whitespace-nowrap text-ink-2">{formatDate(u.joinedAt)}</time> },
    { key: "orders", header: "Orders", align: "right", hideBelow: "md", sortValue: (u) => u.orders, cell: (u) => <span className="text-ink">{u.orders}</span> },
    { key: "reports", header: "Reports", align: "right", hideBelow: "sm", sortValue: (u) => u.reports, cell: (u) => <span className={u.reports ? "font-medium text-danger" : "text-ink-3"}>{u.reports}</span> },
    { key: "active", header: "Last active", hideBelow: "md", sortValue: (u) => u.lastActive, cell: (u) => <span className="whitespace-nowrap text-ink-2">{relDays(u.lastActive, now)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (u) => u.status, cell: (u) => <StatusBadge tone={userStatusMeta[u.status].tone}>{userStatusMeta[u.status].label}</StatusBadge> },
  ]

  const keys: UserActionKey[] = ["restrict", "suspend", "reinstate"]
  const rowActions: RowAction<PlatformUser>[] = [
    { label: "Open account", icon: EyeIcon, onSelect: openUser },
    ...keys.map((key, i) => ({ label: userActions[key].label, icon: userActions[key].icon, destructive: userActions[key].destructive, separatorBefore: i === 0, disabled: (u: PlatformUser) => !allows(key)(u), disabledReason: unavailable(key), onSelect: (u: PlatformUser) => decide(key, [u]) })),
  ]
  // Bulk: the decisions this tab's accounts can take (Reported lists active accounts only); the
  // bar counts the selected accounts each applies to. A tab with none has no checkboxes.
  const bulkKeys = keys.filter((k) => filter === "all" || userAllowed[filter === "reported" ? "active" : filter].includes(k))
  const bulkActions: BulkAction<PlatformUser>[] = bulkKeys.map((key) => ({ label: userActions[key].label, destructive: userActions[key].destructive, appliesTo: allows(key), disabledReason: onlyFrom(key), onSelect: (list) => decide(key, list) }))
  const current = FILTERS.find((f) => f.value === filter)!

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Users"
        description="Find a shopper, read the reports against them and restrict or suspend the account."
        note="Account decisions are recorded here and in the audit log. Signing shoppers out and blocking checkout need the accounts backend, which isn't connected in this build."
      />

      <InPageLinks>
        <StatRow label="Account figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={UsersIcon} label="Shopper accounts" value={counts.all} format={n} hint="In this sample" href="/admin/users#accounts" hrefLabel="Show all accounts" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts.reported ? "brand" : "default"} icon={FlagIcon} label="Reported, active" value={counts.reported} format={n} hint="Worth a look first" href="/admin/users?status=reported#accounts" hrefLabel="Show reported accounts" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ShieldWarningIcon} label="Restricted" value={counts.restricted} format={n} hint="Can browse, can't buy" href="/admin/users?status=restricted#accounts" hrefLabel="Show restricted accounts" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ProhibitIcon} label="Suspended" value={counts.suspended} format={n} hint="Can't sign in" href="/admin/users?status=suspended#accounts" hrefLabel="Show suspended accounts" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="accounts" title="Accounts" description="Accounts with reports come first. Open one for its reports, orders and history." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={filter}>
          <Segmented label="Account status" size="sm" value={filter} onChange={(f) => writeParams({ status: f === "all" ? null : f })} loading={!ready} idBase={qid} panelId={`${qid}-panel`} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === "reported" ? counts.reported : undefined }))} />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, filter)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          <DataTable
            key={filter}
            label={`${current.label} shopper accounts`}
            rows={rows}
            columns={columns}
            getId={(u) => u.id}
            loading={!ready}
            search={{ placeholder: "Search by name or email", text: (u) => `${u.name} ${u.email}` }}
            rowActions={rowActions}
            bulkActions={phone || !bulkActions.length ? undefined : bulkActions}
            empty={{ title: current.empty, body: "Accounts appear here as their status changes." }}
            initialPageSize={25}
            minWidth={300}
          />
        </div>
      </Panel>

      <UserDetail id={open ? userId : null} open={open} onOpenChange={(o) => !o && writeParams({ user: null })} />
      {dialog}
    </Reveal>
  )
}
