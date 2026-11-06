"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { CalendarDotsIcon as CalendarClock, CaretRightIcon as ChevronRight, EyeIcon as Eye, MapPinIcon as MapPin, MegaphoneIcon as Megaphone, StackIcon as PackageSearch } from "@phosphor-icons/react"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { PeriodSelect, periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { StatusBadge, campaignStatusMeta } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { ChartSkeleton, MetricRowSkeleton } from "@/components/feedback/skeletons"
import { useGrowth, useGrowthReady } from "@/components/studio/growth/store"
import { campaignMetrics, dropRevenue, dropStatusMeta, dropUnitsSold, notifyCount, studioDropStatus } from "@/components/studio/growth/utils"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { ATTRIBUTION, campaignTypes } from "@/lib/data/ads"
import { brandDailySeries, sumSeries } from "@/lib/data/analytics"
import { brandById } from "@/lib/data/brands"
import { dropWindow } from "@/lib/drops"
import { convert, formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { spring } from "@/lib/motion"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import type { MerchantOrder } from "@/lib/data/types"
import { DAY_MS, countryName, formatDate, noise, plural, returningRate } from "./model"
import { Panel } from "@/components/studio/catalog/fields"
import { Thumb } from "@/components/studio/catalog/parts"
import { ShareBar } from "./shared"

type TrendMetric = "revenue" | "orders"

const periods: Period[] = ["7d", "30d", "90d"]

export function AnalyticsView() {
  const ready = useGrowthReady()
  const [period, setPeriod] = useState<Period>("30d")
  const brandId = useStudio((s) => s.brandId)
  const brand = brandById.get(brandId)!

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Analytics"
        description={`How shoppers find, consider and buy from ${brand.name} over the last ${periodLabel[period].toLowerCase()}, compared with the period before.`}
        actions={<PeriodSelect value={period} onChange={setPeriod} options={periods} />}
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {ready ? (
        <AnalyticsBody period={period} brandId={brandId} currency={brand.currency} followers={brand.followers} />
      ) : (
        <div role="status" aria-label="Loading analytics" className="grid gap-6">
          <MetricRowSkeleton count={6} />
          <div className="rounded-lg border border-line-soft bg-card p-4 md:p-5"><ChartSkeleton height={280} /></div>
        </div>
      )}
    </div>
  )
}

/** The orders this page counts: paid orders placed in the period, before refunds. Cancelled and unpaid ones never count. */
const counted = (o: MerchantOrder) => o.status !== "cancelled" && o.status !== "pending_payment"

type ProductRow = { id: string; name: string; image: MerchantOrder["lines"][number]["image"]; units: number; revenue: number }

