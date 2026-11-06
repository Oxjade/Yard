"use client"

import { ScalesIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/admin/ui/panel"
import { RevealItem } from "@/components/admin/ui/motion"
import { reconciliation, type ReconciliationRow } from "@/lib/data/admin"
import { useAdmin, type AdjustmentRequest } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { PLATFORM_ACCOUNT } from "./derive"
import { formatDay, plural, providerName, signedUsd, usd } from "./format"
import { reconMeta } from "./meta"

export type AdjustmentPrefill = { account: string; direction: "credit" | "debit"; amount: string; reason: string }

const PROVIDERS = ["paystack", "flutterwave", "stripe"] as const

/** The reason prefix that ties an adjustment request back to the reconciliation exception it resolves. */
export const reconKey = (r: ReconciliationRow) => `Reconciliation ${providerName[r.provider]} ${r.date}`
const rowId = (r: ReconciliationRow) => `${r.provider}-${r.date}`

const raisedMeta: Record<AdjustmentRequest["status"], { label: string; tone: "success" | "info" | "muted" }> = {
  approved: { label: "Adjustment posted", tone: "success" },
  pending: { label: "Adjustment requested", tone: "info" },
  rejected: { label: "Adjustment rejected", tone: "muted" },
}

/**
 * The daily three-way check, ledger against provider, per provider and day. A mismatch is never
 * fixed in place: it is resolved with an adjustment request that a second admin approves.
 */
export function ReconciliationTab({ onRaise, ready }: { onRaise: (prefill: AdjustmentPrefill) => void; ready: boolean }) {
  const adjustments = useAdmin((s) => s.adjustments)
  const rows = [...reconciliation].sort((a, b) => b.date.localeCompare(a.date) || a.provider.localeCompare(b.provider))
  const mismatches = rows.filter((r) => r.status === "mismatch")
  const raised = (r: ReconciliationRow) => adjustments.find((a) => a.reason.startsWith(reconKey(r)))

  function raise(r: ReconciliationRow) {
    const diff = r.ledgerUsd - r.providerUsd
    onRaise({
      account: PLATFORM_ACCOUNT,
      direction: diff > 0 ? "debit" : "credit",
      amount: (Math.abs(diff) / 100).toFixed(2),
      reason: `${reconKey(r)}: the ledger shows ${usd(r.ledgerUsd)}, ${providerName[r.provider]} reported ${usd(r.providerUsd)}. Move the ${usd(Math.abs(diff))} difference to suspense until the provider explains it.`,
    })
  }

  const diffCell = (r: ReconciliationRow) => {
    if (r.status === "pending") return <span className="whitespace-nowrap text-ink-3">Not yet</span>
    const d = r.providerUsd - r.ledgerUsd
    return d === 0 ? <span className="whitespace-nowrap text-ink-3">{usd(0)}</span> : <span className="font-medium whitespace-nowrap text-danger">{signedUsd(d)}</span>
  }

  const resolution = (r: ReconciliationRow, phone = false) => {
    if (r.status !== "mismatch") return <span className="text-[11.5px] whitespace-nowrap text-ink-3">{r.status === "pending" ? "Waiting for the report" : "Nothing to do"}</span>
    const a = raised(r)
    if (a) return <StatusBadge tone={raisedMeta[a.status].tone}>{raisedMeta[a.status].label}</StatusBadge>
    return (
      <Button type="button" size={phone ? "sm" : "xs"} variant="secondary" className={phone ? "h-10" : undefined} onClick={() => raise(r)}>
        <ScalesIcon /> Raise adjustment
      </Button>
    )
  }

  const columns: Column<ReconciliationRow>[] = [
    {
      key: "date",
      header: "Day",
      sortValue: (r) => r.date,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{formatDay(r.date)}</span>
          <span className="block max-w-[32vw] truncate text-[11.5px] text-ink-3 md:hidden">
            {providerName[r.provider]}
            <span className="sm:hidden">, {reconMeta[r.status].label.toLowerCase()}</span>
          </span>
          {/* Phones hide the Resolution column, so a mismatch carries its resolution here. */}
          {r.status === "mismatch" ? <span className="mt-1.5 block md:hidden">{resolution(r, true)}</span> : null}
        </span>
      ),
    },
    { key: "provider", header: "Provider", hideBelow: "md", sortValue: (r) => r.provider, cell: (r) => <span className="whitespace-nowrap text-ink-2">{providerName[r.provider]}</span> },
    { key: "ledger", header: "Ledger", align: "right", hideBelow: "lg", sortValue: (r) => r.ledgerUsd, cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.ledgerUsd)}</span> },
    { key: "provider-total", header: "Provider report", align: "right", hideBelow: "lg", cell: (r) => (r.status === "pending" ? <span className="whitespace-nowrap text-ink-3">Not received</span> : <span className="whitespace-nowrap text-ink">{usd(r.providerUsd)}</span>) },
    { key: "diff", header: "Difference", align: "right", sortValue: (r) => Math.abs(r.providerUsd - r.ledgerUsd), cell: diffCell },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (r) => r.status, cell: (r) => <StatusBadge tone={reconMeta[r.status].tone}>{reconMeta[r.status].label}</StatusBadge> },
    { key: "resolution", header: "Resolution", hideBelow: "md", cell: (r) => resolution(r) },
  ]

  return (
    <div className="grid gap-3">
      <section aria-label="Reconciliation by provider" className="grid gap-3 @2xl:grid-cols-3">
        {PROVIDERS.map((p) => {
          const days = rows.filter((r) => r.provider === p).sort((a, b) => a.date.localeCompare(b.date))
          const bad = days.filter((r) => r.status === "mismatch")
          const settled = days.filter((r) => r.status !== "pending").length
          const matched = days.filter((r) => r.status === "matched").length
          return (
            <RevealItem key={p} className={cn("admin-panel rounded-[20px] p-4 md:p-5", bad.length && "admin-panel-attention")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-label text-[13px] text-ink">{providerName[p]}</h3>
                <StatusBadge tone={bad.length ? "danger" : "success"}>{bad.length ? plural(bad.length, "mismatch", "mismatches") : "In balance"}</StatusBadge>
              </div>
              <p className="mt-4 font-metric text-[1.75rem] text-ink">
                {matched}
                <span className="text-ink-3"> of {settled}</span>
              </p>
              <p className="mt-1 text-[12px] text-ink-3">{bad.length ? `Settled days matched, ${usd(bad.reduce((s, r) => s + Math.abs(r.ledgerUsd - r.providerUsd), 0))} unexplained` : "Settled days matched"}</p>
              <ol className="mt-4 flex gap-1" aria-label={`${providerName[p]}, last ${days.length} days`}>
                {days.map((r) => (
                  <li key={r.date} title={`${formatDay(r.date)}: ${reconMeta[r.status].label}`} className={cn("h-1.5 flex-1 rounded-full", r.status === "matched" ? "bg-purple" : r.status === "mismatch" ? "bg-danger" : "border border-white/15 bg-transparent")}>
                    <span className="sr-only">{`${formatDay(r.date)}: ${reconMeta[r.status].label}`}</span>
                  </li>
                ))}
              </ol>
            </RevealItem>
          )
        })}
      </section>

      <Panel title="Daily reconciliation" description={`Ledger against each provider's settlement report, by day, in USD. ${mismatches.length ? `${plural(mismatches.length, "mismatch", "mismatches")} to resolve with an adjustment.` : "Everything settled is in balance."}`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <DataTable label="Daily reconciliation" rows={rows} columns={columns} getId={rowId} loading={!ready} empty={{ title: "No settlement days yet", body: "Each provider's daily report is checked against the ledger here." }} pageSizes={[15, 30]} initialPageSize={15} minWidth={300} />
      </Panel>
    </div>
  )
}
