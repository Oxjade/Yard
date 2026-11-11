"use client"

import { useMemo, useState } from "react"
import { DownloadSimpleIcon as Download, LockIcon as Lock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column } from "@/components/dashboard/data-table"
import { Filters } from "@/components/admin/marketplace/filters"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useNow } from "@/hooks/use-now"
import { decide, listAudit } from "@/lib/api/admin"
import type { AuditEntryDto } from "@/lib/api/contracts/common"
import { useApi } from "@/lib/api/use-api"
import { adminRoles, type AuditEntry } from "@/lib/data/admin"
import { canAdmin, needsRole } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"
import { usePageSampleData } from "@/components/sample/sample-data-context"
import { anchorDay } from "../../finance/format"
import { isDayPrecision, recordTime } from "../format"
import { AUDIT_CSV_HEADER, actionLabel, auditCsvLine, csvCell, entryLabel, LEGACY_NOTE, readable } from "./audit-words"

/**
 * The audit log (§8.3): the server's rows (v2 decisions, sign-ins, audited views) merged with the
 * entries the legacy pages wrote in this browser. A Source filter separates them; browser rows
 * carry the legacy note, because the legacy store always acts as Kemi Ajayi. Brand-side writes
 * (actor kind brand) are left out unless "Including brand teams" is chosen.
 */

const ALL = "all"
type Source = "server" | "browser"
type Row = AuditEntry & { source: Source; actorKind: string; roleName: string }

const roleName = (role: string | null | undefined, kind: string) => {
  const name = role ? (adminRoles[role as keyof typeof adminRoles]?.name ?? role.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())) : kind === "system" ? "Yard" : ""
  return kind === "brand" ? `${name || "Member"}, brand team` : kind === "shopper" ? "Shopper" : name
}

function fromServer(e: AuditEntryDto): Row {
  return { id: e.id, at: e.at, actor: e.actor, role: (e.role ?? "owner") as AuditEntry["role"], roleName: roleName(e.role, e.actorKind), action: e.action, target: e.target ?? "", reason: e.reason ?? undefined, ip: "server", approvedBy: e.approvedBy ?? undefined, subjectId: e.subjectId ?? undefined, source: "server", actorKind: e.actorKind }
}

/** How many entries each actor or action has, for the filter options. */
function tally(rows: Row[], key: "actor" | "action") {
  const m = new Map<string, number>()
  for (const a of rows) m.set(a[key], (m.get(a[key]) ?? 0) + 1)
  return m
}

