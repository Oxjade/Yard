"use client"

import Link from "next/link"
import { ArrowSquareOutIcon, ArrowClockwiseIcon } from "@phosphor-icons/react"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel, PanelError, PanelSkeleton } from "@/components/admin/ui/panel"
import { Button } from "@/components/ui/button"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import type { BachsAdminView, BachsDisputeRow, BachsMoney, BachsPaymentRow, BachsPayoutRow, BachsRefundRow, OrderLink, ReconLine, Section, StoredEvent } from "@/server/payments/bachs-admin-core"

/**
 * Admin › Finance › Bachs: what the Bachs dashboard shows, read from the Bachs API by the server
 * (GET /api/admin/finance/bachs; cached there for a minute). READ-ONLY: there is no withdrawal,
 * transfer or refund action here. Disputes are answered in the Bachs dashboard.
 */
type Connected = Extract<BachsAdminView, { connected: true }>
type Tone = "muted" | "info" | "attention" | "success" | "danger"

const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "UTC" })
const when = (v: string | null) => (v ? `${time.format(new Date(v))}` : "—")
const minorMoney = (minor: number, currency: string) => (currency in currencies ? formatMoney(minor, currency as CurrencyCode) : `${(minor / 100).toFixed(2)} ${currency}`)
/** Minor units when Yard can read them, else the decimal Bachs sent with its currency code. */
const bm = (m: BachsMoney) => (m.minor !== null && m.currency ? minorMoney(m.minor, m.currency) : m.amount ? `${m.amount}${m.currency ? ` ${m.currency}` : ""}` : "—")
const words = (v: string) => v.replaceAll("_", " ")

const paymentTone: Record<string, Tone> = { succeeded: "success", overpaid: "success", accepted: "attention", underpaid: "attention", processing: "info", created: "muted", failed: "danger", expired: "muted", cancelled: "muted", refunded: "muted", partially_refunded: "attention", auto_refunded: "muted" }
const refundTone: Record<string, Tone> = { success: "success", processing: "info", failed: "danger" }
const disputeTone: Record<string, Tone> = { needs_response: "danger", under_review: "info", won: "success", lost: "danger", closed: "muted" }
const payoutTone: Record<string, Tone> = { completed: "success", processing: "info", pending: "info", failed: "danger" }
const eventTone: Record<string, Tone> = { processed: "success", ignored: "muted", received: "info", failed: "danger" }
const reconTone: Record<ReconLine["status"], Tone> = { match: "success", mismatch: "attention", shortfall: "danger", not_held: "muted", unavailable: "muted" }
const reconLabel: Record<ReconLine["status"], string> = { match: "Matches", mismatch: "Mismatch", shortfall: "Shortfall", not_held: "Not held by Bachs", unavailable: "Not compared" }

function Orders({ links }: { links: OrderLink[] }) {
  if (!links.length) return <span className="text-ink-3">No Yard order</span>
  return (
    <span className="flex flex-wrap gap-x-2">
      {links.slice(0, 3).map((o) => (
        <Link key={o.id} href={`/admin/orders?order=${encodeURIComponent(o.id)}`} className="font-medium text-ink hover:text-violet">
          #{o.reference}
        </Link>
      ))}
      {links.length > 3 ? <span className="text-ink-3">+{links.length - 3}</span> : null}
    </span>
  )
}

function SectionError<T>({ section, retry }: { section: Section<T>; retry: () => void }) {
  return section.ok ? null : <PanelError message={section.error.message} onRetry={retry} />
}

const asOf = (s: { fetchedAt: string }) => `From Bachs at ${clock.format(new Date(s.fetchedAt))} UTC`

export function BachsLiveTab() {
  const view = useApi<BachsAdminView>("admin.finance.bachs", () => api<BachsAdminView>("/api/admin/finance/bachs"), { keepPrevious: true })
  const retry = () => void view.revalidate()
  if (view.error && !view.data) return <PanelError message={errorMessage(view.error, "Couldn't load the Bachs view. Finance is otherwise unaffected.")} onRetry={retry} />
  if (!view.data)
    return (
      <div className="grid gap-3" aria-busy="true">
        <span className="sr-only">Loading Bachs</span>
        <PanelSkeleton className="h-24" />
        <PanelSkeleton className="h-48" />
        <PanelSkeleton className="h-72" />
      </div>
    )
  const v = view.data
  if (!v.connected)
    return (
      <Panel title="Bachs isn't connected" description="Nothing is read from Bachs on this deployment." className="rounded-[20px]">
        <p className="text-sm text-ink-2">{v.message}</p>
      </Panel>
    )
  return (
    <section className="grid gap-3" aria-label="Bachs">
      <ConnectionPanel v={v} refreshing={view.isValidating} onRefresh={retry} />
      <BalancesPanel v={v} retry={retry} />
      <PaymentsPanel v={v} retry={retry} />
      <DisputesPanel v={v} retry={retry} />
      <RefundsPanel v={v} retry={retry} />
      <WebhooksPanel v={v} />
      <PayoutsPanel v={v} retry={retry} />
    </section>
  )
}

