"use client"

import { useMemo, useState } from "react"
import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column } from "@/components/dashboard/data-table"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { buckets, change, longDate, rangeLabel, shortDate, slices, type Bucket } from "@/components/dashboard/insight/derive"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { SignalList } from "@/components/dashboard/insight/signal-list"
import { BrandMark } from "@/components/market/brand-mark"
import { Panel } from "@/components/admin/ui/panel"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { site } from "@/config/site"
import { merchantOrders } from "@/lib/data/orders"
import { formatPercent } from "@/lib/money"
import { commissionReport, commissionSeries, type CommissionRow } from "./derive"
import { anchorDay, cap, demoLag, formatDate, plural, usd, usdCompact } from "./format"
import { downloadCsv } from "./table"
import { usePhone } from "../marketplace/url-state"

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 }
const money = (c: number) => (c / 100).toFixed(2)

function exportCsv(rows: CommissionRow[], days: number, filename: string) {
  downloadCsv(
    filename,
    ["Brand", "Orders", "Item subtotal (USD)", "Commission at 5% (USD)", "Reversed by refunds (USD)", "Net commission (USD)"],
    rows.map((r) => [r.brand.name, r.orders, money(r.baseUsd), money(r.assessedUsd), money(r.reversedUsd), money(r.netUsd)]),
    `Commission report, last ${days} days to ${formatDate(`${anchorDay(Date.now())}T12:00:00Z`)}, sample data`,
  )
}

