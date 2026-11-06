"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon, CopyIcon, ShieldCheckIcon, ShieldWarningIcon, WarningIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/admin/ui/panel"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { CopyValue } from "../marketplace/bits"
import { Filters } from "../marketplace/filters"
import { ledgerRows, orderIdOf, type LedgerRow } from "./derive"
import { formatDateTime, plural, providerName, relDays, signedUsd, usd } from "./format"
import { txStatus, txTypeLabel } from "./meta"
import { downloadCsv, useSearchParam, writeParams } from "./table"
import { usePhone } from "../marketplace/url-state"

type StatusFilter = "all" | "flagged" | LedgerRow["status"]
const STATUSES: StatusFilter[] = ["all", "flagged", "succeeded", "pending", "failed"]
const PROVIDERS = ["paystack", "flutterwave", "stripe", "internal"]
const isFlagged = (r: LedgerRow) => r.status === "failed" || r.webhookVerified === false

function Webhook({ row }: { row: LedgerRow }) {
  if (row.webhookVerified === null) return <span className="text-[12px] whitespace-nowrap text-ink-3">Internal entry</span>
  return row.webhookVerified ? (
    <span className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap text-ink-2">
      <ShieldCheckIcon className="size-3.5 text-violet" aria-hidden /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap text-danger">
      <ShieldWarningIcon className="size-3.5" aria-hidden /> Not verified
    </span>
  )
}

const refText = (r: LedgerRow) => (r.provider === "internal" ? r.reference : `#${r.reference}`)

function exportRows(rows: LedgerRow[], name: string) {
  downloadCsv(
    name,
    ["Date (UTC)", "Reference", "Brand", "Type", "Provider", "Amount (USD)", "Status", "Webhook"],
    rows.map((r) => [r.at, refText(r), r.brandName, txTypeLabel[r.type], providerName[r.provider], (r.amountUsd / 100).toFixed(2), txStatus(r).label, r.webhookVerified === null ? "Internal" : r.webhookVerified ? "Verified" : "Not verified"]),
    "NOCTURNE ledger transactions, sample data",
  )
}

