"use client"

import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { Segmented } from "@/components/admin/ui/segmented"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { currencies, type CurrencyCode } from "@/config/markets"
import { useSearchParam, writeParams } from "./table"
import { PayoutsLiveTab } from "./payouts-live-tab"
import { FinanceOperations } from "./finance-live-operations"
import { FinanceControls } from "./finance-live-controls"

type Tab = "overview" | "payouts" | "batches" | "ledger" | "adjustments" | "brands" | "reconciliation"
const options: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "payouts", label: "Payouts" },
  { value: "batches", label: "Batches" },
  { value: "ledger", label: "Ledger" },
  { value: "adjustments", label: "Adjustments" },
  { value: "brands", label: "Brand settings" },
  { value: "reconciliation", label: "Reconciliation" },
]
type Overview = {
  currencies: { currency: string; providerClearingMinor: number; commissionMinor: number; adjustmentsMinor: number; brandPendingMinor: number; brandAvailableMinor: number; brandReserveMinor: number; brandInPayoutMinor: number }[]
  payoutQueue: { status: string; currency: string; n: number; total: number }[]
}

export function FinanceLiveView() {
  const linkedTab = useSearchParam("tab")
  const focus = useSearchParam("focus")
  const tab: Tab = options.some((option) => option.value === linkedTab) ? linkedTab as Tab : "overview"
  const overview = useApi<Overview>("admin.finance.overview", () => api<Overview>("/api/admin/finance/overview"), { keepPrevious: false })

  function changeTab(next: Tab) {
    writeParams({ tab: next === "overview" ? null : next, focus: null, status: null, type: null, provider: null })
  }

  return (
    <div className="@container grid gap-3">
      <AdminPageHead title="Finance" description="Live balances, payout controls and ledger activity from the finance service." note="All amounts remain in their ledger currency. Sensitive finance actions require recent authenticator verification." />
      <div className="rail overflow-x-auto"><Segmented label="Finance sections" value={tab} onChange={(value) => changeTab(value as Tab)} options={options} /></div>
      {tab === "overview" ? (
        <section className="grid gap-3" aria-label="Finance overview">
          {overview.error ? <div role="alert" className="admin-inset grid gap-2 p-3"><p className="text-sm text-danger">{overview.error instanceof Error ? overview.error.message : "Couldn't load finance overview."}</p><button className="text-left text-sm text-ink-2" type="button" onClick={() => void overview.revalidate()}>Retry</button></div> : null}
          {(overview.data?.currencies ?? []).map((row) => <div key={row.currency} className="admin-panel grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <h2 className="col-span-2 text-sm font-medium text-ink sm:col-span-4">{row.currency}</h2>
            {[["Provider clearing", row.providerClearingMinor], ["Brand pending", row.brandPendingMinor], ["Brand available", row.brandAvailableMinor], ["Payouts in flight", row.brandInPayoutMinor], ["Brand reserve", row.brandReserveMinor], ["Commission", row.commissionMinor], ["Adjustments", row.adjustmentsMinor]].map(([label, amount]) => <p key={label} className="min-w-0 text-[11px] text-ink-3">{label}<span className="mt-1 block truncate text-sm tabular text-ink">{formatMoney(Number(amount), (row.currency in currencies ? row.currency : "USD") as CurrencyCode)}</span></p>)}
          </div>)}
          {overview.isLoading && !overview.data ? <div className="skeleton h-32 rounded-lg" aria-label="Loading finance overview" /> : null}
          {!overview.isLoading && !overview.error && !overview.data?.currencies.length ? <p className="text-sm text-ink-3">No ledger balances have been recorded yet.</p> : null}
        </section>
      ) : null}
      {tab === "payouts" ? <PayoutsLiveTab focus={focus} ready={!overview.isLoading} /> : null}
      {tab === "batches" || tab === "ledger" || tab === "adjustments" ? <FinanceOperations tab={tab} /> : null}
      {tab === "brands" || tab === "reconciliation" ? <FinanceControls tab={tab} /> : null}
    </div>
  )
}