function AnalyticsBody({ period, brandId, currency: cur, followers }: { period: Period; brandId: string; currency: CurrencyCode; followers: number }) {
  const orders = useStudio((s) => s.orders)
  const products = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const campaigns = useStudio((s) => s.campaigns)
  const dropMeta = useGrowth((s) => s.dropMeta)
  const clock = useNow(60_000)
  const [trend, setTrend] = useState<TrendMetric>("revenue")

  /*
   * One source for every order figure on the page: the orders in Studio. Only visits, product
   * views and saves come from the sample generator (labelled as sample data in the header).
   */
  const sample = useMemo(() => brandDailySeries(brandId, 180), [brandId])
  const series = useMemo(() => {
    const byDay = new Map<string, { orders: number; revenue: number }>()
    for (const o of orders) {
      if (!counted(o)) continue
      const day = o.placedAt.slice(0, 10)
      const row = byDay.get(day) ?? { orders: 0, revenue: 0 }
      row.orders += 1
      row.revenue += o.subtotal
      byDay.set(day, row)
    }
    return sample.map((p) => ({ ...p, orders: byDay.get(p.date)?.orders ?? 0, revenue: byDay.get(p.date)?.revenue ?? 0 }))
  }, [sample, orders])

  const days = periodDays[period]
  const now = sumSeries(series, series.length - days)
  const prev = sumSeries(series, series.length - days * 2, series.length - days)
  const delta = (a: number, b: number) => (b ? (a - b) / b : null)

  // The period is the last `days` calendar days of the series, so lists and tiles cover the same orders.
  const firstDay = series[series.length - days].date
  const lastDay = series[series.length - 1].date
  const from = Date.parse(`${firstDay}T00:00:00Z`)
  const to = Date.parse(`${lastDay}T00:00:00Z`) + DAY_MS
  const current = useMemo(() => orders.filter((o) => counted(o) && o.placedAt.slice(0, 10) >= firstDay && o.placedAt.slice(0, 10) <= lastDay), [orders, firstDay, lastDay])
  const ret = returningRate(orders, from, to)
  const retPrev = returningRate(orders, from - days * DAY_MS, from)

  const money = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  const chartDays = Math.max(days, 14)
  const chart = series.slice(-chartDays).map((p, i) => {
    const before = series[series.length - chartDays * 2 + i]
    return { date: p.date, revenue: p.revenue, orders: p.orders, previous: (trend === "revenue" ? before?.revenue : before?.orders) ?? 0, wishlists: p.wishlists }
  })

  /* Funnel: sample sessions, then the period's orders */
  const viewed = Math.round(now.visits * (0.56 + noise(`${brandId}-${period}-pv`) * 0.08))
  const bagged = Math.max(now.orders, Math.round(now.visits * (0.052 + noise(`${brandId}-${period}-bag`) * 0.02)))
  const funnel = [
    { label: "Store visits", value: now.visits, hint: "Sessions on your storefront, product and drop pages." },
    { label: "Viewed a product", value: viewed, hint: "Sessions that opened at least one product page." },
    { label: "Added to bag", value: bagged, hint: "Sessions that added one of your products to the bag." },
    { label: "Ordered", value: now.orders, hint: "Paid orders placed in the period, before refunds. Cancelled orders don't count." },
  ]

  /* Units ordered per product in the period */
  const sold = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const o of current) {
      for (const l of o.lines) {
        const row = m.get(l.productId) ?? { id: l.productId, name: l.name, image: l.image, units: 0, revenue: 0 }
        row.units += l.quantity
        row.revenue += l.unitPrice * l.quantity
        m.set(l.productId, row)
      }
    }
    return m
  }, [current])
  const best = [...sold.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 5)

  /* Locations */
  const locations = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of current) m.set(o.shippingAddress.country, (m.get(o.shippingAddress.country) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [current])

  /*
   * Views and saves per product: the period's sample totals, shared out by how often each live
   * product is viewed and saved, so they add up to the funnel and the wishlist figures above.
   */
  const live = products.filter((p) => p.status === "published")
  const share = (total: number, weight: (p: (typeof live)[number]) => number) => {
    const sum = live.reduce((s, p) => s + weight(p), 0)
    return new Map(live.map((p) => [p.id, sum ? Math.round((total * weight(p)) / sum) : 0]))
  }
  const viewsBy = share(now.productViews, (p) => p.stats?.views7d ?? 0)
  const savesBy = share(now.wishlists, (p) => p.stats?.wishlists ?? 0)

  const bestIds = new Set(best.map((b) => b.id))
  const viewCounts = live.map((p) => viewsBy.get(p.id) ?? 0).sort((a, b) => a - b)
  const medianViews = viewCounts[Math.floor(viewCounts.length / 2)] ?? 0
  const lowConversion = live
    .filter((p) => !bestIds.has(p.id) && (viewsBy.get(p.id) ?? 0) > 0 && (viewsBy.get(p.id) ?? 0) >= medianViews)
    .map((p) => {
      const views = viewsBy.get(p.id) ?? 0
      const units = sold.get(p.id)?.units ?? 0
      return { product: p, views, units, rate: units / views, soldOut: p.variants.filter((v) => v.stock <= 0).length }
    })
    .sort((a, b) => a.rate - b.rate || b.views - a.views)
    .slice(0, 3)
  const mostSaved = live
    .map((p) => ({ product: p, saves: savesBy.get(p.id) ?? 0 }))
    .filter((r) => r.saves > 0)
    .sort((a, b) => b.saves - a.saves)
    .slice(0, 4)

  /* Drops */
  const anchor = clock === null ? null : getDemoAnchor()
  const dropRows = drops.map((d) => {
    const status = studioDropStatus(d, dropMeta[d.id], clock, anchor)
    return { drop: d, status, sold: dropUnitsSold(d), notify: notifyCount(d, status, followers), revenue: dropRevenue(d, cur), release: anchor === null ? null : dropWindow(d, anchor).release }
  })

  /* Campaigns */
  const cm = campaignMetrics(campaigns)
  const usd = (n: number) => formatMoney(convert(n, "USD", cur), cur, { compact: true })

  return (
    <>
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Revenue" value={now.revenue} format={money} delta={delta(now.revenue, prev.revenue)} hint="item subtotal, before refunds" />
        <MetricTile label="Orders" value={now.orders} format={(n) => formatNumber(Math.round(n))} delta={delta(now.orders, prev.orders)} />
        <MetricTile label="Conversion rate" value={now.conversion} format={(n) => formatPercent(n, 2)} delta={delta(now.conversion, prev.conversion)} hint="orders ÷ visits" />
        <MetricTile label="Average order value" value={now.aov} format={money} delta={delta(now.aov, prev.aov)} />
        <MetricTile label="Returning customers" value={ret.rate} format={(n) => formatPercent(n, 0)} delta={delta(ret.rate, retPrev.rate)} hint="ordered before" />
        <MetricTile label="Wishlist adds" value={now.wishlists} format={(n) => formatNumber(Math.round(n))} delta={delta(now.wishlists, prev.wishlists)} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          className="min-w-0"
          title="Sales trend"
          description={trend === "revenue" ? `Daily revenue in ${cur}. The dashed line is the previous period.` : "Paid orders per day. Grey bars are the previous period."}
          action={<TrendToggle value={trend} onChange={setTrend} />}
        >
          <p className="-mt-1 mb-3 text-xl font-medium text-ink tabular">{trend === "revenue" ? formatMoney(now.revenue, cur) : plural(now.orders, "order")}</p>
          <TimeSeriesChart
            key={trend}
            data={chart}
            kind={trend === "revenue" ? "area" : "bar"}
            series={trend === "revenue" ? [{ key: "revenue", label: "Revenue" }, { key: "previous", label: "Previous period" }] : [{ key: "orders", label: "Orders" }, { key: "previous", label: "Previous period" }]}
            format={trend === "revenue" ? money : (n) => formatNumber(n)}
            height={280}
          />
        </Panel>

        <Panel className="min-w-0" title="Conversion funnel" description={`From visit to order, last ${periodLabel[period].toLowerCase()}.`}>
          <ol className="grid gap-4">
            {funnel.map((f, i) => {
              const prevStep = i ? funnel[i - 1].value : null
              return (
                <li key={f.label} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-1 text-sm text-ink">
                      {f.label}
                      <InfoTip label={`About ${f.label.toLowerCase()}`}>{f.hint}</InfoTip>
                    </span>
                    <span className="text-sm text-ink tabular">{formatNumber(f.value)}</span>
                  </div>
                  <ShareBar share={now.visits ? f.value / now.visits : 0} tone={i === funnel.length - 1 ? "acid" : "purple"} className="h-2.5" />
                  <span className="text-xs text-ink-3 tabular">{prevStep === null ? "Every session starts here" : `${formatPercent(prevStep ? f.value / prevStep : 0, 1)} of the step before`}</span>
                </li>
              )
            })}
          </ol>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-2">
            Overall, <span className="text-ink tabular">{formatPercent(now.conversion, 2)}</span> of visits ended in an order.
          </p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="min-w-0" title="Best sellers" description={`Units ordered in the last ${periodLabel[period].toLowerCase()}, before refunds.`}>
          {best.length ? (
            <ol className="grid gap-3">
              {best.map((p, i) => (
                <li key={p.id}>
                  <Link href={`/studio/products/${p.id}`} className="group flex items-center gap-3 rounded-md">
                    <span className="w-4 text-xs text-ink-3 tabular">{i + 1}</span>
                    <Thumb image={p.image} size={40} />
                    <span className="grid min-w-0 flex-1 gap-1.5">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm text-ink group-hover:text-violet">{p.name}</span>
                        <span className="shrink-0 text-xs text-ink-2 tabular">{plural(p.units, "unit")}, {formatMoney(p.revenue, cur, { compact: true })}</span>
                      </span>
                      <ShareBar share={p.units / best[0].units} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={PackageSearch} title="No sales in this period" body="Try a longer period, or check back after your next orders." className="py-10" />
          )}
        </Panel>

        <Panel className="min-w-0" title="High views, low conversion" description={`The products with the most views for each order in the last ${periodLabel[period].toLowerCase()}. Best sellers are left out.`}>
          {lowConversion.length ? (
            <>
              <ul className="divide-y divide-line-soft">
                {lowConversion.map(({ product, views, units, rate, soldOut }) => (
                  <li key={product.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Thumb image={product.images[0]} size={48} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm text-ink">{product.name}</span>
                      <span className="text-xs text-ink-2 tabular">{plural(views, "view")}, {plural(units, "unit")} ordered</span>
                      <span className="text-xs text-ink-3 tabular">
                        {units ? `${formatPercent(rate, 2)} of views became an order` : "No orders yet this period"}
                        {soldOut ? <span className="text-acid">, {plural(soldOut, "variant")} out of stock</span> : null}
                      </span>
                    </span>
                    <Button asChild size="xs" variant="secondary" className="shrink-0">
                      {soldOut ? <Link href="/studio/inventory">Restock</Link> : <Link href={`/studio/products/${product.id}`}>Review</Link>}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-3">Views are this period&apos;s product views, shared out by how often each product is opened. Units come from your orders, the same ones counted in Best sellers.</p>
            </>
          ) : (
            <EmptyState icon={Eye} title="Nothing stands out" body="Every well-viewed product is selling in line with its views this period." className="py-10" />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Wishlist activity" description={`${formatNumber(now.wishlists)} saves in the last ${periodLabel[period].toLowerCase()}.`} className="min-w-0 lg:col-span-1">
          <TimeSeriesChart data={chart} kind="bar" series={[{ key: "wishlists", label: "Saves" }]} format={(n) => formatNumber(n)} height={140} />
          {mostSaved.length ? (
            <>
              <h3 className="mt-4 text-xs text-ink-3">Most saved this period</h3>
              <ul className="mt-2 grid gap-2">
                {mostSaved.map(({ product, saves }) => (
                  <li key={product.id} className="flex items-center gap-2.5">
                    <Thumb image={product.images[0]} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{product.name}</span>
                    <span className="text-xs text-ink-2 tabular">{formatNumber(saves)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Panel>

        <Panel className="min-w-0" title="Customer locations" description="Where this period's orders shipped to.">
          {locations.length ? (
            <ul className="grid gap-3">
              {locations.map(([code, count]) => (
                <li key={code} className="grid gap-1.5">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">{countryName(code)}</span>
                    <span className="text-xs text-ink-2 tabular">{plural(count, "order")}, {formatPercent(count / current.length, 0)}</span>
                  </span>
                  <ShareBar share={count / locations[0][1]} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MapPin} title="No orders in this period" body="Locations appear once orders ship to them." className="py-10" />
          )}
        </Panel>

        <Panel className="min-w-0" title="Returning customers" description="Customers this period who had ordered from you before.">
          <p className="text-3xl font-medium tracking-tight text-ink tabular">{formatPercent(ret.rate, 0)}</p>
          <p className="mt-1 text-xs text-ink-2 tabular">{ret.returning} of {plural(ret.customers, "customer")} came back</p>
          <ShareBar share={ret.rate} className="mt-4 h-2.5" />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-purple" aria-hidden /><dt className="text-ink-2">Returning</dt><dd className="ml-auto text-ink tabular">{ret.returning}</dd></div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-white/20" aria-hidden /><dt className="text-ink-2">First order</dt><dd className="ml-auto text-ink tabular">{ret.customers - ret.returning}</dd></div>
          </dl>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-3">Counted across all your orders, not just this period. Previous period: {formatPercent(retPrev.rate, 0)}.</p>
        </Panel>
      </div>

      <section aria-labelledby="drops-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 md:px-5">
          <div>
            <h2 id="drops-title" className="text-sm font-medium text-ink">Drop performance</h2>
            <p className="mt-0.5 text-xs text-ink-2">Sell-through is units sold against units allocated to the drop.</p>
          </div>
          <Link href="/studio/drops" className="text-xs text-ink-2 hover:text-ink">All drops</Link>
        </div>
        {dropRows.length === 0 ? (
          <div className="border-t border-line-soft p-4 md:p-5">
            <EmptyState icon={CalendarClock} title="No drops yet" body="Schedule a limited release with a countdown your followers are told about." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new">Plan a drop</Link></Button>} className="py-10" />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line-soft border-t border-line-soft md:hidden">
              {dropRows.map((r) => (
                <li key={r.drop.id}>
                  <Link href={`/studio/drops/${r.drop.id}`} className="flex items-start gap-3 px-4 py-3">
                    <Thumb image={r.drop.image} size={48} />
                    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">{r.drop.name}</span>
                        <StatusBadge tone={dropStatusMeta[r.status].tone} className="shrink-0">{dropStatusMeta[r.status].label}</StatusBadge>
                      </span>
                      <span className="text-xs text-ink-2 tabular">{r.sold} of {r.drop.totalUnits} sold, {formatNumber(r.notify)} waiting for alerts</span>
                      <ShareBar share={r.drop.totalUnits ? r.sold / r.drop.totalUnits : 0} tone="acid" />
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-y border-line-soft bg-surface/60 text-xs text-ink-3">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Drop</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Release</th>
                    <th scope="col" className="w-[200px] px-3 py-2.5 font-normal">Sell-through</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-normal">Notify sign-ups</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-normal md:px-5">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {dropRows.map((r) => {
                    const st = r.drop.totalUnits ? r.sold / r.drop.totalUnits : 0
                    return (
                      <tr key={r.drop.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-4 py-3 md:px-5">
                          <span className="flex items-center gap-3">
                            <Thumb image={r.drop.image} size={36} />
                            <Link href={`/studio/drops/${r.drop.id}`} className="font-medium text-ink hover:text-violet">{r.drop.name}</Link>
                          </span>
                        </td>
                        <td className="px-3 py-3"><StatusBadge tone={dropStatusMeta[r.status].tone}>{dropStatusMeta[r.status].label}</StatusBadge></td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular">{r.release === null ? "" : formatDate(new Date(r.release).toISOString())}</td>
                        <td className="px-3 py-3">
                          <span className="grid gap-1.5">
                            <span className="text-xs text-ink-2 tabular">{r.sold} of {r.drop.totalUnits}, {formatPercent(st, 0)}</span>
                            <ShareBar share={st} tone="acid" />
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-ink tabular">{formatNumber(r.notify)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-ink tabular md:px-5">{r.revenue ? formatMoney(r.revenue, cur) : <span className="text-ink-3">Not released</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Panel
        className="min-w-0"
        title="Campaign performance"
        description={`Paid placements, all time. Orders count when a shopper clicked within ${ATTRIBUTION.clickDays} days or saw the placement within ${ATTRIBUTION.viewDays} day.`}
        action={<Link href="/studio/advertising" className="shrink-0 text-xs text-ink-2 hover:text-ink">Advertising</Link>}
      >
        {campaigns.length ? (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Spend", value: usd(cm.spend) },
                { label: "Impressions", value: formatNumber(cm.impressions, { compact: true }) },
                { label: "Clicks", value: `${formatNumber(cm.clicks)}` },
                { label: "Click-through", value: formatPercent(cm.ctr, 2) },
                { label: "Attributed orders", value: formatNumber(cm.purchases) },
                { label: "Return on spend", value: cm.roas === null ? "None yet" : `${cm.roas.toFixed(1)}×` },
              ].map((s) => (
                <div key={s.label} className="bg-card px-3 py-2.5">
                  <dt className="text-[11px] text-ink-3">{s.label}</dt>
                  <dd className="mt-1 text-base font-medium text-ink tabular">{s.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-4 divide-y divide-line-soft">
              {campaigns.map((c) => {
                const meta = campaignStatusMeta[c.status]
                return (
                  <li key={c.id}>
                    <Link href={`/studio/advertising/${c.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink hover:text-violet">{c.name}</span>
                        <span className="block text-xs text-ink-3">{campaignTypes[c.type].name}</span>
                      </span>
                      <StatusBadge tone={meta.tone} className="justify-self-end sm:order-last">{meta.label}</StatusBadge>
                      <span className="text-xs text-ink-2 tabular sm:text-right">{formatNumber(c.results.impressions)} impressions</span>
                      <span className="text-right text-xs text-ink-2 tabular">{plural(c.results.purchases, "order")}, {usd(c.results.revenue)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <EmptyState icon={Megaphone} title="No campaigns yet" body="Sponsored placements put your brand or products in labelled slots across the marketplace." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/advertising/new">Plan a campaign</Link></Button>} className="py-10" />
        )}
      </Panel>
    </>
  )
}

function TrendToggle({ value, onChange }: { value: TrendMetric; onChange: (v: TrendMetric) => void }) {
  const options: { value: TrendMetric; label: string }[] = [
    { value: "revenue", label: "Revenue" },
    { value: "orders", label: "Orders" },
  ]
  return (
    <div role="radiogroup" aria-label="Chart metric" className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} className={cn("relative h-7 rounded-[5px] px-2.5 text-xs transition-colors", on ? "text-ink" : "text-ink-2 hover:text-ink")}>
            {on ? <motion.span layoutId="trend-pill" aria-hidden className="absolute inset-0 rounded-[5px] bg-purple" transition={spring.indicator} /> : null}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
