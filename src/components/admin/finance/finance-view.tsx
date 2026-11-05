"use client"

import { useMemo, useState } from "react"
import { LockIcon as Lock } from "@phosphor-icons/react"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { adminUser, disputes, reconciliation } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { AdjustmentsTab } from "./adjustments-tab"
import { CommissionTab } from "./commission-tab"
import { commissionReport, disputeStage } from "./derive"
import { DisputesTab } from "./disputes-tab"
import { FinanceTabs, type FinanceTab } from "./finance-tabs"
import { dueLabel, plural, usd, usdShort } from "./format"
import { PayoutsTab } from "./payouts-tab"
import { ReconciliationTab, type AdjustmentPrefill } from "./reconciliation-tab"
import { RefundsTab } from "./refunds-tab"
import { useSearchParam, writeParams } from "./table"
import { TransactionsTab } from "./transactions-tab"

type TabKey = "transactions" | "payouts" | "refunds" | "disputes" | "reconciliation" | "adjustments" | "commission"
const KEYS: TabKey[] = ["transactions", "payouts", "refunds", "disputes", "reconciliation", "adjustments", "commission"]
const isTab = (v: string | null): v is TabKey => !!v && (KEYS as string[]).includes(v)

const n = (v: number) => formatNumber(Math.round(v))

export function FinanceView() {
  const payouts = useAdmin((s) => s.payouts)
  const refunds = useAdmin((s) => s.refunds)
  const adjustments = useAdmin((s) => s.adjustments)
  const audit = useAdmin((s) => s.audit)
  const [picked, setPicked] = useState<TabKey | null>(null)
  const [prefill, setPrefill] = useState<{ value: AdjustmentPrefill; key: number } | null>(null)

  // Other screens link here as /admin/finance?tab=refunds&focus=rf_…. The link decides the
  // first view; once the admin picks a tab, their choice wins and the focus is dropped.
  const linkedTab = useSearchParam("tab")
  const linkedFocus = useSearchParam("focus")
  const tab: TabKey = picked ?? (isTab(linkedTab) ? linkedTab : "transactions")
  const focus = picked ? null : linkedFocus

  function changeTab(t: TabKey) {
    setPicked(t)
    writeParams({ tab: t === "transactions" ? null : t, focus: null })
  }

  const toApprove = payouts.filter((p) => p.status === "awaiting_approval")
  const held = payouts.filter((p) => p.status === "held")
  const requested = refunds.filter((r) => r.status === "requested")
  const needEvidence = disputes.filter((d) => disputeStage(d, audit) === "needs_evidence").sort((a, b) => a.dueBy.localeCompare(b.dueBy))
  const mismatches = reconciliation.filter((r) => r.status === "mismatch")
  const pendingAdj = adjustments.filter((a) => a.status === "pending")
  const forMe = pendingAdj.filter((a) => a.requestedBy !== adminUser.name)
  const commission30 = useMemo(() => commissionReport(30).reduce((s, r) => s + r.netUsd, 0), [])

  const tabs: FinanceTab<TabKey>[] = [
    { value: "transactions", label: "Transactions" },
    { value: "payouts", label: "Payouts", count: toApprove.length + held.length, urgent: true },
    { value: "refunds", label: "Refunds", count: requested.length, urgent: true },
    { value: "disputes", label: "Disputes", count: needEvidence.length, urgent: true },
    { value: "reconciliation", label: "Reconciliation", count: mismatches.length, urgent: true },
    { value: "adjustments", label: "Adjustments", count: pendingAdj.length, urgent: forMe.length > 0 },
    { value: "commission", label: "Commission" },
  ]

  return (
    <div className="grid gap-5">
      <PageHeader title="Finance" description="Money in, money out and the checks between them: provider transactions, brand payouts, refunds, disputes, reconciliation and commission.">
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
          The ledger is append-only: nothing here edits a recorded amount, and every correction is a new entry approved by a second admin.
        </p>
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Finance figures" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <MetricTile density="dense" label="Payouts to approve" value={toApprove.reduce((s, p) => s + p.amountUsd, 0)} format={usdShort} hint={plural(toApprove.length, "payout")} highlight={toApprove.length > 0} />
        <MetricTile density="dense" label="Held payouts" value={held.reduce((s, p) => s + p.amountUsd, 0)} format={usdShort} hint={plural(held.length, "brand")} />
        <MetricTile density="dense" label="Refunds to decide" value={requested.length} format={n} hint={usd(requested.reduce((s, r) => s + r.amountUsd, 0))} highlight={requested.length > 0} />
        <MetricTile density="dense" label="Evidence due" value={needEvidence.length} format={n} hint={needEvidence[0] ? `next ${dueLabel(needEvidence[0].dueBy).toLowerCase()}` : "nothing due"} highlight={needEvidence.length > 0} />
        <MetricTile density="dense" label="Unreconciled" value={mismatches.reduce((s, r) => s + Math.abs(r.ledgerUsd - r.providerUsd), 0)} format={usd} hint={plural(mismatches.length, "mismatch", "mismatches")} highlight={mismatches.length > 0} />
        <MetricTile density="dense" label="Commission, 30 days" value={commission30} format={usdShort} hint="net of refunds" />
      </section>

      <FinanceTabs tabs={tabs} value={tab} onValueChange={changeTab}>
        {tab === "transactions" ? <TransactionsTab /> : null}
        {tab === "payouts" ? <PayoutsTab focus={focus} /> : null}
        {tab === "refunds" ? <RefundsTab key={focus ?? "refunds"} focus={focus} /> : null}
        {tab === "disputes" ? <DisputesTab focus={focus} /> : null}
        {tab === "reconciliation" ? (
          <ReconciliationTab
            onRaise={(value) => {
              setPrefill((p) => ({ value, key: (p?.key ?? 0) + 1 }))
              changeTab("adjustments")
            }}
          />
        ) : null}
        {tab === "adjustments" ? <AdjustmentsTab prefill={prefill?.value} prefillKey={prefill?.key} onPrefillUsed={() => setPrefill(null)} /> : null}
        {tab === "commission" ? <CommissionTab /> : null}
      </FinanceTabs>
    </div>
  )
}
