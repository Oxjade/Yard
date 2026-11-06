"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowsClockwiseIcon as Returning, CalendarDotsIcon as CalendarClock, CaretRightIcon as ChevronRight, CoinsIcon as Coins, EyeIcon as Eye, FunnelSimpleIcon as Funnel, HeartIcon as Heart, MapPinIcon as MapPin, MegaphoneIcon as Megaphone, StackIcon as PackageSearch, ReceiptIcon as Receipt, ShoppingCartIcon as Cart } from "@phosphor-icons/react"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { StatusBadge, campaignStatusMeta } from "@/components/dashboard/status-badge"
import { change } from "@/components/dashboard/insight/derive"
import { InsightPanel as Panel } from "@/components/dashboard/insight/insight-panel"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { InfoTip } from "@/components/feedback/info-tip"
import { useGrowth, useGrowthReady } from "@/components/studio/growth/store"
import { campaignMetrics, dropRevenue, dropStatusMeta, dropUnitsSold, notifyCount, studioDropStatus } from "@/components/studio/growth/utils"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { ATTRIBUTION, campaignTypes } from "@/lib/data/ads"
import { brandById } from "@/lib/data/brands"
import { dropWindow } from "@/lib/drops"
import { convert, formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { DAY_MS, countryName, formatDate, noise, plural, returningRate } from "./model"
import { Thumb } from "@/components/studio/catalog/parts"
import { bestSellers, lowConversion, periodSummary, productTraffic, salesByProduct, useBrandSeries, type ProductSales } from "./brand-series"
import { ShareBar } from "./shared"
import { AnalyticsBodySkeleton, analyticsDescription } from "./skeletons"

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
        description={analyticsDescription(brand.name)}
        actions={<Segmented label="Period" value={period} onChange={setPeriod} options={periods.map((p) => ({ value: p, label: periodLabel[p] }))} className="w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none" />}
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <p className="text-xs text-ink-3">Orders and revenue come from your orders in Studio. Visits, views and saves are generated sample traffic.</p>
        </div>
      </PageHeader>

      {ready ? (
        <AnalyticsBody period={period} brandId={brandId} currency={brand.currency} followers={brand.followers} />
      ) : (
        <div role="status" aria-label="Loading analytics">
          <AnalyticsBodySkeleton />
        </div>
      )}
    </div>
  )
}

type ProductRow = ProductSales

