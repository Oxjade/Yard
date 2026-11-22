"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChartLineUpIcon, SquaresFourIcon, WarningIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Heatmap, PeakSwatch } from "@/components/dashboard/insight/heatmap"
import { addDays, shortDate, weekdays, type HeatCell } from "@/components/dashboard/insight/derive"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { AdminAreaChart } from "@/components/admin/ui/area-chart"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { canAdmin } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { HeatmapMetric, MetricsResponse } from "@/server/monitoring/service"
import type { MetricKey, RangeKey } from "@/server/monitoring/series"
import { int } from "../format"

/* Every bucket is a UTC minute, quarter hour, hour or day (src/server/monitoring/series.ts), so
 * the labels here are UTC too, the same as the rest of the platform screens (../format.ts). */
const utc = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" })
const timeFmt = utc({ hour: "2-digit", minute: "2-digit", hour12: false })
const dayFmt = utc({ day: "numeric", month: "short" })
const longDayFmt = utc({ weekday: "short", day: "numeric", month: "short" })
const dayTimeFmt = utc({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "1y", label: "1y" },
]
const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: "requests", label: "Requests" },
  { value: "errors", label: "Errors" },
  { value: "latency", label: "Latency" },
  { value: "orders", label: "Orders" },
  { value: "revenue", label: "Revenue" },
  { value: "signups", label: "Sign-ups" },
]

