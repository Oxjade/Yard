"use client"

import { useMemo, useState } from "react"
import { DownloadSimpleIcon as Download } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { PeriodSelect, periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { BrandMark } from "@/components/market/brand-mark"
import { formatPercent } from "@/lib/money"
import { commissionReport, commissionSeries, type CommissionRow } from "./derive"
import { plural, usd, usdCompact } from "./format"
import { AdminTable, TablePanel, type Column } from "./table"

function toCsv(rows: CommissionRow[], days: number) {
  const head = ["Brand", "Orders", "Item subtotal (USD)", "Commission at 5% (USD)", "Reversed by refunds (USD)", "Net commission (USD)"]
  const money = (c: number) => (c / 100).toFixed(2)
  const lines = rows.map((r) => [r.brand.name, r.orders, money(r.baseUsd), money(r.assessedUsd), money(r.reversedUsd), money(r.netUsd)])
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return [`# Commission report, last ${days} days to 5 Nov 2026, sample data`, head.join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n")
}

/** The platform's 5% commission per brand: assessed on the item subtotal, reversed when an order is refunded. */
export function CommissionTab() {
  const [period, setPeriod] = useState<Period>("30d")
  const days = periodDays[period]
  const rows = useMemo(() => commissionReport(days), [days])
  const series = useMemo(() => commissionSeries(days), [days])
  const total = rows.reduce(
    (s, r) => ({ orders: s.orders + r.orders, base: s.base + r.baseUsd, assessed: s.assessed + r.assessedUsd, reversed: s.reversed + r.reversedUsd, net: s.net + r.netUsd }),
    { orders: 0, base: 0, assessed: 0, reversed: 0, net: 0 },
  )
  const top = Math.max(1, ...rows.map((r) => r.netUsd))

  function exportCsv() {
    const blob = new Blob([toCsv(rows, days)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `nocturne-commission-${days}d.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast("Commission report exported", { description: `${plural(rows.length, "brand")}, last ${periodLabel[period].toLowerCase()}.` })
  }

  const columns: Column<CommissionRow>[] = [
    {
      key: "brand",
      header: "Brand",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <BrandMark brand={r.brand} size="xs" />
          <span className="truncate whitespace-nowrap text-ink">{r.brand.name}</span>
        </span>
      ),
    },
    { key: "orders", header: "Orders", align: "right", cell: (r) => <span className="text-ink-2">{r.orders}</span> },
    { key: "base", header: "Item subtotal", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink-2">{usd(r.baseUsd)}</span> },
    { key: "assessed", header: "Commission at 5%", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.assessedUsd)}</span> },
    { key: "reversed", header: "Reversed", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.reversedUsd ? `−${usd(r.reversedUsd)}` : usd(0)}</span> },
    { key: "net", header: "Net commission", align: "right", cell: (r) => <span className="font-medium whitespace-nowrap text-ink">{usd(r.netUsd)}</span> },
    {
      key: "share",
      header: "Share",
      className: "w-40",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <span className="block h-full rounded-full bg-purple" style={{ width: `${(r.netUsd / top) * 100}%` }} />
          </span>
          <span className="w-10 text-right text-[11px] text-ink-3 tabular">{total.net ? formatPercent(r.netUsd / total.net, 0) : "0%"}</span>
        </span>
      ),
    },
  ]

  return (
    <div className="grid gap-5">
      <section aria-labelledby="commission-chart-title" className="rounded-lg border border-line-soft bg-card p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="commission-chart-title" className="text-[13px] font-medium text-ink">Commission earned</h2>
            <p className="text-[11px] text-ink-2">Net commission per day in USD, after refunds. Shipping and tax pass through to brands.</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-lg font-medium text-ink tabular">{usd(total.net)}</p>
            <PeriodSelect value={period} onChange={setPeriod} options={["7d", "30d", "90d"]} />
          </div>
        </div>
        <TimeSeriesChart data={series} series={[{ key: "commission", label: "Commission" }]} format={usdCompact} kind="bar" height={200} />
      </section>

      <TablePanel
        id="commission-title"
        title="Commission report"
        description={`5% of the item subtotal per brand, last ${periodLabel[period].toLowerCase()}. Refunded orders reverse their commission; cancelled orders never earn any.`}
        toolbar={
          <Button type="button" size="sm" variant="secondary" onClick={exportCsv}>
            <Download /> Export CSV
          </Button>
        }
      >
        <AdminTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.brand.id}
          caption="Commission per brand"
          minWidth={900}
          foot={{
            brand: "All brands",
            orders: total.orders,
            base: usd(total.base),
            assessed: usd(total.assessed),
            reversed: total.reversed ? `−${usd(total.reversed)}` : usd(0),
            net: usd(total.net),
            mobile: (
              <span className="flex items-center justify-between text-[13px] text-ink">
                <span>All brands, {plural(total.orders, "order")}</span>
                <span className="font-medium tabular">{usd(total.net)}</span>
              </span>
            ),
          }}
          mobileRow={(r) => ({
            lead: <BrandMark brand={r.brand} size="sm" />,
            title: r.brand.name,
            meta: `${plural(r.orders, "order")}, ${usd(r.baseUsd)} items${r.reversedUsd ? `, −${usd(r.reversedUsd)} reversed` : ""}`,
            trail: (
              <>
                <span className="text-[13px] font-medium text-ink tabular">{usd(r.netUsd)}</span>
                <span className="text-[11px] text-ink-3 tabular">{total.net ? formatPercent(r.netUsd / total.net, 0) : "0%"}</span>
              </>
            ),
          })}
        />
      </TablePanel>
    </div>
  )
}
