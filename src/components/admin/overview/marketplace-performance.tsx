"use client"

import { useMemo, useState } from "react"
import { ChartLineUpIcon, CoinsIcon, HourglassIcon, ShoppingCartIcon } from "@phosphor-icons/react"
import { ArrowLink } from "@/components/dashboard/insight/arrow-link"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { buckets, change, longDate, periodWindows, rangeLabel, shortDate, slices, weekdayByWeek, weekdays, type Bucket } from "@/components/dashboard/insight/derive"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { DonutChart, type DonutSegment } from "@/components/dashboard/insight/donut-chart"
import { Heatmap, PeakSwatch } from "@/components/dashboard/insight/heatmap"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { SignalList } from "@/components/dashboard/insight/signal-list"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { RingGauge } from "@/components/admin/ui/gauge"
import { RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { canAdminFinance } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import type { AdminAnalytics, AdminPoint } from "@/server/analytics/admin-db"

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, 7 | 30 | 90> = { "7d": 7, "30d": 30, "90d": 90 }
const int = (n: number) => formatNumber(Math.round(n))
export const asCurrency = (c: string | undefined): CurrencyCode => (c && c in currencies ? (c as CurrencyCode) : "NGN")

export function useAdminAnalytics(days: 7 | 30 | 90, enabled: boolean) {
  return useApi<AdminAnalytics>(enabled ? `admin.analytics:${days}` : null, () => api<AdminAnalytics>("/api/admin/analytics", { query: { days } }), { refreshInterval: 5 * 60_000 })
}

/**
 * The Control Center's marketplace performance in production: the demo's panels (GMV,
 * commission, paid orders, pending payouts, the signal ledger, volume by bucket, revenue by
 * brand, orders by weekday and payment success), every figure from the ledger and the order
 * tables (GET /api/admin/analytics, memoised five minutes). Money stays in its ledger currency;
 * with sales in more than one, a switch picks which. Owner and Finance only, like Finance.
 */
export function MarketplacePerformance() {
  const admin = useServerSession((s) => s.admin)
  const finance = !!admin && canAdminFinance(admin.role)
  const [period, setPeriod] = useState<Period>("30d")
  const [bucket, setBucket] = useState<Bucket>("daily")
  const [picked, setPicked] = useState<string | null>(null)
  const days = periodDays[period]
  const q = useAdminAnalytics(days, finance)
  const data = q.data
  const ready = !!data

  const currency = data ? (picked && data.currencies.includes(picked) ? picked : (data.currencies[0] ?? "NGN")) : "NGN"
  const cur = asCurrency(currency)
  const perf = data?.byCurrency[currency]
  const series: AdminPoint[] = useMemo(() => perf?.series ?? [], [perf])
  const anchor = data?.today ?? series[series.length - 1]?.date ?? ""
  const historyStart = perf?.historyStart ?? anchor

  if (!finance) return null
  if (q.error && !data) {
    return (
      <RevealItem className="min-w-0">
        <Panel title="Marketplace performance" description="Couldn't load the figures from Yard's server. They retry every five minutes." className="rounded-[20px]">
          <span />
        </Panel>
      </RevealItem>
    )
  }

  const money = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  const moneyFull = (n: number) => formatMoney(Math.round(n), cur)
  const win = series.length ? periodWindows(series, days, historyStart) : { current: [], previous: [], comparable: false }
  const sum = (rows: AdminPoint[], k: "gmv" | "orders" | "commission") => rows.reduce((s, r) => s + r[k], 0)
  const gmv = sum(win.current, "gmv")
  const orders = sum(win.current, "orders")
  const commission = sum(win.current, "commission")
  const gmvPrev = sum(win.previous, "gmv")
  const ordersPrev = sum(win.previous, "orders")
  const commissionPrev = sum(win.previous, "commission")
  const d = (a: number, b: number) => (win.comparable ? change(a, b) : null)
  const versus = `the ${days} days before`
  const hint = !perf?.historyStart ? "No sales yet" : win.comparable ? `vs ${versus}` : `Sales history starts ${shortDate(perf.historyStart)}`

  const spec = buckets[bucket]
  const bars: BarDatum[] = series.length
    ? slices(series, spec.size, spec.count, historyStart).map((s) => {
        const value = sum(s.rows, "gmv")
        const n = sum(s.rows, "orders")
        return {
          key: s.from,
          label: bucket === "daily" ? shortDate(s.to) : bucket === "monthly" ? rangeLabel(s.from, s.to) : shortDate(s.from),
          fullLabel: bucket === "daily" ? longDate(s.to) : rangeLabel(s.from, s.to),
          value,
          delta: s.previous ? change(value, sum(s.previous, "gmv")) : null,
          meta: `${int(n)} ${n === 1 ? "order" : "orders"}, ${money(sum(s.rows, "commission"))} commission`,
        }
      })
    : []
  const chartTotal = bars.reduce((t, b) => t + b.value, 0)
  const chartDays = spec.size * spec.count
  const chartPrev = series.slice(series.length - chartDays * 2, series.length - chartDays)
  const chartDelta = chartPrev.length === chartDays && chartPrev[0].date >= historyStart ? change(chartTotal, sum(chartPrev, "gmv")) : null

  /* Net commission by brand in the period: the top four and the rest. Adds up to Commission earned. */
  const brands = perf?.brands ?? []
  const ranked = brands.filter((b) => b.net > 0)
  const rest = ranked.slice(4).reduce((t, b) => t + b.net, 0)
  const mix: DonutSegment[] = [...ranked.slice(0, 4).map((b) => ({ key: b.brandId, label: b.name, value: b.net, href: "/admin/finance?tab=commission" })), ...(rest ? [{ key: "other", label: `Other brands (${ranked.length - 4})`, value: rest, href: "/admin/finance?tab=commission" }] : [])]

  const heatDates = series.flatMap((p) => Array.from({ length: p.orders }, () => p.date))
  const heat = anchor ? weekdayByWeek(heatDates, 13, historyStart, anchor) : null
  const ordersUnit = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`

  const payments = data?.payments ?? []
  const paidTotal = payments.reduce((s, p) => s + p.total, 0)
  const paidOk = payments.reduce((s, p) => s + p.succeeded, 0)

  return (
    <>
      <RevealItem className="flex flex-col gap-3 px-1 pt-3 @2xl:flex-row @2xl:items-end @2xl:justify-between">
        <div>
          <h2 className="font-label text-[15px] text-ink">Marketplace performance</h2>
          <p className="mt-1 text-[12px] text-ink-3">Every brand, in {currency}, over the last {days} days{win.comparable ? `, compared with ${versus}` : ""}. UTC days, from the ledger.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.currencies.length > 1 ? <Switch label="Currency" size="sm" value={currency} onChange={setPicked} options={data.currencies.map((c) => ({ value: c, label: c }))} /> : null}
          <Switch
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]}
            className="w-full @2xl:w-auto [&>button]:flex-1 @2xl:[&>button]:flex-none"
          />
        </div>
      </RevealItem>

      <section aria-label="Headline metrics" className="grid gap-3 @lg:grid-cols-2 @5xl:grid-cols-4">
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={ChartLineUpIcon} label="GMV" value={gmv} format={money} delta={d(gmv, gmvPrev)} deltaContext={versus} hint={ready ? hint : undefined} href="/admin/orders" hrefLabel="Open orders behind GMV" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={CoinsIcon} label="Commission earned" value={commission} format={money} delta={d(commission, commissionPrev)} deltaContext={versus} hint="Net of refunds" href="/admin/finance?tab=commission" hrefLabel="Open the commission report" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={ShoppingCartIcon} label="Paid orders" value={orders} format={int} delta={d(orders, ordersPrev)} deltaContext={versus} hint={ready ? `${int(series[series.length - 1]?.orders ?? 0)} today` : undefined} href="/admin/orders" hrefLabel="Open orders" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" variant="brand" icon={HourglassIcon} label="Pending payouts" value={perf?.payouts.pendingMinor ?? 0} format={money} hint={ready ? (perf?.payouts.brands ? `To ${perf.payouts.brands} ${perf.payouts.brands === 1 ? "brand" : "brands"}` : "Nothing requested") : undefined} href="/admin/finance?tab=payouts" hrefLabel="Open payouts" ready={ready} className="h-full" />
        </RevealItem>
      </section>

      <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-12">
        <Panel title="Signal ledger" description={`Last ${days} days`} className="flex flex-col rounded-[20px] @5xl:col-span-3" bodyClassName="flex flex-1 flex-col">
          <SignalList
            className="flex-1 auto-rows-fr"
            ready={ready}
            deltaContext={versus}
            items={[
              { key: "aov", label: "Average order value", value: orders ? moneyFull(gmv / orders) : "No orders", empty: !orders, delta: orders ? d(gmv / orders, ordersPrev ? gmvPrev / ordersPrev : 0) : null },
              { key: "take", label: "Take rate", value: gmv ? formatPercent(commission / gmv, 1) : "No sales", empty: !gmv, delta: gmv ? d(commission / gmv, gmvPrev ? commissionPrev / gmvPrev : 0) : null },
              { key: "users", label: "Registered users", value: int(data?.counts.users ?? 0) },
              { key: "products", label: "Live products", value: int(data?.counts.products ?? 0), hint: `from ${int(data?.counts.brands ?? 0)} brands` },
              { key: "selling", label: "Brands selling", value: int(brands.length), hint: `in the last ${days} days` },
            ]}
          />
        </Panel>

        <Panel title="Marketplace volume" description={`GMV across every brand, ${spec.window}`} action={<ArrowLink href="/admin/orders" label="Open all orders" />} className="rounded-[20px] @xl:order-first @xl:col-span-2 @5xl:order-none @5xl:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
              {ready ? (
                <>
                  <p className="font-metric text-[2rem] leading-none text-ink">
                    <CountUp value={chartTotal} format={moneyFull} />
                  </p>
                  <DeltaChip value={chartDelta} context={`the ${spec.window.replace("last ", "")} before`} />
                </>
              ) : (
                <span aria-hidden className="skeleton block h-8 w-40 rounded-md" />
              )}
            </div>
            <Switch label="Bucket size" size="sm" value={bucket} onChange={setBucket} options={(Object.keys(buckets) as Bucket[]).map((b) => ({ value: b, label: buckets[b].label }))} />
          </div>
          {ready ? (
            <BarChart key={`${bucket}-${anchor}-${currency}`} className="mt-4" data={bars} format={money} formatFull={moneyFull} label={`GMV by ${bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "30 days"}`} deltaContext={bucket === "daily" ? "the day before" : bucket === "weekly" ? "the week before" : "the 30 days before"} height={236} />
          ) : (
            <div className="mt-4 h-[236px] animate-pulse rounded-lg bg-white/[0.03]" />
          )}
        </Panel>

        <Panel title="Revenue mix" description={`Net commission by brand, last ${days} days`} action={<ArrowLink href="/admin/finance?tab=commission" label="Open the commission report" />} className="rounded-[20px] @5xl:col-span-3">
          <DonutChart segments={mix} format={money} formatFull={moneyFull} totalLabel="Commission" label={`Net commission by brand, last ${days} days`} empty="No commission in this period." emptyCentre="No revenue" />
          <p className="mt-4 text-[11.5px] leading-snug text-ink-3">Commission is assessed on each paid order and reversed by refunds. Advertising revenue starts when sponsored placements launch.</p>
        </Panel>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-12">
        <Panel title="Orders by weekday" description="Every brand. Each square is a day, last 13 weeks" className="rounded-[20px] @5xl:col-span-8">
          {heat ? (
            <Heatmap
              ready={ready}
              rows={weekdays}
              columns={heat.columns}
              cells={heat.cells}
              unit={ordersUnit}
              label="Paid orders per day across every brand over the last 13 weeks"
              stats={[
                { label: "Busiest weekday", value: heat.busiestWeekday ? heat.busiestWeekday.name : "None yet" },
                { label: "Weekend share", value: heat.weekendShare === null ? "None yet" : formatPercent(heat.weekendShare, 0) },
                { label: "Most in a day", value: heat.max ? (heat.peak ? <><PeakSwatch />{ordersUnit(heat.max)} on {shortDate(heat.peak.date)}</> : `${ordersUnit(heat.max)} on ${heat.maxDays} days`) : "None yet" },
              ]}
            />
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-white/[0.03]" />
          )}
        </Panel>
        <Panel title="Payments" description={`Checkout payments that finished in the last ${days} days. Success counts only once the provider confirms it.`} className="rounded-[20px] @5xl:col-span-4" action={<ArrowLink href="/admin/orders" label="Open orders" />}>
          {paidTotal ? (
            <>
              <div className="flex items-center gap-5">
                <RingGauge value={paidOk / paidTotal} threshold={0.97} belowTone="ink" label="Payment success" sublabel="success" />
                <p className="min-w-0 flex-1 text-[12px] text-ink-2">Target 97% or better, marked by the tick. Under it, the ring turns white. Abandoned payments count as not completed.</p>
              </div>
              <div className="mt-5 grid gap-2.5">
                {payments.map((p) => (
                  <div key={p.provider} className="admin-inset flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-[12.5px] text-ink capitalize">{p.provider}</span>
                    <span className="flex items-center gap-3 text-[12px] tabular">
                      <span className="text-ink-3">{int(p.total)} {p.total === 1 ? "payment" : "payments"}</span>
                      {p.succeeded / p.total < 0.97 ? (
                        <span className="rounded-[5px] border border-ink/70 px-1.5 text-ink">
                          {formatPercent(p.succeeded / p.total, 1)}
                          <span className="sr-only">, below target</span>
                        </span>
                      ) : (
                        <span className="text-ink">{formatPercent(p.succeeded / p.total, 1)}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-2">{ready ? `No checkout payments finished in the last ${days} days.` : "Loading payments…"}</p>
          )}
        </Panel>
      </div>
    </>
  )
}
