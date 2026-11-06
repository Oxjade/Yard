"use client"

import { useId, useState } from "react"
import { GavelIcon, HourglassIcon, LockIcon, ArrowCounterClockwiseIcon, ScalesIcon } from "@phosphor-icons/react"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { adminUser, reconciliation } from "@/lib/data/admin"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { AdminPageHead, PanelRail, StatRow } from "../marketplace/page-head"
import { AdjustmentsTab } from "./adjustments-tab"
import { CommissionTab } from "./commission-tab"
import { disputeStage } from "./derive"
import { DisputesTab } from "./disputes-tab"
import { dueLabel, plural, usd, usdShort } from "./format"
import { PayoutsTab } from "./payouts-tab"
import { ReconciliationTab, type AdjustmentPrefill } from "./reconciliation-tab"
import { RefundsTab } from "./refunds-tab"
import { InPageLinks, useAdminReady, useSearchParam, writeParams } from "./table"
import { TransactionsTab } from "./transactions-tab"

type TabKey = "transactions" | "payouts" | "refunds" | "disputes" | "reconciliation" | "adjustments" | "commission"
const KEYS: TabKey[] = ["transactions", "payouts", "refunds", "disputes", "reconciliation", "adjustments", "commission"]
const isTab = (v: string | null): v is TabKey => !!v && (KEYS as string[]).includes(v)

const n = (v: number) => formatNumber(Math.round(v))

export function FinanceView() {
  const ready = useAdminReady()
  const qid = useId()
  const payouts = useAdmin((s) => s.payouts)
  const refunds = useAdmin((s) => s.refunds)
  const adjustments = useAdmin((s) => s.adjustments)
  const disputes = useAdmin((s) => s.disputes)
  const audit = useAdmin((s) => s.audit)
  const [prefill, setPrefill] = useState<{ value: AdjustmentPrefill; key: number } | null>(null)

  // Other screens link here as /admin/finance?tab=refunds&focus=rf_…; the tab and the linked
  // record live in the URL, so a reload or a shared link reopens the same view.
  const linkedTab = useSearchParam("tab")
  const focus = useSearchParam("focus")
  const tab: TabKey = isTab(linkedTab) ? linkedTab : "transactions"

  // Each tab keeps its filters in the URL too; they're its own, so a new tab starts clear.
  function changeTab(t: TabKey) {
    writeParams({ tab: t === "transactions" ? null : t, focus: null, status: null, type: null, provider: null })
  }

  const toApprove = payouts.filter((p) => p.status === "awaiting_approval")
  const held = payouts.filter((p) => p.status === "held")
  const requested = refunds.filter((r) => r.status === "requested")
  const needEvidence = disputes.filter((d) => disputeStage(d, audit) === "needs_evidence").sort((a, b) => a.dueBy.localeCompare(b.dueBy))
  const mismatches = reconciliation.filter((r) => r.status === "mismatch")
  const unexplained = mismatches.reduce((s, r) => s + Math.abs(r.ledgerUsd - r.providerUsd), 0)
  const pendingAdj = adjustments.filter((a) => a.status === "pending")
  const forMe = pendingAdj.filter((a) => a.requestedBy !== adminUser.name)

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "transactions", label: "Transactions" },
    { value: "payouts", label: "Payouts", count: toApprove.length + held.length },
    { value: "refunds", label: "Refunds", count: requested.length },
    { value: "disputes", label: "Disputes", count: needEvidence.length },
    { value: "reconciliation", label: "Reconciliation", count: mismatches.length },
    { value: "adjustments", label: "Adjustments", count: forMe.length },
    { value: "commission", label: "Commission" },
  ]

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Finance"
        description="Money in, money out and the checks between them: provider transactions, brand payouts, refunds, disputes, reconciliation and commission."
        note={
          <>
            <span className="flex items-start gap-1.5 text-ink-2">
              <LockIcon className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
              The ledger is append-only: nothing here edits a recorded amount, and every correction is a new entry approved by a second admin.
            </span>
            <span className="mt-1.5 block">No payments provider is connected in this build. Approving a payout or a refund records the decision with your reason; nothing is sent, and nothing is marked completed until a provider confirms it.</span>
          </>
        }
      />

      <InPageLinks>
        <StatRow label="Finance figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && toApprove.length ? "brand" : "default"} icon={HourglassIcon} label="Payout approvals" value={toApprove.reduce((s, p) => s + p.amountUsd, 0)} format={usdShort} hint={ready ? `${plural(toApprove.length, "payout")}, ${held.length} held` : undefined} href="/admin/finance?tab=payouts#finance-sections" hrefLabel="Open payouts" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ArrowCounterClockwiseIcon} label="Refunds to decide" value={requested.length} format={n} hint={ready ? `${usd(requested.reduce((s, r) => s + r.amountUsd, 0))} requested` : undefined} href="/admin/finance?tab=refunds#finance-sections" hrefLabel="Open refunds" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={GavelIcon} label="Evidence due" value={needEvidence.length} format={n} hint={ready ? (needEvidence[0] ? `Next ${dueLabel(needEvidence[0].dueBy).toLowerCase()}` : "Nothing due") : undefined} href="/admin/finance?tab=disputes#finance-sections" hrefLabel="Open disputes" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ScalesIcon} label="Unreconciled" value={unexplained} format={usd} hint={plural(mismatches.length, "mismatch", "mismatches")} href="/admin/finance?tab=reconciliation#finance-sections" hrefLabel="Open reconciliation" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <RevealItem as="section" id="finance-sections" aria-label="Finance sections" className="grid min-w-0 scroll-mt-24 gap-3 pt-3">
        <PanelRail className="-mx-4 px-4 pb-0 md:px-4 @lg:-mx-1 @lg:px-1" value={tab}>
          <Segmented label="Finance sections" value={tab} onChange={changeTab} loading={!ready} idBase={qid} panelId={`${qid}-panel`} options={tabs} />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="min-w-0">
          {tab === "transactions" ? <TransactionsTab ready={ready} /> : null}
          {tab === "payouts" ? <PayoutsTab focus={focus} ready={ready} /> : null}
          {tab === "refunds" ? <RefundsTab focus={focus} ready={ready} /> : null}
          {tab === "disputes" ? <DisputesTab focus={focus} ready={ready} /> : null}
          {tab === "reconciliation" ? (
            <ReconciliationTab
              ready={ready}
              onRaise={(value) => {
                setPrefill((p) => ({ value, key: (p?.key ?? 0) + 1 }))
                changeTab("adjustments")
              }}
            />
          ) : null}
          {tab === "adjustments" ? <AdjustmentsTab ready={ready} prefill={prefill?.value} prefillKey={prefill?.key} onPrefillUsed={() => setPrefill(null)} /> : null}
          {tab === "commission" ? <CommissionTab /> : null}
        </div>
      </RevealItem>
    </Reveal>
  )
}
