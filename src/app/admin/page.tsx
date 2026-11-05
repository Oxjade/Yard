"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { PeriodSelect, periodDays, type Period } from "@/components/dashboard/period-select"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { brandApplications, failedJobs, healthServices, payouts, platformOverview, refunds, webhookFailures } from "@/lib/data/admin"
import { platformDailyGmvUsd } from "@/lib/data/analytics"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"

const usd = (n: number) => formatMoney(Math.round(n), "USD", { compact: true })

export default function AdminOverviewPage() {
  const [period, setPeriod] = useState<Period>("30d")
  const o = platformOverview()
  const series = platformDailyGmvUsd(90)
  const days = periodDays[period]
  const slice = series.slice(-Math.max(days, 14))
  const periodGmv = series.slice(-days).reduce((s, p) => s + p.gmv, 0)
  const prevGmv = series.slice(-days * 2, -days).reduce((s, p) => s + p.gmv, 0)
  const pendingBrands = brandApplications.filter((a) => a.status === "pending_review").slice(0, 5)
  const pendingPayouts = payouts.filter((p) => p.status !== "paid").slice(0, 6)

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Overview"
        description="Platform health, money in motion and what needs a decision today."
        actions={<PeriodSelect value={period} onChange={setPeriod} options={["7d", "30d", "90d"]} />}
      >
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Platform figures" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile density="dense" label="Registered users" value={o.users} format={(n) => formatNumber(Math.round(n))} />
        <MetricTile density="dense" label="Active brands" value={o.brands} format={(n) => formatNumber(Math.round(n))} hint={`${o.pendingBrands} awaiting review`} />
        <MetricTile density="dense" label="Products" value={o.products} format={(n) => formatNumber(Math.round(n))} />
        <MetricTile density="dense" label={`GMV, ${days} days`} value={periodGmv} format={usd} delta={prevGmv ? (periodGmv - prevGmv) / prevGmv : null} />
        <MetricTile density="dense" label="Platform revenue, 90 days" value={o.revenueUsd} format={usd} hint={`${usd(o.commissionUsd)} commission, ${usd(o.adRevenueUsd)} ads`} />
        <MetricTile density="dense" label="Orders today" value={o.ordersToday} format={(n) => formatNumber(Math.round(n))} />
        <MetricTile density="dense" label="Payment success" value={o.paymentSuccess} format={(n) => formatPercent(n, 1)} hint="verified by webhook" />
        <MetricTile density="dense" label="Pending payouts" value={o.pendingPayoutsUsd} format={usd} highlight />
        <MetricTile density="dense" label="Refund requests" value={o.refundRequests} format={(n) => formatNumber(Math.round(n))} highlight={o.refundRequests > 0} />
        <MetricTile density="dense" label="Active campaigns" value={o.activeCampaigns} format={(n) => formatNumber(Math.round(n))} hint={`${o.campaignsInReview} in review`} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section aria-labelledby="gmv-title" className="rounded-lg border border-line-soft bg-card p-4">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 id="gmv-title" className="text-[13px] font-medium text-ink">Gross merchandise value</h2>
              <p className="text-[11px] text-ink-2">Daily GMV in USD across all brands, with commission earned.</p>
            </div>
            <p className="text-lg font-medium tabular">{formatMoney(periodGmv, "USD")}</p>
          </div>
          <TimeSeriesChart data={slice} series={[{ key: "gmv", label: "GMV" }, { key: "commission", label: "Commission" }]} format={usd} height={240} />
        </section>

        <section aria-labelledby="health-title" className="rounded-lg border border-line-soft bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 id="health-title" className="text-[13px] font-medium text-ink">Platform health</h2>
            <Link href="/admin/health" className="text-[11px] text-ink-2 hover:text-ink">Details</Link>
          </div>
          <ul className="mt-3 divide-y divide-line-soft">
            {healthServices.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2 py-2">
                <span className="text-[13px] text-ink">{s.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-[11px] text-ink-3 tabular">p95 {s.latencyP95}ms</span>
                  <StatusBadge tone={s.status === "operational" ? "success" : "attention"}>{s.status === "operational" ? "Operational" : "Degraded"}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2">
            <Link href="/admin/health" className="flex items-start gap-2 rounded-md border border-acid/25 bg-acid/5 p-2.5 text-[12px] text-ink">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-acid" />
              {failedJobs.length} failed background jobs and {webhookFailures.length} payment webhook failures need a look.
            </Link>
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="review-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 id="review-title" className="text-[13px] font-medium">Brands awaiting review</h2>
            <Link href="/admin/brands" className="text-[11px] text-ink-2 hover:text-ink">Review queue</Link>
          </div>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {pendingBrands.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{a.brandName}</p>
                  <p className="truncate text-[11px] text-ink-3">{a.country}, {a.products} products</p>
                </div>
                <StatusBadge tone={a.risk === "high" ? "danger" : a.risk === "medium" ? "attention" : "muted"}>{a.risk} risk</StatusBadge>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="payouts-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 id="payouts-title" className="text-[13px] font-medium">Pending payouts</h2>
            <Link href="/admin/finance" className="text-[11px] text-ink-2 hover:text-ink">Finance</Link>
          </div>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {pendingPayouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{p.brandName}</p>
                  <p className="truncate text-[11px] text-ink-3">{p.method}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] tabular">{formatMoney(p.amountUsd, "USD")}</span>
                  <StatusBadge tone={p.status === "held" ? "danger" : p.status === "awaiting_approval" ? "attention" : "info"}>{p.status.replace("_", " ")}</StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="refunds-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 id="refunds-title" className="text-[13px] font-medium">Refund requests</h2>
            <Link href="/admin/finance" className="text-[11px] text-ink-2 hover:text-ink">All refunds</Link>
          </div>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {refunds.filter((r) => r.status === "requested").slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">#{r.reference}, {r.brandName}</p>
                  <p className="truncate text-[11px] text-ink-3">{r.reason}</p>
                </div>
                <span className="text-[13px] tabular">{formatMoney(r.amountUsd, "USD")}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
