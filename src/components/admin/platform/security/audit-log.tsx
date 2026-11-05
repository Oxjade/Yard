"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { DownloadSimpleIcon as Download, LockIcon as Lock, MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { adminRoles, type AuditEntry } from "@/lib/data/admin"
import { DEMO_TODAY } from "@/lib/data/seed"
import { useAdmin } from "@/lib/stores/admin"
import { isDayPrecision, recordTime } from "../format"
import { FilterSelect, Pagination, PlatformTable, type Column } from "../table"

const PAGE = 10
const ALL = "all"

const csvCell = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`

/** The audit log: every decision, who made it, why and who approved it. Read-only. */
export function AuditLog() {
  const audit = useAdmin((s) => s.audit)
  const log = useAdmin((s) => s.log)
  const [actor, setActor] = useState(ALL)
  const [action, setAction] = useState(ALL)
  const [page, setPage] = useState(0)

  const actors = useMemo(() => [...new Set(audit.map((a) => a.actor))].sort(), [audit])
  const actions = useMemo(() => [...new Set(audit.map((a) => a.action))].sort(), [audit])
  const rows = useMemo(() => audit.filter((a) => (actor === ALL || a.actor === actor) && (action === ALL || a.action === action)), [audit, actor, action])
  const filtered = actor !== ALL || action !== ALL
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE)

  function setFilter(fn: (v: string) => void) {
    return (v: string) => {
      fn(v)
      setPage(0)
    }
  }

  function exportCsv() {
    const header = ["Time (UTC)", "Actor", "Role", "Action", "Target", "Reason", "Approver", "IP"]
    const lines = rows.map((a) => [isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at, a.actor, adminRoles[a.role]?.name ?? a.role, a.action, a.target, a.reason, a.approvedBy, a.ip].map(csvCell).join(","))
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `audit-log-${DEMO_TODAY}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    const scope = filtered ? [actor !== ALL ? actor : null, action !== ALL ? action.toLowerCase() : null].filter(Boolean).join(", ") : "all entries"
    log("Exported audit log", `${rows.length} ${rows.length === 1 ? "entry" : "entries"}, ${scope}`)
    toast.success("Audit log exported", { description: `${rows.length} ${rows.length === 1 ? "entry" : "entries"} saved as CSV. The export itself is in the log.` })
  }

  const columns: Column<AuditEntry>[] = [
    {
      key: "time",
      header: "Time",
      cell: (a) => (
        <span className="block whitespace-nowrap">
          <time dateTime={isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at} title={recordTime(a.at).title} className="block text-ink-2">{recordTime(a.at).label}</time>
          <span className="block text-[11px] text-ink-3 tabular">{a.ip}</span>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      cell: (a) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{a.actor}</span>
          <span className="block text-[11px] text-ink-3">{adminRoles[a.role]?.name ?? a.role}</span>
        </span>
      ),
    },
    { key: "action", header: "Action", cell: (a) => <span className="whitespace-nowrap font-medium text-ink">{a.action}</span> },
    { key: "target", header: "Target", cell: (a) => <span className="block max-w-[240px] text-ink-2">{a.target}</span> },
    { key: "reason", header: "Reason", cell: (a) => (a.reason ? <span className="block max-w-[260px] text-ink-2">{a.reason}</span> : <span className="text-ink-3">No reason recorded</span>) },
    { key: "approver", header: "Approver", cell: (a) => (a.approvedBy ? <span className="whitespace-nowrap text-ink">{a.approvedBy}</span> : <span className="text-ink-3">None</span>) },
  ]

  return (
    <div>
      <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-2">
          <Lock className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          Read-only. Entries can&apos;t be edited or deleted, and exports are logged too.
        </p>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
          <FilterSelect value={actor} onChange={setFilter(setActor)} label="Filter by actor" options={[{ value: ALL, label: "Everyone" }, ...actors.map((a) => ({ value: a, label: a }))]} className="md:w-[156px]" />
          <FilterSelect value={action} onChange={setFilter(setAction)} label="Filter by action" options={[{ value: ALL, label: "All actions" }, ...actions.map((a) => ({ value: a, label: a }))]} className="md:w-[196px]" />
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length} className="col-span-2 md:col-span-1">
            <Download aria-hidden /> Export CSV
          </Button>
        </div>
      </div>

      {rows.length ? (
        <>
          <PlatformTable
            rows={pageRows}
            columns={columns}
            rowKey={(a) => a.id}
            caption="Audit log"
            minWidth={1000}
            mobileRow={(a) => ({
              title: (
                <>
                  {a.actor} <span className="text-ink-2">{a.action.charAt(0).toLowerCase() + a.action.slice(1)}</span>
                </>
              ),
              meta: a.target,
              below: (
                <div className="grid gap-0.5 text-[11px] text-ink-3">
                  {a.reason ? <p className="text-[12px] text-ink-2">{a.reason}</p> : null}
                  <p>
                    <time dateTime={isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at} title={recordTime(a.at).title}>{recordTime(a.at).label}</time>, {adminRoles[a.role]?.name.toLowerCase() ?? a.role}
                    {a.approvedBy ? `, approved by ${a.approvedBy}` : ""}
                  </p>
                </div>
              ),
            })}
          />
          <Pagination page={page} pageSize={PAGE} total={rows.length} onPage={setPage} noun="entries" />
        </>
      ) : (
        <div className="px-4 pb-4">
          <EmptyState
            icon={SearchX}
            title={filtered ? "No entries match these filters" : "No audit entries yet"}
            body={filtered ? "Try another person or action." : "Every sensitive action is recorded here as it happens."}
            action={
              filtered ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setActor(ALL)
                    setAction(ALL)
                    setPage(0)
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