/** Every money movement the ledger knows about, newest first. Read-only; failed and unverified events are flagged. */
export function TransactionsTab({ ready }: { ready: boolean }) {
  const router = useRouter()
  const phone = usePhone()
  const adjustments = useAdmin((s) => s.adjustments)
  const rows = useMemo(() => ledgerRows(adjustments), [adjustments])
  const types = [...new Set(rows.map((r) => r.type))]
  // Filters live in the URL (?type=&provider=&status=), like every tab, so a reload keeps them.
  const linkedType = useSearchParam("type")
  const linkedProvider = useSearchParam("provider")
  const linkedStatus = useSearchParam("status")
  const type = linkedType && (types as string[]).includes(linkedType) ? linkedType : "all"
  const provider = linkedProvider && PROVIDERS.includes(linkedProvider) ? linkedProvider : "all"
  const status: StatusFilter = linkedStatus && (STATUSES as string[]).includes(linkedStatus) ? (linkedStatus as StatusFilter) : "all"
  const setParam = (k: "type" | "provider" | "status", v: string) => writeParams({ [k]: v === "all" ? null : v })
  const setType = (v: string) => setParam("type", v)
  const setProvider = (v: string) => setParam("provider", v)
  const setStatus = (v: StatusFilter) => setParam("status", v)

  const flagged = rows.filter(isFlagged)
  // Say what this ledger actually holds, not every kind of entry a ledger could.
  const kinds = (["charge", "commission", "refund", "chargeback", "payout", "adjustment"] as const).filter((t) => (types as string[]).includes(t)).map((t) => ({ charge: "provider charges", commission: "commission", refund: "refunds", chargeback: "chargebacks", payout: "payouts", adjustment: "approved adjustments as their own entries" })[t])
  const holds = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : (kinds[0] ?? "nothing yet")
  const filtered = rows.filter((r) => {
    if (type !== "all" && r.type !== type) return false
    if (provider !== "all" && r.provider !== provider) return false
    if (status === "flagged") return isFlagged(r)
    return status === "all" || r.status === status
  })
  const clear = () => writeParams({ type: null, provider: null, status: null })

  const columns: Column<LedgerRow>[] = [
    {
      key: "at",
      header: "Date (UTC)",
      hideBelow: "md",
      sortValue: (r) => r.at,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <time dateTime={r.at} className="block text-ink-2 tabular">{formatDateTime(r.at)}</time>
          <span className="block text-[11px] text-ink-3">{relDays(r.at)}</span>
        </span>
      ),
    },
    {
      key: "ref",
      header: "Reference",
      sortValue: (r) => r.reference,
      cell: (r) => (
        <span className="block min-w-0">
          <CopyValue value={refText(r)} label="Copy reference" className="font-medium text-ink" />
          <span className="block max-w-[44vw] truncate text-[11.5px] text-ink-3 md:hidden">
            {txTypeLabel[r.type]}, {r.brandName}
            {r.status !== "succeeded" || r.type === "chargeback" ? <span className="sm:hidden">, {txStatus(r).label.toLowerCase()}</span> : null}
          </span>
          <time dateTime={r.at} className="block text-[11px] text-ink-3 tabular md:hidden">{formatDateTime(r.at)}</time>
        </span>
      ),
    },
    { key: "brand", header: "Brand", hideBelow: "md", sortValue: (r) => r.brandName, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.brandName}</span> },
    { key: "type", header: "Type", hideBelow: "md", sortValue: (r) => r.type, cell: (r) => <span className="whitespace-nowrap text-ink">{txTypeLabel[r.type]}</span> },
    { key: "provider", header: "Provider", hideBelow: "lg", sortValue: (r) => r.provider, cell: (r) => <span className="whitespace-nowrap text-ink-2">{providerName[r.provider]}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (r) => r.amountUsd,
      // A failed entry moved no money: shown unsigned and muted, never as a credit.
      cell: (r) =>
        r.status === "failed" ? (
          <span className="whitespace-nowrap text-ink-3">
            {usd(Math.abs(r.amountUsd))}
            <span className="sr-only">, not posted</span>
          </span>
        ) : (
          <span className={cn("whitespace-nowrap", r.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{signedUsd(r.amountUsd)}</span>
        ),
    },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (r) => txStatus(r).label, cell: (r) => <StatusBadge tone={txStatus(r).tone}>{txStatus(r).label}</StatusBadge> },
    { key: "webhook", header: "Webhook", hideBelow: "lg", cell: (r) => <Webhook row={r} /> },
  ]

  const rowActions: RowAction<LedgerRow>[] = [
    {
      label: "Copy reference",
      icon: CopyIcon,
      onSelect: (r) =>
        void navigator.clipboard.writeText(refText(r)).then(
          () => toast.success("Reference copied", { description: refText(r) }),
          () => toast.error("Couldn't reach the clipboard", { description: `Select ${refText(r)} and copy it by hand.` }),
        ),
    },
    { label: "Open the order", icon: ArrowSquareOutIcon, disabled: (r) => r.provider === "internal", onSelect: (r) => router.push(`/admin/orders?order=${orderIdOf(r.id)}`) },
  ]
  const bulkActions: BulkAction<LedgerRow>[] = [{ label: "Export as CSV", onSelect: (list) => exportRows(list, `nocturne-transactions-${list.length}.csv`) }]

  return (
    <div className="grid gap-3">
      {flagged.length ? (
        <div role="note" className="admin-inset flex flex-col gap-3 border-danger/30 bg-danger/[0.05] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-[12.5px] text-ink">
            <WarningIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <span>{plural(flagged.length, "transaction")} failed or arrived with an unverified webhook. Nothing unverified is posted to the ledger; confirm with the provider&apos;s verify API before anyone retries.</span>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => setStatus("flagged")} disabled={status === "flagged"}>
              Show flagged
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-10 sm:h-8">
              <Link href="/admin/health">Webhook failures</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <Panel title="Transactions" description={`${filtered.length} of ${rows.length} entries, newest first: ${holds}. Amounts in USD, times in UTC.`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <DataTable
          label="Ledger transactions"
          rows={filtered}
          columns={columns}
          getId={(r) => r.id}
          loading={!ready}
          search={{ placeholder: "Reference or brand", text: (r) => `${r.reference} ${r.brandName}` }}
          toolbar={
            <Filters
              noun="transactions"
              results={filtered.length}
              onClear={clear}
              filters={[
                { key: "type", label: "Type", value: type, onChange: setType, all: { value: "all", label: "All types" }, options: types.map((t) => ({ value: t, label: txTypeLabel[t] })), width: "w-[140px]" },
                { key: "provider", label: "Provider", value: provider, onChange: setProvider, all: { value: "all", label: "All providers" }, options: ["paystack", "flutterwave", "stripe", "internal"].map((p) => ({ value: p, label: providerName[p] })), width: "w-[148px]" },
                {
                  key: "status",
                  label: "Status",
                  value: status,
                  onChange: (v) => setStatus(v as StatusFilter),
                  all: { value: "all", label: "All statuses" },
                  options: [
                    { value: "flagged", label: "Failed or unverified" },
                    { value: "succeeded", label: "Completed" },
                    { value: "pending", label: "Pending" },
                    { value: "failed", label: "Failed" },
                  ],
                  width: "w-[180px]",
                },
              ]}
            />
          }
          rowActions={rowActions}
          bulkActions={phone ? undefined : bulkActions}
          empty={{ title: "No transactions match these filters", body: "Try another type, provider or status.", action: <Button size="sm" variant="secondary" onClick={clear}>Clear filters</Button> }}
          initialPageSize={25}
          minWidth={300}
        />
      </Panel>
    </div>
  )
}
