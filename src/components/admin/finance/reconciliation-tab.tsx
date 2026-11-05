"use client"

import { ScalesIcon as Scale } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { reconciliation, type ReconciliationRow } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { PLATFORM_ACCOUNT } from "./derive"
import { formatDay, plural, providerName, signedUsd, usd } from "./format"
import { reconMeta } from "./meta"
import { AdminTable, TablePanel, type Column } from "./table"

export type AdjustmentPrefill = { account: string; direction: "credit" | "debit"; amount: string; reason: string }

const PROVIDERS = ["paystack", "flutterwave", "stripe"] as const

/** The reason prefix that ties an adjustment request back to the reconciliation exception it resolves. */
export const reconKey = (r: ReconciliationRow) => `Reconciliation ${providerName[r.provider]} ${r.date}`

/**
 * The daily three-way check, ledger against provider, per provider and day. A mismatch is never
 * fixed in place: it is resolved with an adjustment request that a second admin approves.
 */
export function ReconciliationTab({ onRaise }: { onRaise: (prefill: AdjustmentPrefill) => void }) {
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

  const actionCell = (r: ReconciliationRow) => {
    if (r.status !== "mismatch") return <span className="text-[11px] whitespace-nowrap text-ink-3">{r.status === "pending" ? "Nothing to do yet" : "Nothing to do"}</span>
    const a = raised(r)
    if (a) return <StatusBadge tone={a.status === "approved" ? "success" : a.status === "pending" ? "info" : "muted"}>{a.status === "approved" ? "Adjustment posted" : a.status === "pending" ? "Adjustment requested" : "Adjustment rejected"}</StatusBadge>
    return (
      <Button type="button" size="xs" variant="secondary" onClick={() => raise(r)}>
        <Scale /> Raise adjustment
      </Button>
    )
  }

  const columns: Column<ReconciliationRow>[] = [
    { key: "date", header: "Day", cell: (r) => <span className="whitespace-nowrap text-ink">{formatDay(r.date)}</span> },
    { key: "provider", header: "Provider", cell: (r) => <span className="whitespace-nowrap text-ink-2">{providerName[r.provider]}</span> },
    { key: "ledger", header: "Ledger", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.ledgerUsd)}</span> },
    { key: "provider-total", header: "Provider report", align: "right", cell: (r) => (r.status === "pending" ? <span className="whitespace-nowrap text-ink-3">Not received</span> : <span className="whitespace-nowrap text-ink">{usd(r.providerUsd)}</span>) },
    { key: "diff", header: "Difference", align: "right", cell: diffCell },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={reconMeta[r.status].tone}>{reconMeta[r.status].label}</StatusBadge> },
    { key: "action", header: "Resolution", align: "right", cell: actionCell },
  ]

  return (
    <div className="grid gap-5">
      <section aria-label="Reconciliation by provider" className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const days = rows.filter((r) => r.provider === p).sort((a, b) => a.date.localeCompare(b.date))
          const bad = days.filter((r) => r.status === "mismatch")
          const matched = days.filter((r) => r.status === "matched").length
          return (
            <div key={p} className={cn("rounded-lg border bg-card p-3", bad.length ? "border-acid/30" : "border-line-soft")}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-ink">{providerName[p]}</p>
                <StatusBadge tone={bad.length ? "danger" : "success"}>{bad.length ? plural(bad.length, "mismatch", "mismatches") : "In balance"}</StatusBadge>
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                {matched} of {days.filter((r) => r.status !== "pending").length} settled days matched
                {bad.length ? `, ${usd(bad.reduce((s, r) => s + Math.abs(r.ledgerUsd - r.providerUsd), 0))} unexplained` : ""}
              </p>
              <ol className="mt-3 flex gap-1" aria-label={`${providerName[p]}, last ${days.length} days`}>
                {days.map((r) => (
                  <li key={r.date} title={`${formatDay(r.date)}: ${reconMeta[r.status].label}`} className={cn("h-1.5 flex-1 rounded-full", r.status === "matched" ? "bg-purple" : r.status === "mismatch" ? "bg-danger" : "border border-line bg-transparent")}>
                    <span className="sr-only">{`${formatDay(r.date)}: ${reconMeta[r.status].label}`}</span>
                  </li>
                ))}
              </ol>
            </div>
          )
        })}
      </section>

      <TablePanel
        id="recon-title"
        title="Daily reconciliation"
        description={`Ledger against each provider's settlement report, by day. ${mismatches.length ? `${plural(mismatches.length, "mismatch", "mismatches")} to resolve with an adjustment.` : "Everything settled is in balance."}`}
      >
        <AdminTable
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.provider}-${r.date}`}
          caption="Daily reconciliation"
          minWidth={860}
          rowClassName={(r) => r.status === "mismatch" && "bg-acid/[0.05]"}
          mobileRow={(r) => ({
            title: (
              <>
                {formatDay(r.date)} <span className="text-ink-2">{providerName[r.provider]}</span>
              </>
            ),
            meta: r.status === "pending" ? `Ledger ${usd(r.ledgerUsd)}, report not received` : `Ledger ${usd(r.ledgerUsd)}, provider ${usd(r.providerUsd)}`,
            trail: (
              <>
                {r.status === "mismatch" ? <span className="text-[13px] font-medium text-danger tabular">{signedUsd(r.providerUsd - r.ledgerUsd)}</span> : null}
                <StatusBadge tone={reconMeta[r.status].tone}>{reconMeta[r.status].label}</StatusBadge>
              </>
            ),
            footer: r.status === "mismatch" ? <div className="flex justify-end">{actionCell(r)}</div> : undefined,
          })}
        />
      </TablePanel>
    </div>
  )
}
