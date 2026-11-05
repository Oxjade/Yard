"use client"

import { useMemo, useState } from "react"
import { MagnifyingGlassMinusIcon as SearchX, UsersIcon as Users } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { PlatformUser } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { DataTable, Initials, Pagination, SearchField, type Column } from "./data-table"
import { countryName, formatDate, relDays } from "./format"
import { userStatusMeta } from "./meta"
import { UserDetail } from "./user-detail"

type Filter = "all" | PlatformUser["status"]
const PAGE = 20
const n = (v: number) => formatNumber(Math.round(v))

export function UsersView() {
  const users = useAdmin((s) => s.users)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const q = query.trim().toLowerCase()

  const counts = useMemo(() => {
    const c = { all: users.length, active: 0, restricted: 0, suspended: 0 }
    for (const u of users) c[u.status]++
    return c
  }, [users])

  const rows = useMemo(
    () =>
      users
        .filter((u) => (filter === "all" || u.status === filter) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)))
        // Accounts with reports first, then the most recently active.
        .sort((a, b) => b.reports - a.reports || b.lastActive.localeCompare(a.lastActive) || a.name.localeCompare(b.name)),
    [users, filter, q],
  )
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pageCount - 1)
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE)
  const reported = users.filter((u) => u.reports > 0 && u.status === "active").length

  const columns: Column<PlatformUser>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Initials name={u.name} round />
          <span className="truncate font-medium text-ink">{u.name}</span>
        </span>
      ),
    },
    { key: "email", header: "Email", cell: (u) => <span className="block max-w-[220px] truncate text-ink-2">{u.email}</span> },
    { key: "country", header: "Country", cell: (u) => <span className="whitespace-nowrap text-ink-2">{countryName(u.country)}</span> },
    { key: "joined", header: "Joined", cell: (u) => <time dateTime={u.joinedAt} className="whitespace-nowrap text-ink-2">{formatDate(u.joinedAt)}</time> },
    { key: "orders", header: "Orders", align: "right", cell: (u) => <span className="text-ink">{u.orders}</span> },
    { key: "reports", header: "Reports", align: "right", cell: (u) => <span className={u.reports ? "font-medium text-danger" : "text-ink-3"}>{u.reports}</span> },
    { key: "active", header: "Last active", cell: (u) => <span className="whitespace-nowrap text-ink-2">{relDays(u.lastActive)}</span> },
    { key: "status", header: "Status", cell: (u) => <StatusBadge tone={userStatusMeta[u.status].tone}>{userStatusMeta[u.status].label}</StatusBadge> },
  ]

  function resetPage<T>(fn: (v: T) => void) {
    return (v: T) => {
      fn(v)
      setPage(0)
    }
  }

  const filterLabel = filter === "all" ? "accounts" : `${userStatusMeta[filter].label.toLowerCase()} accounts`

  return (
    <div className="grid gap-5">
      <PageHeader title="Users" description="Find a shopper, read the reports against them and restrict or suspend the account.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Account figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Shopper accounts" value={counts.all} format={n} hint="in this sample" />
        <MetricTile density="dense" label="Reported, still active" value={reported} format={n} highlight={reported > 0} />
        <MetricTile density="dense" label="Restricted" value={counts.restricted} format={n} hint="can browse, can't buy" />
        <MetricTile density="dense" label="Suspended" value={counts.suspended} format={n} hint="can't sign in" />
      </section>

      <section aria-labelledby="users-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <div className="flex flex-col gap-2 border-b border-line-soft px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="users-title" className="text-[13px] font-medium text-ink">Accounts</h2>
            <p className="text-[11px] text-ink-3 tabular" aria-live="polite">
              {rows.length === users.length ? `${rows.length} accounts` : `${rows.length} of ${users.length} accounts`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SearchField value={query} onChange={resetPage(setQuery)} label="Search accounts" placeholder="Name or email" className="min-w-0 flex-1 md:flex-none" />
            <Select value={filter} onValueChange={(v) => resetPage(setFilter)(v as Filter)}>
              <SelectTrigger aria-label="Filter by status" className="h-8 w-[148px] shrink-0 rounded-md border-line bg-surface text-[13px] dark:bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="all">All statuses ({counts.all})</SelectItem>
                <SelectItem value="active">Active ({counts.active})</SelectItem>
                <SelectItem value="restricted">Restricted ({counts.restricted})</SelectItem>
                <SelectItem value="suspended">Suspended ({counts.suspended})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {visible.length ? (
          <>
            <DataTable
              rows={visible}
              columns={columns}
              rowKey={(u) => u.id}
              onOpen={(u) => {
                setSelected(u.id)
                setOpen(true)
              }}
              openLabel={(u) => `Open ${u.name}`}
              selectedKey={open ? selected : null}
              caption="Shopper accounts"
              minWidth={900}
              mobileRow={(u) => ({
                lead: <Initials name={u.name} round />,
                title: u.name,
                meta: `${u.email}`,
                trail: (
                  <>
                    <StatusBadge tone={userStatusMeta[u.status].tone}>{userStatusMeta[u.status].label}</StatusBadge>
                    <span className={u.reports ? "text-[11px] text-danger" : "text-[11px] text-ink-3"}>
                      {u.reports ? `${u.reports} ${u.reports === 1 ? "report" : "reports"}` : `${u.orders} ${u.orders === 1 ? "order" : "orders"}`}
                    </span>
                  </>
                ),
              })}
            />
            <Pagination page={current} pageSize={PAGE} total={rows.length} onPage={setPage} noun="accounts" />
          </>
        ) : (
          <EmptyState
            icon={q ? SearchX : Users}
            className="m-4"
            title={q ? `No ${filterLabel} match “${query.trim()}”` : `No ${filterLabel}`}
            body={q ? "Try part of the name or the full email address." : "Accounts with this status appear here."}
            action={
              q || filter !== "all" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQuery("")
                    setFilter("all")
                    setPage(0)
                  }}
                >
                  Show all accounts
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      <UserDetail id={selected} open={open} onOpenChange={setOpen} />
    </div>
  )
}
