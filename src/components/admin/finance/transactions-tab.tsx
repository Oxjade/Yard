"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { WarningIcon as AlertTriangle, ArrowUpRightIcon as ArrowUpRight, MagnifyingGlassMinusIcon as SearchX, ShieldWarningIcon as ShieldAlert, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { ledgerRows, orderIdOf, type LedgerRow } from "./derive"
import { formatDateTime, plural, providerName, relDays, signedUsd } from "./format"
import { txStatusMeta, txTypeLabel } from "./meta"
import { FilterSelect, Pagination, SearchField } from "../platform/table"
import { AdminTable, TablePanel, type Column } from "./table"

const PAGE_SIZE = 25

type StatusFilter = "all" | "flagged" | LedgerRow["status"]

function Webhook({ row }: { row: LedgerRow }) {
  if (row.webhookVerified === null) return <span className="text-[12px] whitespace-nowrap text-ink-3">Internal entry</span>
  return row.webhookVerified ? (
    <span className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap text-ink-2">
      <ShieldCheck className="size-3.5 text-violet" aria-hidden /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap text-danger">
      <ShieldAlert className="size-3.5" aria-hidden /> Not verified
    </span>
  )
}

/** Every money movement the ledger knows about, newest first. Read-only; failed and unverified events are flagged. */
export function TransactionsTab() {
  const adjustments = useAdmin((s) => s.adjustments)
  const rows = useMemo(() => ledgerRows(adjustments), [adjustments])
  const [query, setQuery] = useState("")
  const [type, setType] = useState("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [provider, setProvider] = useState("all")
  const [page, setPage] = useState(0)

  const flagged = rows.filter((r) => r.status === "failed" || r.webhookVerified === false)
  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (type !== "all" && r.type !== type) return false
    if (provider !== "all" && r.provider !== provider) return false
    if (status === "flagged" && !(r.status === "failed" || r.webhookVerified === false)) return false
    if (status !== "all" && status !== "flagged" && r.status !== status) return false
    return !q || `${r.reference} ${r.brandName}`.toLowerCase().includes(q)
  })
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const pageRows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const types = [...new Set(rows.map((r) => r.type))]
  const reset = (fn: () => void) => {
    fn()
    setPage(0)
  }

  const isFlagged = (r: LedgerRow) => r.status === "failed" || r.webhookVerified === false
  const refCell = (r: LedgerRow) =>
    r.provider === "internal" ? (
      <span className="font-medium whitespace-nowrap text-ink tabular">{r.reference}</span>
    ) : (
      <Link href={`/admin/orders?order=${orderIdOf(r.id)}`} className="font-medium whitespace-nowrap text-ink tabular hover:text-violet">
        #{r.reference}
      </Link>
    )

  const columns: Column<LedgerRow>[] = [
    { key: "at", header: "Date", cell: (r) => <time dateTime={r.at} title={formatDateTime(r.at)} className="whitespace-nowrap text-ink-2">{relDays(r.at)}</time> },
    { key: "ref", header: "Reference", cell: refCell },
    { key: "brand", header: "Brand", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.brandName}</span> },
    { key: "type", header: "Type", cell: (r) => <span className="whitespace-nowrap text-ink">{txTypeLabel[r.type]}</span> },
    { key: "provider", header: "Provider", cell: (r) => <span className="whitespace-nowrap text-ink-2">{providerName[r.provider]}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className={cn("whitespace-nowrap", r.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{signedUsd(r.amountUsd)}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={txStatusMeta[r.status].tone}>{txStatusMeta[r.status].label}</StatusBadge> },
    { key: "webhook", header: "Webhook", cell: (r) => <Webhook row={r} /> },
  ]

  return (
    <div className="grid gap-5">
      {flagged.length ? (
        <div role="note" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[12px] text-ink">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
            <span>
              {plural(flagged.length, "transaction")} failed or arrived with an unverified webhook. Nothing unverified is posted to the ledger; confirm with the provider&apos;s verify API before anyone retries.
            </span>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="xs" variant="secondary" onClick={() => reset(() => setStatus("flagged"))}>
              Show flagged
            </Button>
            <Button asChild size="xs" variant="ghost">
              <Link href="/admin/health">
                Webhook failures <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      <TablePanel
        id="tx-title"
        stacked
        title="Transactions"
        description={`${filtered.length} of ${rows.length} entries. Charges, commission and refunds from the providers, plus approved adjustments as their own entries.`}
        toolbar={
          <>
            <SearchField value={query} onChange={(v) => reset(() => setQuery(v))} label="Search transactions" placeholder="Reference or brand" className="md:w-60" />
            <FilterSelect label="Filter by type" value={type} onChange={(v) => reset(() => setType(v))} options={[{ value: "all", label: "All types" }, ...types.map((t) => ({ value: t, label: txTypeLabel[t] }))]} className="w-auto min-w-0 flex-1 md:w-[132px] md:flex-none" />
            <FilterSelect
              label="Filter by provider"
              value={provider}
              onChange={(v) => reset(() => setProvider(v))}
              options={[{ value: "all", label: "All providers" }, ...["paystack", "flutterwave", "stripe", "internal"].map((p) => ({ value: p, label: providerName[p] }))]}
              className="w-auto min-w-0 flex-1 md:w-[140px] md:flex-none"
            />
            <FilterSelect
              label="Filter by status"
              value={status}
              onChange={(v) => reset(() => setStatus(v as StatusFilter))}
              options={[
                { value: "all", label: "All statuses" },
                { value: "flagged", label: "Failed or unverified" },
                { value: "succeeded", label: "Succeeded" },
                { value: "pending", label: "Pending" },
                { value: "failed", label: "Failed" },
              ]}
              className="w-full md:w-[176px]"
            />
          </>
        }
      >
        {pageRows.length ? (
          <>
            <AdminTable
              rows={pageRows}
              columns={columns}
              rowKey={(r) => r.id}
              caption="Ledger transactions"
              minWidth={900}
              rowClassName={(r) => isFlagged(r) && "bg-danger/[0.05]"}
              mobileRow={(r) => ({
                title: (
                  <>
                    {txTypeLabel[r.type]} <span className="text-ink-2 tabular">{r.provider === "internal" ? r.reference : `#${r.reference}`}</span>
                  </>
                ),
                meta: `${r.brandName}, ${providerName[r.provider]}, ${relDays(r.at).toLowerCase()}`,
                trail: (
                  <>
                    <span className={cn("text-[13px] tabular", r.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{signedUsd(r.amountUsd)}</span>
                    {isFlagged(r) ? <StatusBadge tone="danger">{r.status === "failed" ? "Failed" : "Not verified"}</StatusBadge> : null}
                  </>
                ),
              })}
            />
            <Pagination page={current} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} noun="transactions" />
          </>
        ) : (
          <EmptyState
            icon={SearchX}
            className="m-4"
            title="No transactions match"
            body="Try another type, provider or status, or search by order reference."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  reset(() => {
                    setQuery("")
                    setType("all")
                    setProvider("all")
                    setStatus("all")
                  })
                }
              >
                Clear filters
              </Button>
            }
          />
        )}
      </TablePanel>
    </div>
  )
}