function saveCsv(text: string, name: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const NO_ENTRIES: AuditEntry[] = []

/**
 * This browser's audit entries (the legacy store, seeded with made-up sample entries): demo and
 * development only. In production (the demo switch off, or before the session says it is on) the
 * audit log is the server's alone, so this is empty.
 */
export function useBrowserAudit(): AuditEntry[] {
  const sampleData = usePageSampleData()
  const audit = useAdmin((s) => s.audit)
  return sampleData ? audit : NO_ENTRIES
}

const browserCsv = (rows: Row[]) => rows.map((a) => auditCsvLine({ at: a.at, source: "browser", actor: a.actor, roleName: a.roleName, action: a.action, target: a.target, reason: a.reason, approvedBy: a.approvedBy, ip: a.ip }))

/**
 * The figures for Security's "Audit entries" card, counted the way the log below lists them: the
 * server's rows (admins and Yard, its default feed) plus this browser's legacy rows, with the
 * second-approver count from both. Without an audit.view session only this browser's rows count,
 * and `label` says so. Shares the log's own request (same key), so it costs nothing extra.
 */
export function useAuditFigures() {
  const audit = useBrowserAudit()
  const sampleData = usePageSampleData()
  const admin = useServerSession((s) => s.admin)
  const canRead = !!admin && canAdmin(admin.role, "audit.view")
  const server = useApi(canRead ? "admin:audit:feed:admins" : null, () => listAudit({ limit: 200 }), { refreshInterval: 30_000 })
  const t = server.data?.totals
  const local = { entries: audit.length, withApprover: audit.filter((a) => a.approvedBy).length }
  return {
    entries: local.entries + (t?.entries ?? 0),
    withApprover: local.withApprover + (t?.withApprover ?? 0),
    /** False while the server's count is still loading (the card shows its skeleton). */
    ready: !canRead || !!t || !!server.error,
    label: !sampleData ? "Server" : canRead ? (server.error && !t ? "This browser's entries (the server's couldn't load)" : "Server and this browser") : "This browser's legacy entries",
  }
}

/** The audit log: every decision, who made it, why and who approved it. Read-only; exports are logged too. */
export function AuditLog({ ready }: { ready: boolean }) {
  const audit = useBrowserAudit()
  const sampleData = usePageSampleData()
  const now = useNow(60_000)
  const log = useAdmin((s) => s.log)
  const session = useServerSession()
  const admin = session.admin
  const canRead = !!admin && canAdmin(admin.role, "audit.view")
  const [actor, setActor] = useState(ALL)
  const [action, setAction] = useState(ALL)
  const [source, setSource] = useState<string>(ALL)
  const [who, setWho] = useState<string>("admins")
  const includeBrands = who === "everyone"
  const server = useApi(canRead ? `admin:audit:feed:${includeBrands ? "all" : "admins"}` : null, () => listAudit({ actorKind: includeBrands ? "all" : undefined, limit: 200 }), { refreshInterval: 30_000 })
  // Older pages, loaded on request (undefined cursor = continue from the first page).
  const [older, setOlder] = useState<{ feed: string; items: AuditEntryDto[]; cursor: string | null | undefined }>({ feed: "", items: [], cursor: undefined })
  const feed = includeBrands ? "all" : "admins"
  const olderHere = useMemo(() => (older.feed === feed ? older : { feed, items: [] as AuditEntryDto[], cursor: undefined }), [older, feed])
  const moreCursor = olderHere.cursor === undefined ? (server.data?.nextCursor ?? null) : olderHere.cursor
  const loadOlder = useAsyncAction(
    async () => {
      if (!moreCursor) return
      const r = await listAudit({ actorKind: includeBrands ? "all" : undefined, limit: 200, cursor: moreCursor })
      setOlder({ feed, items: [...olderHere.items, ...r.items], cursor: r.nextCursor })
    },
    { error: "Couldn't load older entries. Try again." },
  )
  const rows = useMemo(() => {
    const serverRows = [...(server.data?.items ?? []), ...olderHere.items].map(fromServer)
    const seen = new Set<string>()
    const merged: Row[] = []
    for (const r of [...serverRows, ...audit.map((a): Row => ({ ...a, source: "browser", actorKind: "admin", roleName: adminRoles[a.role]?.name ?? a.role }))]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(r)
    }
    return merged.sort((a, b) => b.at.localeCompare(a.at))
  }, [server.data, olderHere.items, audit])

  const bySource = useMemo(() => rows.filter((a) => source === ALL || a.source === source), [rows, source])
  const actors = useMemo(() => [...tally(bySource, "actor")].sort((x, y) => x[0].localeCompare(y[0])), [bySource])
  const actions = useMemo(() => [...tally(bySource, "action")].sort((x, y) => actionLabel(x[0]).localeCompare(actionLabel(y[0]))), [bySource])
  const shown = useMemo(() => bySource.filter((a) => (actor === ALL || a.actor === actor) && (action === ALL || a.action === action)), [bySource, actor, action])
  const filtered = actor !== ALL || action !== ALL || source !== ALL || includeBrands
  const counts = { server: rows.filter((r) => r.source === "server").length, browser: rows.filter((r) => r.source === "browser").length }

  // Server rows are exported by the server: it builds their CSV, counts them itself and logs the
  // export (audit.exported) in the same request. This browser's legacy rows are appended here and
  // logged in this browser, as before.
  const exportRows = useAsyncAction(
    async (list: Row[], selection: boolean) => {
      const local = list.filter((r) => r.source === "browser")
      const wantServer = canRead && (selection ? list.some((r) => r.source === "server") : source !== "browser")
      let serverLines: string[] = []
      let serverCount = 0
      if (wantServer) {
        const r = await decide<"export-audit", { csv: string; count: number }>(
          "export-audit",
          selection
            ? { id: "audit_log", ids: list.filter((x) => x.source === "server").map((x) => x.id) }
            : { id: "audit_log", actorKind: includeBrands ? "all" : "admins", actor: actor !== ALL ? actor : undefined, action: action !== ALL ? action : undefined },
        )
        serverLines = r.item.csv.split("\n").slice(1)
        serverCount = r.item.count
      }
      saveCsv([AUDIT_CSV_HEADER.map(csvCell).join(","), ...serverLines, ...browserCsv(local)].join("\n"), `audit-log-${anchorDay(Date.now())}.csv`)
      if (local.length && !wantServer) log("Exported audit log", `${local.length} ${local.length === 1 ? "entry" : "entries"} from this browser`)
      return serverCount + local.length
    },
    { success: "Audit log exported", successDescription: (n) => `${n} ${n === 1 ? "entry" : "entries"} saved as a CSV file. The export is in the log too.` },
  )


  const columns: Column<Row>[] = [
    {
      key: "action",
      header: "Action",
      sortValue: (a) => actionLabel(a.action),
      cell: (a) => (
        <span className="block max-w-[38vw] min-w-0 md:max-w-[260px]">
          <span className="block font-medium text-ink">{entryLabel(a.action, a.target)}</span>
          {/* Phones show the actor and target here; wider screens have their own columns. */}
          <span className="block truncate text-[11px] text-ink-3 md:hidden">
            {a.actor}, {readable(a.target)}
          </span>
          {a.source === "browser" ? <span className="block text-[11px] text-ink-3 md:hidden">{LEGACY_NOTE}</span> : null}
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      hideBelow: "md",
      sortValue: (a) => a.actor,
      cell: (a) => (
        <span className="block max-w-[220px]">
          <span className="block whitespace-nowrap text-ink">{a.actor}</span>
          <span className="block text-[11px] text-ink-3">{a.source === "browser" ? LEGACY_NOTE : a.roleName}</span>
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
        const t = recordTime(a.at, now)
        return (
          <span className="block whitespace-nowrap">
            <time dateTime={isDayPrecision(a.at) ? a.at.slice(0, 10) : a.at} title={t.title} className="block text-ink-2">{t.label}</time>
            <span className="block text-[11px] text-ink-3 tabular">{a.source === "server" ? "Server" : a.ip === "local" ? "This browser" : a.ip}</span>
          </span>
        )
      },
    },
  ]

  const bulk: BulkAction<Row>[] = [{ label: "Export selected as CSV", onSelect: (list) => void exportRows.run(list, true) }]

  function clear() {
    setActor(ALL)
    setAction(ALL)
    setSource(ALL)
    setWho("admins")
  }

  const serverNote = !sampleData
    ? !admin
      ? "Sign in as an admin to see the audit log."
      : !canRead
        ? `The audit log: ${needsRole("audit.view").toLowerCase()}.`
        : server.error && !server.data
          ? "Couldn't load the audit log. Try again shortly."
          : null
    : !admin
    ? "Server entries need a demo admin session: sign in from the account menu. Only this browser's entries show until then."
    : !canRead
      ? `Server entries: ${needsRole("audit.view").toLowerCase()}. Only this browser's entries show.`
      : server.error && !server.data
        ? "Couldn't load the server's entries. This browser's entries are shown; try again shortly."
        : null
  const loading = !ready || (canRead && !server.data && !server.error) || session.status === "loading"

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <Lock className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        Read-only. Entries can&apos;t be edited or deleted, and exports are logged too.
      </p>
      {serverNote ? <p className="text-[12px] text-ink-3">{serverNote}</p> : null}
      <DataTable
        label="Audit log"
        rows={loading ? [] : shown}
        loading={loading}
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
              results={shown.length}
              onClear={clear}
              filters={[
                // Production has the server's entries only, so there is no source to choose.
                ...(sampleData ? [{ key: "source", label: "Source", value: source, onChange: setSource, all: { value: ALL, label: `All sources (${rows.length})` }, options: [{ value: "server", label: `Server (${counts.server})` }, { value: "browser", label: `This browser (${counts.browser})` }], width: "w-[176px]" }] : []),
                { key: "who", label: "Who", value: who, onChange: setWho, all: { value: "admins", label: "Admins and Yard" }, options: [{ value: "everyone", label: "Including brand teams" }], width: "w-[190px]" },
                { key: "actor", label: "Actor", value: actor, onChange: setActor, all: { value: ALL, label: `Everyone (${bySource.length})` }, options: actors.map(([a, n]) => ({ value: a, label: `${a} (${n})` })), width: "w-[176px]" },
                { key: "action", label: "Action", value: action, onChange: setAction, all: { value: ALL, label: `All actions (${bySource.length})` }, options: actions.map(([a, n]) => ({ value: a, label: `${actionLabel(a)} (${n})` })), width: "w-[220px]" },
              ]}
            />
            <Button size="sm" variant="secondary" onClick={() => void exportRows.run(shown, false)} disabled={loading || !shown.length} loading={exportRows.pending} className="h-10 md:ml-auto md:h-9">
              <Download aria-hidden /> Export {filtered ? "filtered" : "all"} as CSV
            </Button>
          </>
        }
        empty={{
          title: filtered ? "No entries match these filters" : "No audit entries yet",
          body: filtered ? "Try another source, person or action." : "Every sensitive action is recorded here as it happens.",
          action: filtered ? (
            <Button size="sm" variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          ) : undefined,
        }}
      />
      {canRead && moreCursor ? (
        <Button size="sm" variant="secondary" className="h-10 justify-self-center sm:h-9" loading={loadOlder.pending} onClick={() => void loadOlder.run()}>
          Load older server entries
        </Button>
      ) : null}
      {loadOlder.error ? <p role="alert" className="text-center text-[12px] text-danger">{loadOlder.error}</p> : null}
    </div>
  )
}