function Fact({ label, children, tone }: { label: string; children: React.ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-ink-3">{label}</p>
      <div className="mt-1 text-sm text-ink">{tone ? <StatusBadge tone={tone}>{children}</StatusBadge> : children}</div>
    </div>
  )
}

function ConnectionPanel({ v, refreshing, onRefresh }: { v: Connected; refreshing: boolean; onRefresh: () => void }) {
  const c = v.connection
  const account = v.account.ok ? v.account.data : null
  return (
    <Panel
      title="Connection"
      description={`Read-only. Bachs answers are kept for a minute; last read ${clock.format(new Date(v.generatedAt))} UTC. The key is never shown.`}
      className="rounded-[20px]"
      action={
        <Button size="sm" variant="ghost" type="button" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 @4xl:grid-cols-5">
        <Fact label="Key" tone={c.environment === "live" ? "info" : "attention"}>{c.environment === "live" ? "Live key" : "Sandbox key"}</Fact>
        <Fact label="API">{c.apiHost}</Fact>
        <Fact label="Key status" tone={c.key === "valid" ? "success" : c.key === "invalid" ? "danger" : "muted"}>{c.key === "valid" ? "Valid" : c.key === "invalid" ? "Refused" : "Unknown"}</Fact>
        <Fact label="Account" tone={c.account === "active" ? "success" : c.account === "unknown" ? "muted" : "danger"}>{c.account === "active" ? "Active" : c.account === "not_activated" ? "Not activated" : c.account === "deactivated" ? "Deactivated" : "Unknown"}</Fact>
        <Fact label="Webhook secret" tone={c.webhookSecretSet ? "success" : "danger"}>{c.webhookSecretSet ? "Set" : "Missing"}</Fact>
      </div>
      <ul className="mt-3 grid gap-1 text-[12px] text-ink-2">
        {account ? <li>{[account.name, account.id, account.country].filter(Boolean).join(" · ")}{account.balanceCurrencies.length ? ` · holds ${account.balanceCurrencies.join(", ")}` : ""}{account.enabledMethods.length ? ` · methods ${account.enabledMethods.join(", ")}` : ""}</li> : null}
        <li>{c.keyNote}</li>
        <li className={c.account === "active" ? undefined : "text-danger"}>{c.accountNote}</li>
      </ul>
    </Panel>
  )
}

function Amount({ label, minor, currency, strong }: { label: string; minor: number | null; currency: string; strong?: boolean }) {
  return (
    <p className="min-w-0 text-[11px] text-ink-3">
      {label}
      <span className={`mt-1 block truncate tabular ${strong ? "text-base text-ink" : "text-sm text-ink"}`}>{minor === null ? "—" : minorMoney(minor, currency)}</span>
    </p>
  )
}

function BalancesPanel({ v, retry }: { v: Connected; retry: () => void }) {
  const flagged = v.reconciliation.filter((l) => l.status === "mismatch" || l.status === "shortfall")
  const settlements = v.balances.ok ? v.balances.data.pendingSettlements : null
  return (
    <Panel
      title="Balance and reconciliation"
      description="Bachs' live balance next to Yard's ledger. The ledger's money at Bachs is what Yard owes brands plus Yard's commission and adjustments; any difference is flagged."
      className="rounded-[20px]"
      attention={flagged.length > 0}
      action={flagged.length ? <StatusBadge tone={flagged.some((l) => l.status === "shortfall") ? "danger" : "attention"}>{flagged.length === 1 ? "1 mismatch" : `${flagged.length} mismatches`}</StatusBadge> : v.balances.ok ? <StatusBadge tone="success">Reconciled</StatusBadge> : null}
    >
      <div className="grid gap-3">
        <SectionError section={v.balances} retry={retry} />
        {v.reconciliation.map((l) => (
          <article key={l.currency} className="admin-inset grid gap-3 p-3" aria-label={`${l.currency} reconciliation`}>
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-ink">{l.currency}</h3>
              <StatusBadge tone={reconTone[l.status]}>{reconLabel[l.status]}</StatusBadge>
            </header>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Amount label="Bachs available" minor={l.bachs?.availableMinor ?? null} currency={l.currency} />
              <Amount label="Bachs pending" minor={l.bachs?.pendingMinor ?? null} currency={l.currency} />
              <Amount label="Bachs total" minor={l.bachs?.totalMinor ?? null} currency={l.currency} strong />
              <Amount label="Ledger: money at Bachs" minor={l.ledger.atProviderMinor} currency={l.currency} strong />
              <Amount label="Yard owes brands" minor={l.ledger.owedToBrandsMinor} currency={l.currency} />
              <Amount label="Yard's commission" minor={l.ledger.commissionMinor} currency={l.currency} />
              <Amount label="Adjustments" minor={l.ledger.adjustmentsMinor} currency={l.currency} />
              <Amount label="Difference (Bachs − ledger)" minor={l.differenceMinor} currency={l.currency} strong />
            </div>
            <p className={`text-[12px] ${l.status === "shortfall" ? "text-danger" : "text-ink-2"}`}>
              {l.bachs ? `Bachs ${minorMoney(l.bachs.totalMinor, l.currency)} vs Yard owes brands ${minorMoney(l.ledger.owedToBrandsMinor, l.currency)} + commission ${minorMoney(l.ledger.commissionMinor, l.currency)}${l.ledger.adjustmentsMinor ? ` + adjustments ${minorMoney(l.ledger.adjustmentsMinor, l.currency)}` : ""}. ` : ""}
              {l.message}
            </p>
            {l.note ? <p className="text-[12px] text-ink-3">{l.note}</p> : null}
          </article>
        ))}
        {v.balances.ok ? (
          <p className="text-[12px] text-ink-3">
            {asOf(v.balances)}. Everything Bachs holds, in USD: {v.balances.data.totalUsd ?? "—"}.{" "}
            {settlements?.count ? `${settlements.count} settlement day${settlements.count === 1 ? "" : "s"} pending: ${settlements.days.map((d) => [d.date, d.summary].filter(Boolean).join(" ")).join("; ")}.` : "No settlements pending."}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

function PaymentsPanel({ v, retry }: { v: Connected; retry: () => void }) {
  const columns: Column<BachsPaymentRow>[] = [
    { key: "date", header: "Date", hideBelow: "sm", sortValue: (r) => r.createdAt ?? "", cell: (r) => <span className="whitespace-nowrap">{when(r.createdAt)}</span> },
    { key: "order", header: "Yard order", cell: (r) => <span className="grid gap-0.5"><Orders links={r.orders} /><span className="max-w-[40vw] truncate text-[11px] text-ink-3 sm:max-w-none">{r.reference ?? r.id ?? ""}</span><span className="text-[11px] text-ink-3 sm:hidden">{when(r.createdAt)}</span></span> },
    { key: "method", header: "Method", hideBelow: "md", cell: (r) => r.method ?? "—" },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount.minor ?? 0, cell: (r) => <span className="whitespace-nowrap">{bm(r.amount)}</span> },
    { key: "fee", header: "Bachs fee", align: "right", hideBelowContainer: "4xl", cell: (r) => <span className="whitespace-nowrap text-ink-2">{bm(r.fee)}</span> },
    { key: "status", header: "Status", cell: (r) => <span title={r.failureMessage ?? undefined}><StatusBadge tone={paymentTone[r.status] ?? "muted"}>{words(r.status)}</StatusBadge></span> },
  ]
  const total = v.payments.ok ? v.payments.data.total : null
  return (
    <Panel title="Recent payments" description={`Payments and collections as Bachs records them (checkouts create them), newest first.${total !== null ? ` ${total} in all.` : ""}${v.payments.ok ? ` ${asOf(v.payments)}.` : ""}`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
      <SectionError section={v.payments} retry={retry} />
      {v.payments.ok ? <DataTable label="Bachs payments" rows={v.payments.data.items} columns={columns} getId={(r) => r.id ?? `${r.reference}-${r.createdAt}`} search={{ placeholder: "Reference, order or status", text: (r) => `${r.reference ?? ""} ${r.id ?? ""} ${r.orders.map((o) => o.reference).join(" ")} ${r.status} ${r.method ?? ""}` }} empty={{ title: "No payments yet", body: "Payments appear here once shoppers pay through Bachs." }} initialSort={{ key: "date", dir: "desc" }} pageSizes={[10, 25]} minWidth={360} /> : null}
    </Panel>
  )
}

function RefundsPanel({ v, retry }: { v: Connected; retry: () => void }) {
  const columns: Column<BachsRefundRow>[] = [
    { key: "date", header: "Created", hideBelow: "sm", sortValue: (r) => r.createdAt ?? "", cell: (r) => <span className="whitespace-nowrap">{when(r.createdAt)}</span> },
    { key: "order", header: "Yard order", cell: (r) => <span className="grid gap-0.5"><Orders links={r.orders} /><span className="text-[11px] text-ink-3 sm:hidden">{when(r.createdAt)}</span></span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap">{bm(r.refunded.amount ? r.refunded : r.requested)}</span> },
    { key: "status", header: "Status", cell: (r) => <span title={r.reason ?? undefined}><StatusBadge tone={refundTone[r.status] ?? "muted"}>{r.status === "success" ? "paid" : words(r.status)}</StatusBadge></span> },
  ]
  return (
    <Panel title="Refunds" description={`Refunds Bachs has on record. Yard's refund flow (Orders) is unchanged.${v.refunds.ok ? ` ${asOf(v.refunds)}.` : ""}`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
      <SectionError section={v.refunds} retry={retry} />
      {v.refunds.ok ? <DataTable label="Bachs refunds" rows={v.refunds.data.items} columns={columns} getId={(r) => r.refundId ?? `${r.chargeId}-${r.createdAt}`} empty={{ title: "No refunds", body: "Refunds Yard sends to Bachs appear here." }} initialSort={{ key: "date", dir: "desc" }} pageSizes={[10, 25]} minWidth={320} /> : null}
    </Panel>
  )
}

function DisputesPanel({ v, retry }: { v: Connected; retry: () => void }) {
  const columns: Column<BachsDisputeRow>[] = [
    { key: "deadline", header: "Respond by", hideBelow: "sm", sortValue: (r) => r.responseDeadlineAt ?? "", cell: (r) => <span className={`whitespace-nowrap ${r.needsResponse ? "text-danger" : ""}`}>{when(r.responseDeadlineAt)}</span> },
    { key: "order", header: "Yard order", cell: (r) => <span className="grid gap-0.5"><Orders links={r.orders} /><span className="text-[11px] text-ink-3">{r.reason ? words(r.reason) : ""}</span><span className={`text-[11px] sm:hidden ${r.needsResponse ? "text-danger" : "text-ink-3"}`}>Respond by {when(r.responseDeadlineAt)}</span></span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap">{bm(r.amount)}</span> },
    { key: "status", header: "Status", hideBelow: "md", cell: (r) => <StatusBadge tone={disputeTone[r.status] ?? "muted"}>{words(r.status)}</StatusBadge> },
    {
      key: "open",
      header: "Answer",
      cell: (r) => (
        <a href={v.dashboardUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-ink hover:text-violet" title={`Bachs dashboard › Disputes › ${r.disputeId ?? ""}`}>
          Open in Bachs <ArrowSquareOutIcon className="size-3.5" aria-hidden />
          <span className="sr-only">(dispute {r.disputeId})</span>
        </a>
      ),
    },
  ]
  const open = v.disputes.ok ? v.disputes.data.needsResponse : 0
  return (
    <Panel
      title="Disputes"
      description={`Answer disputes in the Bachs dashboard (Disputes), searching for the dispute id: the Bachs API gives no per-dispute link.${v.disputes.ok ? ` ${asOf(v.disputes)}.` : ""}`}
      className="rounded-[20px]"
      bodyClassName="px-3 sm:px-4 md:px-5"
      attention={open > 0}
      action={open ? <StatusBadge tone="danger">{open} to answer</StatusBadge> : null}
    >
      <SectionError section={v.disputes} retry={retry} />
      {v.disputes.ok ? (
        <>
          <DataTable label="Bachs disputes" rows={v.disputes.data.items} columns={columns} getId={(r) => r.disputeId ?? `${r.chargeId}-${r.createdAt}`} empty={{ title: "No disputes", body: "Chargebacks Bachs records appear here." }} initialSort={{ key: "deadline", dir: "asc" }} pageSizes={[10, 25]} minWidth={340} />
          {v.disputes.data.items.length ? <p className="mt-2 break-all text-[11px] text-ink-3">Dispute ids: {v.disputes.data.items.map((d) => d.disputeId).filter(Boolean).join(", ")}</p> : null}
        </>
      ) : null}
    </Panel>
  )
}

function EventRow({ e }: { e: StoredEvent }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-1.5 last:border-0">
      <span className="min-w-0">
        <span className="text-ink">{e.eventType}</span>
        <span className="block truncate text-[11px] text-ink-3">{[when(e.receivedAt), e.subjectRef, e.error].filter(Boolean).join(" · ")}</span>
      </span>
      <StatusBadge tone={eventTone[e.status] ?? "muted"}>{e.status}</StatusBadge>
    </li>
  )
}

function WebhooksPanel({ v }: { v: Connected }) {
  const w = v.webhooks
  const ep = w.endpoint
  return (
    <Panel
      title="Webhook health"
      description="What Yard received from Bachs (its payment event log) and, when the key may read webhooks, what Bachs reports about delivering to Yard."
      className="rounded-[20px]"
      attention={w.state === "attention"}
      action={<StatusBadge tone={w.state === "ok" ? "success" : w.state === "attention" ? "danger" : "muted"}>{w.state === "ok" ? "Healthy" : w.state === "attention" ? "Needs attention" : "No events yet"}</StatusBadge>}
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Last event received">{when(w.lastReceivedAt)}</Fact>
          <Fact label="Last processed">{when(w.lastProcessedAt)}</Fact>
          <Fact label="Received, 7 days">{w.received7d}</Fact>
          <Fact label="Failed, not yet fixed">{w.failedOpen}</Fact>
        </div>
        <p className="text-[12px] text-ink-2">
          {ep.ok
            ? ep.data
              ? `Bachs endpoint ${ep.data.url}: ${ep.data.enabled === false ? "disabled" : "enabled"}${ep.data.deliveries7d ? `, ${ep.data.deliveries7d.success} delivered and ${ep.data.deliveries7d.failed} failed in 7 days` : ""}.`
              : "No Bachs webhook endpoint points at /api/webhooks/bachs."
            : ep.error.kind === "forbidden"
              ? "Bachs-side delivery figures need the webhooks:read permission on the key (optional)."
              : ep.error.message}
        </p>
        {w.problems.length ? (
          <ul className="grid gap-1 text-[12px] text-danger">
            {w.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-3 @4xl:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-[12px] font-medium text-ink">Latest events</h3>
            {w.recent.length ? <ul className="mt-1 text-[13px]">{w.recent.slice(0, 8).map((e) => <EventRow key={e.id} e={e} />)}</ul> : <p className="mt-1 text-[12px] text-ink-3">No Bachs webhook has reached Yard yet.</p>}
          </div>
          <div className="min-w-0">
            <h3 className="text-[12px] font-medium text-ink">Failures</h3>
            {w.recentFailures.length ? <ul className="mt-1 text-[13px]">{w.recentFailures.map((e) => <EventRow key={e.id} e={e} />)}</ul> : <p className="mt-1 text-[12px] text-ink-3">None stored.</p>}
          </div>
        </div>
        <Link href="/admin/orders?view=events" className="text-[12px] text-ink-2 hover:text-ink">Open Orders › Payment events to inspect or replay an event</Link>
      </div>
    </Panel>
  )
}

function PayoutsPanel({ v, retry }: { v: Connected; retry: () => void }) {
  const columns: Column<BachsPayoutRow>[] = [
    { key: "date", header: "Created", sortValue: (r) => r.createdAt ?? "", cell: (r) => <span className="whitespace-nowrap">{when(r.createdAt)}</span> },
    { key: "ref", header: "Reference", hideBelow: "sm", cell: (r) => <span className="text-ink-2">{r.reference ?? r.id ?? "—"}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap">{bm(r.amount)}</span> },
    { key: "debited", header: "Debited", align: "right", hideBelow: "md", cell: (r) => <span className="whitespace-nowrap text-ink-2">{bm(r.totalDebited)}</span> },
    { key: "status", header: "Status", cell: (r) => <span title={r.failureReason ?? undefined}><StatusBadge tone={payoutTone[r.status] ?? "muted"}>{words(r.status)}</StatusBadge></span> },
  ]
  return (
    <Panel title="Withdrawals from Bachs" description={`Payouts out of the Bachs balance, made in the Bachs dashboard (Yard never sends them).${v.payouts.ok ? ` ${asOf(v.payouts)}.` : ""}`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
      <SectionError section={v.payouts} retry={retry} />
      {v.payouts.ok ? <DataTable label="Bachs withdrawals" rows={v.payouts.data.items} columns={columns} getId={(r) => r.id ?? `${r.reference}-${r.createdAt}`} empty={{ title: "No withdrawals", body: "Withdrawals from the Bachs balance appear here." }} initialSort={{ key: "date", dir: "desc" }} pageSizes={[10]} minWidth={320} /> : null}
    </Panel>
  )
}
