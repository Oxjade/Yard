"use client"

import { useState } from "react"
import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column } from "@/components/dashboard/data-table"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { buckets, change, longDate, rangeLabel, shortDate, slices, type Bucket } from "@/components/dashboard/insight/derive"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { SignalList } from "@/components/dashboard/insight/signal-list"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { asCurrency, useAdminAnalytics } from "@/components/admin/overview/marketplace-performance"
import { useAsyncAction } from "@/hooks/use-async-action"
import { site } from "@/config/site"
import { errorMessage } from "@/lib/api/errors"
import { formatMoney, formatPercent, toMajor } from "@/lib/money"
import type { CommissionRow } from "@/server/analytics/admin-db"
import { cap, plural } from "./format"
import { downloadCsv } from "./table"
import { usePhone } from "../marketplace/url-state"

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, 7 | 30 | 90> = { "7d": 7, "30d": 30, "90d": 90 }

/**
 * Finance › Commission for a real admin: the sample tab's chart and report, from the ledger
 * (ledger_order_money: commission assessed when a payment is captured, reversed by refunds). In
 * the ledger currency, never converted; with sales in more than one, a switch picks which.
 */
export function CommissionLiveTab() {
  const phone = usePhone()
  const [period, setPeriod] = useState<Period>("30d")
  const [bucket, setBucket] = useState<Bucket>("daily")
  const [picked, setPicked] = useState<string | null>(null)
  const days = periodDays[period]
  const q = useAdminAnalytics(days, true)
  const data = q.data
  const ready = !!data
  const currency = data ? (picked && data.currencies.includes(picked) ? picked : (data.currencies[0] ?? "NGN")) : "NGN"
  const cur = asCurrency(currency)
  const perf = data?.byCurrency[currency]
  const series = perf?.series ?? []
  const historyStart = perf?.historyStart ?? data?.today ?? ""
  const rows: CommissionRow[] = perf?.brands ?? []
  const money = (n: number) => formatMoney(Math.round(n), cur)
  const compact = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  const total = rows.reduce((s, r) => ({ orders: s.orders + r.orders, gross: s.gross + r.gross, assessed: s.assessed + r.assessed, reversed: s.reversed + r.reversed, net: s.net + r.net }), { orders: 0, gross: 0, assessed: 0, reversed: 0, net: 0 })
  const top = Math.max(1, ...rows.map((r) => r.net))

  function exportCsv(list: CommissionRow[], filename: string) {
    downloadCsv(
      filename,
      ["Brand", "Orders", `Gross (${cur})`, `Commission assessed (${cur})`, `Reversed by refunds (${cur})`, `Net commission (${cur})`],
      list.map((r) => [r.name, r.orders, toMajor(r.gross, cur), toMajor(r.assessed, cur), toMajor(r.reversed, cur), toMajor(r.net, cur)]),
      `Commission report, last ${days} days to ${data?.today ?? ""} (UTC), ${cur}, from the ledger`,
    )
  }
  const exporter = useAsyncAction(() => exportCsv(rows, `${site.name.toLowerCase()}-commission-${cur.toLowerCase()}-${days}d.csv`), { error: "The report couldn't be built. Try again." })

  const spec = buckets[bucket]
  const sum = (list: { commission: number }[]) => list.reduce((s, x) => s + x.commission, 0)
  const bars: BarDatum[] = series.length
    ? slices(series, spec.size, spec.count, historyStart).map((s) => ({
        key: s.from,
        label: bucket === "daily" ? shortDate(s.to) : bucket === "monthly" ? rangeLabel(s.from, s.to) : shortDate(s.from),
        fullLabel: bucket === "daily" ? longDate(s.to) : rangeLabel(s.from, s.to),
        value: sum(s.rows),
        delta: s.previous ? change(sum(s.rows), sum(s.previous)) : null,
      }))
    : []
  const chartTotal = bars.reduce((t, b) => t + b.value, 0)
  const chartDays = spec.size * spec.count
  const chartPrev = series.slice(series.length - chartDays * 2, series.length - chartDays)
  const chartDelta = chartPrev.length === chartDays && chartPrev[0].date >= historyStart ? change(chartTotal, sum(chartPrev)) : null

  const columns: Column<CommissionRow>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="min-w-0 max-w-[44vw] sm:max-w-none">
          <span className="block truncate whitespace-nowrap text-ink">{r.name}</span>
          <span className="block truncate text-[11.5px] text-ink-3 md:hidden">{plural(r.orders, "order")}, {money(r.gross)} gross</span>
        </span>
      ),
    },
    { key: "orders", header: "Orders", align: "right", hideBelow: "md", sortValue: (r) => r.orders, cell: (r) => <span className="text-ink-2">{r.orders}</span> },
    { key: "gross", header: "Gross", align: "right", hideBelow: "md", sortValue: (r) => r.gross, cell: (r) => <span className="whitespace-nowrap text-ink-2">{money(r.gross)}</span> },
    { key: "assessed", header: "Commission assessed", align: "right", hideBelow: "lg", sortValue: (r) => r.assessed, cell: (r) => <span className="whitespace-nowrap text-ink">{money(r.assessed)}</span> },
    { key: "reversed", header: "Reversed", align: "right", hideBelow: "lg", sortValue: (r) => r.reversed, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.reversed ? `−${money(r.reversed)}` : money(0)}</span> },
    { key: "net", header: "Net commission", align: "right", sortValue: (r) => r.net, cell: (r) => <span className="font-medium whitespace-nowrap text-ink">{money(r.net)}</span> },
    {
      key: "share",
      header: "Share",
      hideBelow: "sm",
      className: "w-40",
      sortValue: (r) => r.net,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <span className="block h-full origin-left rounded-full bg-purple" style={{ transform: `scaleX(${Math.max(0, r.net) / top})` }} />
          </span>
          <span className="w-10 text-right text-[11px] text-ink-3 tabular">{total.net ? formatPercent(r.net / total.net, 0) : "0%"}</span>
        </span>
      ),
    },
  ]
  const bulkActions: BulkAction<CommissionRow>[] = [{ label: "Export as CSV", onSelect: (list) => exportCsv(list, `${site.name.toLowerCase()}-commission-${cur.toLowerCase()}-${days}d-${list.length}-brands.csv`) }]

  if (q.error && !data) return <PanelError message={errorMessage(q.error, "Couldn't load the commission report.")} onRetry={() => void q.revalidate()} />

  return (
    <div className="grid gap-3">
      <Panel
        title="Commission earned"
        description={`Net commission in ${currency} after refunds, ${spec.window}. UTC days.`}
        action={data && data.currencies.length > 1 ? <Switch label="Currency" size="sm" value={currency} onChange={setPicked} options={data.currencies.map((c) => ({ value: c, label: c }))} /> : undefined}
        className="rounded-[20px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
            {ready ? (
              <>
                <p className="font-metric text-[2rem] leading-none text-ink">{money(chartTotal)}</p>
                <span className="text-[12px] text-ink-2">{cap(spec.window)}</span>
                <DeltaChip value={chartDelta} context={`the ${spec.window.replace("last ", "")} before`} />
              </>
            ) : (
              <span aria-hidden className="skeleton block h-8 w-40 rounded-md" />
            )}
          </div>
          <Switch label="Bucket size" size="sm" value={bucket} onChange={setBucket} options={(Object.keys(buckets) as Bucket[]).map((b) => ({ value: b, label: buckets[b].label }))} />
        </div>
        {ready ? (
          <BarChart key={`${bucket}-${data.today}-${currency}`} className="mt-4" data={bars} format={compact} formatFull={money} label={`Net commission by ${bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "30 days"}`} deltaContext={bucket === "daily" ? "the day before" : bucket === "weekly" ? "the week before" : "the 30 days before"} height={220} />
        ) : (
          <div className="mt-4 h-[220px] animate-pulse rounded-lg bg-white/[0.03]" />
        )}
      </Panel>

      <Panel
        title="Commission report"
        description={`Commission per brand on paid orders, last ${days} days. Refunds reverse their share; cancelled orders never earn any.`}
        action={
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => void exporter.run()} loading={exporter.pending} success={exporter.succeeded} disabled={!rows.length}>
            <DownloadSimpleIcon /> Export CSV
          </Button>
        }
        className="rounded-[20px]"
        bodyClassName="grid gap-4 px-3 sm:px-4 md:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Switch label="Report period" size="sm" value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]} />
          <p className="text-[12px] text-ink-3">{plural(total.orders, "order")} across {plural(rows.length, "brand")}</p>
        </div>
        <SignalList
          ready={ready}
          className="grid-cols-2 @3xl:grid-cols-4"
          items={[
            { key: "gross", label: "Gross", value: money(total.gross) },
            { key: "assessed", label: "Commission assessed", value: money(total.assessed) },
            { key: "reversed", label: "Reversed by refunds", value: total.reversed ? `−${money(total.reversed)}` : money(0) },
            { key: "net", label: "Net commission", value: money(total.net) },
          ]}
        />
        <DataTable key={`${period}-${currency}`} label="Commission per brand" rows={rows} columns={columns} getId={(r) => r.brandId} loading={!ready} bulkActions={phone ? undefined : bulkActions} search={{ placeholder: "Search brands", text: (r) => r.name }} initialSort={{ key: "net", dir: "desc" }} empty={{ title: "No commission in this period", body: "Commission appears once brands make sales." }} pageSizes={[10, 25]} initialPageSize={10} minWidth={300} />
      </Panel>
    </div>
  )
}