const rangeWords: Record<RangeKey, string> = { "1h": "the last hour, per minute", "24h": "the last 24 hours, every 15 minutes", "7d": "the last 7 days, per hour", "30d": "the last 30 days, per day", "1y": "the last 12 months, per day" }
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${int(n)} ms`)

const copy: Record<MetricKey, { primary: string; secondary: string; what: string; empty: string }> = {
  requests: { primary: "Requests", secondary: "Server errors", what: "API requests answered", empty: "Requests appear here a minute after the server answers them." },
  errors: { primary: "Server errors (5xx)", secondary: "Client errors (4xx)", what: "API responses with an error status", empty: "No error responses in this range." },
  latency: { primary: "p95 latency", secondary: "p50 latency", what: "API response time, 95th and 50th percentile", empty: "Latency appears here once the server has answered requests." },
  orders: { primary: "Orders placed", secondary: "Orders paid", what: "Orders across every brand", empty: "No orders in this range yet. They appear here as shoppers check out." },
  revenue: { primary: "Paid sales", secondary: "Paid orders", what: "Paid sales, in the order's currency", empty: "No paid sales in this range yet." },
  signups: { primary: "Shopper sign-ups", secondary: "Brand applications", what: "New shopper accounts and submitted brand applications", empty: "No sign-ups in this range yet." },
}

const getMetrics = (range: RangeKey, metric: MetricKey, currency: string | null) => api<MetricsResponse>(`/api/admin/metrics?range=${range}&metric=${metric}${currency ? `&currency=${currency}` : ""}`)

/** The Activity graph: requests, errors and latency from metrics_minutes; orders, revenue and sign-ups from Yard's tables. */
export function ActivityGraph({ className }: { className?: string }) {
  const [range, setRange] = useState<RangeKey>("24h")
  const [metric, setMetric] = useState<MetricKey>("requests")
  const [currency, setCurrency] = useState<string | null>(null)
  const q = useApi(`admin:metrics:${range}:${metric}:${currency ?? ""}`, () => getMetrics(range, metric, metric === "revenue" ? currency : null), { refreshInterval: 60_000 })
  const s = q.data && q.data.range === range && q.data.metric === metric ? q.data : null
  const c = copy[metric]
  const fine = range === "1h" || range === "24h" || range === "7d"
  const tick = (v: string) => (range === "7d" ? dayFmt.format(new Date(v)) : fine ? timeFmt.format(new Date(v)) : dayFmt.format(new Date(v)))
  const label = (v: string) => (fine ? `${dayTimeFmt.format(new Date(v))} UTC` : longDayFmt.format(new Date(v)))
  const cur = s?.currency ?? "USD"
  // Minor units; a currency the markets config doesn't know still reads, without its symbol.
  const money = (n: number) => (cur in currencies ? formatMoney(Math.round(n), cur as CurrencyCode, { compact: true }) : `${cur} ${int(n / 100)}`)
  const fmt = metric === "latency" ? ms : metric === "revenue" ? money : int
  const data = useMemo(() => (s ? s.points.map((p) => ({ date: new Date(p.at).toISOString(), primary: p.primary, secondary: p.secondary ?? null })) : []), [s])
  const sum = s?.summary
  const peakAt = sum?.peak ? (fine ? `${dayTimeFmt.format(new Date(sum.peak.at))} UTC` : longDayFmt.format(new Date(sum.peak.at))) : null

  const stats = !s
    ? []
    : metric === "latency"
      ? [
          { label: "p95 over the range", value: sum?.p95 == null ? "–" : ms(sum.p95) },
          { label: "p50 over the range", value: sum?.p50 == null ? "–" : ms(sum.p50) },
          { label: "Average", value: sum?.average == null ? "–" : ms(sum.average) },
          { label: peakAt ? `Slowest, ${peakAt}` : "Slowest bucket", value: sum?.peak ? ms(sum.peak.value) : "–", attention: !!sum?.peak && sum.peak.value > 400 },
        ]
      : [
          { label: metric === "revenue" ? `Paid sales, ${s.currency ?? "no currency"}` : `${c.primary}, total`, value: fmt(sum?.total ?? 0) },
          { label: `Average a ${fine ? (range === "7d" ? "hour" : range === "24h" ? "15 min" : "minute") : "day"}`, value: sum?.average == null ? "–" : metric === "revenue" ? money(sum.average) : sum.average < 10 && sum.average > 0 ? sum.average.toFixed(1) : int(sum.average) },
          { label: peakAt ? `Peak, ${peakAt}` : "Peak", value: sum?.peak ? fmt(sum.peak.value) : "–", attention: metric === "errors" && !!sum?.peak },
          { label: "Latest", value: sum?.latest == null ? "–" : fmt(sum.latest) },
        ]

  return (
    <Panel
      id="activity"
      title="Activity"
      description={`${c.what} over ${rangeWords[range]} (UTC).`}
      className={cn("scroll-mt-24 rounded-[20px]", className)}
    >
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        {/* Switches sit in the body, not the header, so a phone keeps the title and description full width. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Switch label="Metric" size="sm" value={metric} onChange={setMetric} options={METRIC_OPTIONS} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {metric === "revenue" && s && s.currencies.length > 1 ? <Switch label="Currency" size="sm" value={s.currency ?? s.currencies[0]!} onChange={(v) => setCurrency(v)} options={s.currencies.map((x) => ({ value: x, label: x }))} /> : null}
          <Switch label="Range" size="sm" value={range} onChange={setRange} options={RANGE_OPTIONS} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {(s ? stats : Array.from({ length: 4 }, (_, i) => ({ label: `s${i}`, value: "", attention: false }))).map((x) => (
          <div key={x.label} className="admin-inset min-w-0 px-3 py-2.5">
            {s ? <dt className="truncate text-[11px] text-ink-3">{x.label}</dt> : <span aria-hidden className="skeleton block h-3 w-20 rounded" />}
            <dd className={cn("font-metric mt-1.5 truncate text-[1.375rem]", "attention" in x && x.attention ? "text-acid" : "text-ink")}>{s ? x.value : <span aria-hidden className="skeleton inline-block h-5 w-16 rounded align-middle" />}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        {q.error && !s ? (
          <PanelError message="Couldn't load the activity figures. They retry every minute." onRetry={() => void q.revalidate()} />
        ) : s && !s.hasData ? (
          <EmptyState icon={ChartLineUpIcon} title={metric === "requests" || metric === "latency" ? "No requests recorded in this range yet" : c.empty} body={metric === "requests" || metric === "latency" ? c.empty : "Try a longer range, or check back once the marketplace is busier."} className="py-12" />
        ) : (
          <AdminAreaChart key={`${range}-${metric}-${s?.currency ?? ""}`} data={data} primary={{ key: "primary", label: metric === "revenue" && s?.currency ? `${c.primary} (${s.currency})` : c.primary }} secondary={{ key: "secondary", label: c.secondary }} format={fmt} tickFormat={tick} labelFormat={label} height={260} />
        )}
      </div>
    </Panel>
  )
}

/* ── The year heatmap ─────────────────────────────────────────────────── */

type HeatmapResponse = { metric: HeatmapMetric; timeZone: string; today: string; from: string; days: Record<string, number>; total: number; activeDays: number }

const HEAT_OPTIONS: { value: HeatmapMetric; label: string }[] = [
  { value: "activity", label: "All activity" },
  { value: "orders", label: "Orders" },
  { value: "requests", label: "Requests" },
]
const heatUnit: Record<HeatmapMetric, (n: number) => string> = {
  activity: (n) => `${int(n)} ${n === 1 ? "event" : "events"}`,
  orders: (n) => `${int(n)} ${n === 1 ? "order" : "orders"}`,
  requests: (n) => `${int(n)} ${n === 1 ? "request" : "requests"}`,
}
const heatWords: Record<HeatmapMetric, string> = {
  activity: "Orders, sign-ups, brand applications, products published and messages, per UTC day.",
  orders: "Orders placed across every brand, per UTC day.",
  requests: "API requests the server answered, per UTC day.",
}

/** 53 Monday-first week columns ending in the week holding `today`; every past day is a data day. */
export function yearGrid(days: Record<string, number>, today: string, weeks = 53) {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const firstMonday = addDays(today, -dow - 7 * (weeks - 1))
  const columns = Array.from({ length: weeks }, (_, c) => addDays(firstMonday, c * 7))
  const cells: HeatCell[][] = weekdays.map((_, r) => columns.map((monday) => {
    const date = addDays(monday, r)
    return date > today ? { date, value: 0, state: "future" as const } : { date, value: days[date] ?? 0, state: "data" as const }
  }))
  const data = cells.flat().filter((c) => c.state === "data")
  const max = Math.max(0, ...data.map((c) => c.value))
  const atMax = max ? data.filter((c) => c.value === max) : []
  // The longest run of days in a row with any activity, ending on or before today.
  let streak = 0
  let best = 0
  for (const c of [...data].sort((a, b) => a.date.localeCompare(b.date))) {
    streak = c.value > 0 ? streak + 1 : 0
    best = Math.max(best, streak)
  }
  return { columns, cells, max, peak: atMax.length === 1 ? atMax[0]! : null, maxDays: atMax.length, best }
}

/** A GitHub-style year of daily activity (Health and the Overview). */
export function ActivityHeatmap({ className, defaultMetric = "activity" }: { className?: string; defaultMetric?: HeatmapMetric }) {
  const [metric, setMetric] = useState<HeatmapMetric>(defaultMetric)
  const q = useApi(`admin:metrics:heatmap:${metric}`, () => api<HeatmapResponse>(`/api/admin/metrics/heatmap?metric=${metric}`), { refreshInterval: 5 * 60_000 })
  const s = q.data && q.data.metric === metric ? q.data : null
  const grid = useMemo(() => yearGrid(s?.days ?? {}, s?.today ?? new Date().toISOString().slice(0, 10)), [s])
  const unit = heatUnit[metric]
  // Narrow screens scroll the year sideways: open on the latest weeks, as GitHub does.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [s])

  return (
    <Panel
      id="activity-year"
      title="Activity, last 12 months"
      description={heatWords[metric]}
      className={cn("scroll-mt-24 rounded-[20px]", className)}
    >
      <Switch label="Heatmap" size="sm" value={metric} onChange={setMetric} options={HEAT_OPTIONS} className="mb-4" />
      {q.error && !s ? (
        <PanelError message="Couldn't load the year of activity. It retries every few minutes." onRetry={() => void q.revalidate()} />
      ) : s && s.total === 0 ? (
        <EmptyState icon={metric === "requests" ? WarningIcon : SquaresFourIcon} title="Nothing recorded yet" body={metric === "requests" ? "Each day fills in from the server's request counts, written once a minute." : "Each square fills in as shoppers sign up, brands apply and publish, orders come in and messages are sent."} className="py-12" />
      ) : (
        // 53 week columns need about 680 px: narrower, the year scrolls sideways (as GitHub's does).
        <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
          <Heatmap
            className="min-w-[680px]"
            ready={!!s}
            rows={weekdays}
            columns={grid.columns}
            cells={grid.cells}
            unit={unit}
            label={`${HEAT_OPTIONS.find((o) => o.value === metric)!.label} per day over the last 12 months`}
            stats={[
              { label: "In 12 months", value: s ? `${unit(s.total)} on ${int(s.activeDays)} ${s.activeDays === 1 ? "day" : "days"}` : "" },
              { label: "Longest run", value: grid.best ? `${int(grid.best)} ${grid.best === 1 ? "day" : "days"} in a row` : "None yet" },
              { label: "Most in a day", value: grid.max ? (grid.peak ? <><PeakSwatch />{unit(grid.max)} on {shortDate(grid.peak.date)}</> : `${unit(grid.max)} on ${grid.maxDays} days`) : "None yet" },
            ]}
          />
        </div>
      )}
    </Panel>
  )
}

/**
 * The Overview's year of activity: shown to the roles that may read Health's metrics (audit.view,
 * as GET /api/admin/metrics/heatmap checks), and while signed out (the page asks to sign in).
 */
export function OverviewActivityHeatmap({ className }: { className?: string }) {
  const admin = useServerSession((s) => s.admin)
  if (admin && !canAdmin(admin.role, "audit.view")) return null
  return <ActivityHeatmap className={className} />
}
