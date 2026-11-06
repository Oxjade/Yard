"use client"

import { useMemo, useState } from "react"
import { DownloadSimpleIcon as Download, LockIcon as Lock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column } from "@/components/dashboard/data-table"
import { Filters } from "@/components/admin/marketplace/filters"
import { useAsyncAction } from "@/hooks/use-async-action"
import { adminRoles, type AuditEntry } from "@/lib/data/admin"
import { DEMO_TODAY } from "@/lib/data/seed"
import { useAdmin } from "@/lib/stores/admin"
import { isDayPrecision, recordTime } from "../format"

const ALL = "all"
const csvCell = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
/**
 * Operational actions are recorded now and carried out once the job runner, payments service
 * or auth service is connected, so the log says what was recorded, not that it already ran.
 */
const pendingLabel: Record<string, string> = {
  "Retried background job": "Recorded a job retry",
  "Replayed webhook": "Recorded a webhook replay",
  "Revoked session": "Recorded a session revoke",
  "Required MFA": "Recorded an MFA requirement",
}
const actionLabel = (action: string) => pendingLabel[action] ?? action
/** The store writes price changes as "$14/day → $15/day"; on screen it reads as words. */
const readable = (s: string) => s.replace(/\s*→\s*/g, " to ")

/** How many entries each actor or action has, for the filter options. */
function tally(audit: AuditEntry[], key: "actor" | "action") {
  const m = new Map<string, number>()
  for (const a of audit) m.set(a[key], (m.get(a[key]) ?? 0) + 1)
  return m
}

function download(rows: AuditEntry[], name: string) {
  const header = ["Time (UTC)", "Actor", "Role", "Action", "Target", "Reason", "Approver", "IP"]
  const lines = rows.map((a) => [isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at, a.actor, adminRoles[a.role]?.name ?? a.role, actionLabel(a.action), readable(a.target), a.reason, a.approvedBy, a.ip].map(csvCell).join(","))
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** The audit log: every decision, who made it, why and who approved it. Read-only; exports are logged too. */
export function AuditLog({ ready }: { ready: boolean }) {
  const audit = useAdmin((s) => s.audit)
  const log = useAdmin((s) => s.log)
  const [actor, setActor] = useState(ALL)
  const [action, setAction] = useState(ALL)

  const actors = useMemo(() => [...tally(audit, "actor")].sort((x, y) => x[0].localeCompare(y[0])), [audit])
  const actions = useMemo(() => [...tally(audit, "action")].sort((x, y) => actionLabel(x[0]).localeCompare(actionLabel(y[0]))), [audit])
  const rows = useMemo(() => audit.filter((a) => (actor === ALL || a.actor === actor) && (action === ALL || a.action === action)), [audit, actor, action])
  const filtered = actor !== ALL || action !== ALL

  const exportRows = useAsyncAction(
    (list: AuditEntry[], scope: string) => {
      download(list, `audit-log-${DEMO_TODAY}.csv`)
      log("Exported audit log", `${list.length} ${list.length === 1 ? "entry" : "entries"}, ${scope}`)
      return list.length
    },
    { success: "Audit log exported", successDescription: (n) => `${n} ${n === 1 ? "entry" : "entries"} saved as a CSV file. The export is in the log too.` },
  )

  const scope = filtered ? [actor !== ALL ? actor : null, action !== ALL ? lower(actionLabel(action)) : null].filter(Boolean).join(", ") : "all entries"

  const columns: Column<AuditEntry>[] = [
    {
      key: "action",
      header: "Action",
      sortValue: (a) => actionLabel(a.action),
      cell: (a) => (
        <span className="block min-w-0 max-w-[38vw] md:max-w-[260px]">
          <span className="block font-medium text-ink">{actionLabel(a.action)}</span>
          {/* Phones show the actor and target here; wider screens have their own columns. */}
          <span className="block truncate text-[11px] text-ink-3 md:hidden">
            {a.actor}, {readable(a.target)}
          </span>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      hideBelow: "md",
      sortValue: (a) => a.actor,
      cell: (a) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{a.actor}</span>
          <span className="block text-[11px] text-ink-3">{adminRoles[a.role]?.name ?? a.role}</span>
        </span>
      ),
    },
    { key: "target", header: "Target", hideBelow: "md", cell: (a) => <span className="block max-w-[240px] text-ink-2">{readable(a.target)}</span> },
    { key: "reason", header: "Reason", className: "hidden xl:table-cell", cell: (a) => (a.reason ? <span className="block max-w-[260px] text-ink-2">{a.reason}</span> : <span className="text-ink-3">No reason recorded</span>) },
    { key: "approver", header: "Approver", className: "hidden xl:table-cell", sortValue: (a) => a.approvedBy ?? "", cell: (a) => (a.approvedBy ? <span className="whitespace-nowrap text-ink">{a.approvedBy}</span> : <span className="text-ink-3">None</span>) },
    {
      key: "time",
      header: "Time",
      align: "right",
      sortValue: (a) => a.at,
      cell: (a) => {
        const t = recordTime(a.at)
        return (
          <span className="block whitespace-nowrap">
            <time dateTime={isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at} title={t.title} className="block text-ink-2">{t.label}</time>
            <span className="block text-[11px] text-ink-3 tabular">{a.ip === "local" ? "This browser" : a.ip}</span>
          </span>
        )
      },
    },
  ]

  const bulk: BulkAction<AuditEntry>[] = [{ label: "Export selected as CSV", onSelect: (list) => void exportRows.run(list, `${list.length} selected`) }]

  function clear() {
    setActor(ALL)
    setAction(ALL)
  }

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <Lock className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        Read-only. Entries can&apos;t be edited or deleted, and exports are logged too.
      </p>
      <DataTable
        label="Audit log"
        rows={ready ? rows : []}
        loading={!ready}
        columns={columns}
        getId={(a) => a.id}
        bulkActions={bulk}
        density="dense"
        minWidth={0}
        search={{ placeholder: "Search the audit log", text: (a) => `${a.actor} ${actionLabel(a.action)} ${readable(a.target)} ${a.reason ?? ""} ${a.approvedBy ?? ""}` }}
        toolbar={
          <>
            <Filters
              noun="entries"
              singular="entry"
              results={rows.length}
              onClear={clear}
              filters={[
                { key: "actor", label: "Actor", value: actor, onChange: setActor, all: { value: ALL, label: `Everyone (${audit.length})` }, options: actors.map(([a, n]) => ({ value: a, label: `${a} (${n})` })), width: "w-[176px]" },
                { key: "action", label: "Action", value: action, onChange: setAction, all: { value: ALL, label: `All actions (${audit.length})` }, options: actions.map(([a, n]) => ({ value: a, label: `${actionLabel(a)} (${n})` })), width: "w-[220px]" },
              ]}
            />
            <Button size="sm" variant="secondary" onClick={() => void exportRows.run(rows, scope)} disabled={!ready || !rows.length} loading={exportRows.pending} className="h-10 md:ml-auto md:h-9">
              <Download aria-hidden /> Export {filtered ? "filtered" : "all"} as CSV
            </Button>
          </>
        }
        empty={{
          title: filtered ? "No entries match these filters" : "No audit entries yet",
          body: filtered ? "Try another person or action." : "Every sensitive action is recorded here as it happens.",
          action: filtered ? (
            <Button size="sm" variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          ) : undefined,
        }}
      />
    </div>
  )
}