/** The platform's 5% commission per brand: assessed on the item subtotal, reversed when an order is refunded. */
export function CommissionTab() {
  const hydrated = useHydrated()
  const phone = usePhone()
  const [period, setPeriod] = useState<Period>("30d")
  const [bucket, setBucket] = useState<Bucket>("daily")
  const days = periodDays[period]
  // Windows end on the same today as every other Control Center page (see anchorDay).
  const now = useNow(60_000)
  // The chart remounts when today moves on, so its highlighted bar starts on the new latest day.
  const lag = demoLag(now)
  const rows = useMemo(() => commissionReport(days, now), [days, now])
  const series = useMemo(() => commissionSeries(180, now), [now])
  const historyStart = useMemo(() => merchantOrders.reduce((m, o) => (o.placedAt.slice(0, 10) < m ? o.placedAt.slice(0, 10) : m), series[series.length - 1].date), [series])
  const total = rows.reduce((s, r) => ({ orders: s.orders + r.orders, base: s.base + r.baseUsd, assessed: s.assessed + r.assessedUsd, reversed: s.reversed + r.reversedUsd, net: s.net + r.netUsd }), { orders: 0, base: 0, assessed: 0, reversed: 0, net: 0 })
  const top = Math.max(1, ...rows.map((r) => r.netUsd))
  const exporter = useAsyncAction(() => exportCsv(rows, days, `${site.name.toLowerCase()}-commission-${days}d.csv`), { error: "The report couldn't be built. Try again." })

  const spec = buckets[bucket]
  const sum = (list: { commission: number }[]) => list.reduce((s, x) => s + x.commission, 0)
  const bars: BarDatum[] = slices(series, spec.size, spec.count, historyStart).map((s) => ({
    key: s.from,
    label: bucket === "daily" ? shortDate(s.to) : bucket === "monthly" ? rangeLabel(s.from, s.to) : shortDate(s.from),
    fullLabel: bucket === "daily" ? longDate(s.to) : rangeLabel(s.from, s.to),
    value: sum(s.rows),
    delta: s.previous ? change(sum(s.rows), sum(s.previous)) : null,
  }))
  const chartTotal = bars.reduce((t, b) => t + b.value, 0)
  const chartDays = spec.size * spec.count
  const chartPrev = series.slice(series.length - chartDays * 2, series.length - chartDays)
  const chartDelta = chartPrev.length === chartDays && chartPrev[0].date >= historyStart ? change(chartTotal, sum(chartPrev)) : null

  const columns: Column<CommissionRow>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (r) => r.brand.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="hidden sm:inline-flex"><BrandMark brand={r.brand} size="sm" /></span>
          <span className="min-w-0 max-w-[44vw] sm:max-w-none">
            <span className="block truncate whitespace-nowrap text-ink">{r.brand.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3 md:hidden">{plural(r.orders, "order")}, {usd(r.baseUsd)} items</span>
          </span>
        </span>
      ),
    },
    { key: "orders", header: "Orders", align: "right", hideBelow: "md", sortValue: (r) => r.orders, cell: (r) => <span className="text-ink-2">{r.orders}</span> },
    { key: "base", header: "Item subtotal", align: "right", hideBelow: "md", sortValue: (r) => r.baseUsd, cell: (r) => <span className="whitespace-nowrap text-ink-2">{usd(r.baseUsd)}</span> },
    { key: "assessed", header: "Commission at 5%", align: "right", hideBelow: "lg", sortValue: (r) => r.assessedUsd, cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.assessedUsd)}</span> },
    { key: "reversed", header: "Reversed", align: "right", hideBelow: "lg", sortValue: (r) => r.reversedUsd, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.reversedUsd ? `−${usd(r.reversedUsd)}` : usd(0)}</span> },
    { key: "net", header: "Net commission", align: "right", sortValue: (r) => r.netUsd, cell: (r) => <span className="font-medium whitespace-nowrap text-ink">{usd(r.netUsd)}</span> },
    {
      key: "share",
      header: "Share",
      hideBelow: "sm",
      className: "w-40",
      sortValue: (r) => r.netUsd,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <span className="block h-full origin-left rounded-full bg-purple" style={{ transform: `scaleX(${r.netUsd / top})` }} />
          </span>
          <span className="w-10 text-right text-[11px] text-ink-3 tabular">{total.net ? formatPercent(r.netUsd / total.net, 0) : "0%"}</span>
        </span>
      ),
    },
  ]
  const bulkActions: BulkAction<CommissionRow>[] = [{ label: "Export as CSV", onSelect: (list) => exportCsv(list, days, `${site.name.toLowerCase()}-commission-${days}d-${list.length}-brands.csv`) }]

  return (
    <div className="grid gap-3">
      <Panel title="Commission earned" description={`Net commission in USD after refunds, ${spec.window}. Shipping and tax pass through to brands.`} className="rounded-[20px]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
            {hydrated ? (
              <>
                <p className="font-metric text-[2rem] leading-none text-ink">{usd(chartTotal)}</p>
                {/* Named beside the figure: the report below has its own period. */}
                <span className="text-[12px] text-ink-2">{cap(spec.window)}</span>
                <DeltaChip value={chartDelta} context={`the ${spec.window.replace("last ", "")} before`} />
              </>
            ) : (
              <span aria-hidden className="skeleton block h-8 w-40 rounded-md" />
            )}
          </div>
          <Switch label="Bucket size" size="sm" value={bucket} onChange={setBucket} options={(Object.keys(buckets) as Bucket[]).map((b) => ({ value: b, label: buckets[b].label }))} />
        </div>
        <BarChart key={`${bucket}-${lag}`} className="mt-4" data={bars} format={usdCompact} formatFull={usd} label={`Net commission by ${bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "30 days"}`} deltaContext={bucket === "daily" ? "the day before" : bucket === "weekly" ? "the week before" : "the 30 days before"} height={220} />
      </Panel>

      <Panel
        title="Commission report"
        description={`5% of the item subtotal per brand, last ${days} days. Refunded orders reverse their commission; cancelled orders never earn any.`}
        action={
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => void exporter.run()} loading={exporter.pending} success={exporter.succeeded}>
            <DownloadSimpleIcon /> Export CSV
          </Button>
        }
        className="rounded-[20px]"
        bodyClassName="grid gap-4 px-3 sm:px-4 md:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Switch label="Report period" size="sm" value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]} />
          <p className="text-[12px] text-ink-3">{plural(total.orders, "order")} across {plural(rows.filter((r) => r.orders).length, "brand")}</p>
        </div>
        <SignalList
          ready={hydrated}
          className="grid-cols-2 @3xl:grid-cols-4"
          items={[
            { key: "base", label: "Item subtotal", value: usd(total.base) },
            { key: "assessed", label: "Commission at 5%", value: usd(total.assessed) },
            { key: "reversed", label: "Reversed by refunds", value: total.reversed ? `−${usd(total.reversed)}` : usd(0) },
            { key: "net", label: "Net commission", value: usd(total.net) },
          ]}
        />
        <DataTable key={period} label="Commission per brand" rows={rows} columns={columns} getId={(r) => r.brand.id} loading={!hydrated} bulkActions={phone ? undefined : bulkActions} search={{ placeholder: "Search brands", text: (r) => r.brand.name }} initialSort={{ key: "net", dir: "desc" }} empty={{ title: "No commission in this period", body: "Commission appears once brands make sales." }} pageSizes={[10, 25]} initialPageSize={10} minWidth={300} />
      </Panel>
    </div>
  )
}