function AnalyticsBody({ period, brandId, currency: cur, followers }: { period: Period; brandId: string; currency: CurrencyCode; followers: number }) {
  const orders = useStudio((s) => s.orders)
  const products = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const campaigns = useStudio((s) => s.campaigns)
  const dropMeta = useGrowth((s) => s.dropMeta)
  const clock = useNow(60_000)
  const [trend, setTrend] = useState<TrendMetric>("revenue")

  /*
   * One source for every order figure on the page, shared with the Overview: the orders in
   * Studio. Only visits, product views and saves come from the sample generator (labelled as
   * sample data in the header).
   */
  const brandSeries = useBrandSeries(brandId)
  const { series } = brandSeries

  const days = periodDays[period]
  const summary = useMemo(() => periodSummary(brandSeries, days), [brandSeries, days])
  const { now, prev, comparable, firstDay, lastDay, orders: current } = summary
  // Order figures compare only when the period before lies inside the order history, as on the Overview.
  const delta = (a: number, b: number) => (comparable ? change(a, b) : null)
  const trafficDelta = (a: number, b: number) => change(a, b)
  const versus = `the ${periodLabel[period].toLowerCase()} before`

  // The period is the last `days` calendar days of the series, so lists and tiles cover the same orders.
  const from = Date.parse(`${firstDay}T00:00:00Z`)
  const to = Date.parse(`${lastDay}T00:00:00Z`) + DAY_MS
  const ret = returningRate(orders, from, to)
  const retPrev = returningRate(orders, from - days * DAY_MS, from)
  // A rate changes in points: 47% to 69% is up 22 points, not 45%. Taken from the rounded
  // percentages the page shows, so the difference is the one a reader works out.
  const retPoints = comparable && retPrev.customers ? Math.round(ret.rate * 100) - Math.round(retPrev.rate * 100) : null

  const money = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  // The chart covers exactly the selected period, so its total matches the figure above it.
  const chartDays = days
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
  const sold = useMemo(() => salesByProduct(current), [current])
  const best: ProductRow[] = bestSellers(sold)

  /* Locations */
  const locations = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of current) m.set(o.shippingAddress.country, (m.get(o.shippingAddress.country) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [current])

  /* Views and saves per product, shared out from the period's totals (the same split as the Overview). */
  const traffic = productTraffic(products, now.productViews, now.wishlists)
  const lowConv = lowConversion(traffic, sold, best)
  const mostSaved = traffic.live
    .map((p) => ({ product: p, saves: traffic.savesBy.get(p.id) ?? 0 }))
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
    <div className="grid gap-3">
      <section aria-labelledby="analytics-key-metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <h2 id="analytics-key-metrics" className="sr-only">Key metrics</h2>
        <StatCard icon={Coins} label="Revenue" value={now.revenue} format={money} delta={delta(now.revenue, prev.revenue)} deltaContext={versus} hint={<MetricHint tip="Item subtotal of paid orders placed in the period, before refunds. Shipping and tax aren't included.">Item subtotal, before refunds</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        <StatCard icon={Cart} label="Orders" value={now.orders} format={(n) => formatNumber(Math.round(n))} delta={delta(now.orders, prev.orders)} deltaContext={versus} hint={<MetricHint tip="Paid orders placed in the period. Cancelled and unpaid orders don't count.">Paid orders</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        <StatCard icon={Funnel} label="Conversion rate" value={now.conversion} format={(n) => formatPercent(n, 2)} delta={delta(now.conversion, prev.conversion)} deltaContext={versus} hint={<MetricHint tip="Orders divided by store visits in the same period. Visits are sample traffic in this build.">Orders ÷ visits</MetricHint>} href="/studio/products" hrefLabel="Open products" />
        <StatCard icon={Receipt} label="Average order value" value={now.aov} format={money} delta={delta(now.aov, prev.aov)} deltaContext={versus} hint={<MetricHint tip="Revenue divided by orders in the period.">Revenue ÷ orders</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        {/* A share changes in points, so the change sits in the footnote ("up 22 pts") rather than in a percent chip. */}
        <StatCard icon={Returning} label="Returning customers" value={ret.rate} format={(n) => formatPercent(n, 0)} hint={<MetricHint tip={`Customers who ordered in the period and had ordered from you before, as a share of everyone who ordered in the period.${retPoints === null ? "" : ` ${formatPercent(retPrev.rate, 0)} in ${versus}.`}`}>{`${ret.returning} of ${plural(ret.customers, "customer")}${pointsText(retPoints)}`}</MetricHint>} href="/studio/customers" hrefLabel="Open customers" />
        <StatCard icon={Heart} label="Wishlist adds" value={now.wishlists} format={(n) => formatNumber(Math.round(n))} delta={trafficDelta(now.wishlists, prev.wishlists)} deltaContext={versus} hint={<MetricHint tip="Times shoppers saved one of your products. Sample traffic in this build.">Saves of your products</MetricHint>} href="/studio/products" hrefLabel="Open products" />
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          className="min-w-0"
          title="Sales trend"
          description={trend === "revenue" ? `Daily revenue in ${cur}, last ${periodLabel[period].toLowerCase()}. The dashed line is the period before.` : `Paid orders per day, last ${periodLabel[period].toLowerCase()}. Grey bars are the period before.`}
          action={<Segmented label="Chart metric" size="sm" value={trend} onChange={setTrend} options={[{ value: "revenue", label: "Revenue" }, { value: "orders", label: "Orders" }]} />}
        >
          <p className="mb-3 font-metric text-[2rem] leading-none text-ink">{trend === "revenue" ? formatMoney(now.revenue, cur) : plural(now.orders, "order")}</p>
          <TimeSeriesChart
            key={trend}
            data={chart}
            kind={trend === "revenue" ? "area" : "bar"}
            series={trend === "revenue" ? [{ key: "revenue", label: "Revenue" }, { key: "previous", label: "Previous period" }] : [{ key: "orders", label: "Orders" }, { key: "previous", label: "Previous period" }]}
            format={trend === "revenue" ? money : (n) => formatNumber(n)}
            height={280}
          />
          {(trend === "revenue" ? now.revenue : now.orders) === 0 ? <p className="mt-2 text-xs text-ink-3">No paid orders in this period yet.</p> : null}
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

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="min-w-0" title="Best sellers" href="/studio/products" hrefLabel="Open products" description={`Units ordered in the last ${periodLabel[period].toLowerCase()}, before refunds.`}>
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
          {lowConv.length ? (
            <>
              <ul className="divide-y divide-line-soft">
                {lowConv.map(({ product, views, units, rate, soldOut }) => (
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

      <div className="grid gap-3 lg:grid-cols-3">
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

        <Panel className="min-w-0" title="Returning customers" description="Customers this period who had ordered from you before." href="/studio/customers" hrefLabel="Open customers">
          <p className="font-metric text-[2.25rem] leading-none text-ink">{formatPercent(ret.rate, 0)}</p>
          <p className="mt-1 text-xs text-ink-2 tabular">{ret.returning} of {plural(ret.customers, "customer")} came back</p>
          <ShareBar share={ret.rate} className="mt-4 h-2.5" />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-purple" aria-hidden /><dt className="text-ink-2">Returning</dt><dd className="ml-auto text-ink tabular">{ret.returning}</dd></div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-white/20" aria-hidden /><dt className="text-ink-2">First order</dt><dd className="ml-auto text-ink tabular">{ret.customers - ret.returning}</dd></div>
          </dl>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-3">Counted across all your orders, not just this period. Previous period: {formatPercent(retPrev.rate, 0)}{retPoints === null ? "" : retPoints === 0 ? ", no change" : `, ${retPoints > 0 ? "up" : "down"} ${Math.abs(retPoints)} ${Math.abs(retPoints) === 1 ? "point" : "points"}`}.</p>
        </Panel>
      </div>

      <Panel title="Drop performance" description="Sell-through is units sold against units allocated to the drop." href="/studio/drops" hrefLabel="All drops" bodyClassName="px-0 md:px-0 pb-0 md:pb-0">
        {dropRows.length === 0 ? (
          <div className="border-t border-white/[0.06] p-4 md:p-5">
            <EmptyState icon={CalendarClock} title="No drops yet" body="Schedule a limited release with a countdown. Follower alerts start once the catalogue backend is connected." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new">Plan a drop</Link></Button>} className="py-10" />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06] md:hidden">
              {dropRows.map((r) => (
                <li key={r.drop.id}>
                  <Link href={`/studio/drops/${r.drop.id}`} className="flex items-start gap-3 px-4 py-3">
                    <Thumb image={r.drop.image} size={48} />
                    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">{r.drop.name}</span>
                        <StatusBadge tone={dropStatusMeta[r.status].tone} className="shrink-0">{dropStatusMeta[r.status].label}</StatusBadge>
                      </span>
                      <span className="text-xs text-ink-2 tabular">{r.sold} of {r.drop.totalUnits} sold, {r.notify ? `${formatNumber(r.notify)} waiting for alerts` : "no alert sign-ups yet"}</span>
                      <ShareBar share={r.drop.totalUnits ? r.sold / r.drop.totalUnits : 0} tone="acid" />
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-y border-white/[0.06] text-xs text-ink-3">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Drop</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Release</th>
                    <th scope="col" className="w-[200px] px-3 py-2.5 font-normal">Sell-through</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-normal">Notify sign-ups</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-normal md:px-5">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
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
                        <td className="px-3 py-3 text-right text-ink tabular">{r.notify ? formatNumber(r.notify) : <span className="text-ink-3">None yet</span>}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-ink tabular md:px-5">{r.revenue ? formatMoney(r.revenue, cur) : <span className="text-ink-3">Not released</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel
        className="min-w-0"
        title="Campaign performance"
        description={`Paid placements, all time. Orders count when a shopper clicked within ${ATTRIBUTION.clickDays} days or saw the placement within ${ATTRIBUTION.viewDays} day.`}
        href="/studio/advertising"
        hrefLabel="Open advertising"
      >
        {campaigns.length ? (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Spend", value: usd(cm.spend) },
                { label: "Impressions", value: formatNumber(cm.impressions, { compact: true }) },
                { label: "Clicks", value: `${formatNumber(cm.clicks)}` },
                { label: "Click-through", value: formatPercent(cm.ctr, 2) },
                { label: "Attributed orders", value: formatNumber(cm.purchases) },
                { label: "Return on spend", value: cm.roas === null ? "None yet" : `${cm.roas.toFixed(1)}×` },
              ].map((s) => (
                <div key={s.label} className="bg-surface px-3 py-2.5">
                  <dt className="text-[11px] text-ink-3">{s.label}</dt>
                  <dd className="mt-1 font-metric text-xl leading-none text-ink">{s.value}</dd>
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
    </div>
  )
}

/** ", up 22 pts" for a share's change in percentage points; nothing when there's no period to compare. */
function pointsText(points: number | null) {
  if (points === null) return ""
  return points === 0 ? ", no change" : `, ${points > 0 ? "up" : "down"} ${Math.abs(points)} pts`
}

/** A KPI card's footnote with the metric's definition behind an info icon. */
function MetricHint({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate">{children}</span>
      <InfoTip label="What this counts" className="-my-1 shrink-0">{tip}</InfoTip>
    </span>
  )
}
