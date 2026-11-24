"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowsClockwiseIcon as Returning, CalendarDotsIcon as CalendarClock, CaretRightIcon as ChevronRight, CoinsIcon as Coins, EyeIcon as Eye, FunnelSimpleIcon as Funnel, HeartIcon as Heart, MapPinIcon as MapPin, MegaphoneIcon as Megaphone, StackIcon as PackageSearch, ReceiptIcon as Receipt, ShoppingCartIcon as Cart } from "@phosphor-icons/react"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { change } from "@/components/dashboard/insight/derive"
import { InsightPanel as Panel } from "@/components/dashboard/insight/insight-panel"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { InfoTip } from "@/components/feedback/info-tip"
import { Thumb } from "@/components/studio/catalog/parts"
import { Button } from "@/components/ui/button"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api, ApiError } from "@/lib/api/client"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useRealtimeEventName } from "@/lib/realtime/use-realtime"
import type { BrandAnalytics, DropStat, ProductStat } from "@/server/analytics/brand-db"
import { countryName, formatDate, plural } from "./model"
import { ShareBar } from "./shared"
import { AnalyticsBodySkeleton, analyticsDescription } from "./skeletons"

type TrendMetric = "revenue" | "orders"
const periods: Period[] = ["7d", "30d", "90d"]

const asCurrency = (c: string | undefined): CurrencyCode => (c && c in currencies ? (c as CurrencyCode) : "NGN")
const thumb = (image: ProductStat["image"]) => (image ? { src: image.src, alt: image.alt, width: 1, height: 1 } : undefined)

/** Drop states as the Drops page words them. */
const dropMeta: Record<string, { label: string; tone: "info" | "muted" | "success" | "attention" }> = {
  draft: { label: "Draft", tone: "muted" },
  scheduled: { label: "Scheduled", tone: "attention" },
  live: { label: "Live", tone: "info" },
  sold_out: { label: "Sold out", tone: "success" },
  ended: { label: "Ended", tone: "muted" },
}

/**
 * Studio › Analytics for a real brand: the sample page's panels, every figure read from Yard's
 * server (GET /api/studio/analytics, memoised two minutes). Orders and revenue are the brand's
 * paid orders; visits, product views, saves and follows are the signals shoppers send from the
 * storefront and product pages. Days are UTC days. Advertising isn't on Yard yet, so its panel
 * says so instead of showing figures.
 */
export function LiveAnalytics({ member }: { member: BrandProfile }) {
  const [period, setPeriod] = useState<Period>("30d")
  const days = periodDays[period] as 7 | 30 | 90
  const brandId = member.brand.id
  const q = useApi<BrandAnalytics>(`studio.analytics:${brandId}:${days}`, () => api<BrandAnalytics>("/api/studio/analytics", { query: { days } }), { revalidateOnFocus: true })
  useRealtimeEventName("order.updated", () => void q.revalidate())
  const errorText = q.error instanceof ApiError ? q.error.message : "Yard's server didn't answer."

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Analytics"
        description={analyticsDescription(member.brand.name)}
        actions={<Segmented label="Period" value={period} onChange={setPeriod} options={periods.map((p) => ({ value: p, label: periodLabel[p] }))} className="w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none" />}
      >
        <p className="mt-3 text-xs text-ink-3">From your paid orders and what shoppers do on your storefront and product pages. Days are UTC days.</p>
      </PageHeader>

      {q.data ? (
        <LiveAnalyticsBody data={q.data} period={period} />
      ) : q.error ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink">Couldn&apos;t load your analytics</p>
          <p className="max-w-sm text-sm text-ink-2">{errorText}</p>
          <Button variant="secondary" size="sm" className="h-10" onClick={() => void q.revalidate()}>
            Retry
          </Button>
        </div>
      ) : (
        <div role="status" aria-label="Loading analytics">
          <AnalyticsBodySkeleton />
        </div>
      )}
    </div>
  )
}

function LiveAnalyticsBody({ data, period }: { data: BrandAnalytics; period: Period }) {
  const [trend, setTrend] = useState<TrendMetric>("revenue")
  const cur = asCurrency(data.currency)
  const { now, prev, days } = data
  const label = periodLabel[period].toLowerCase()
  const versus = `the ${label} before`
  // Order figures compare only when the period before lies inside the order history, as on the Overview.
  const prevFirst = data.series[0]?.date ?? data.from
  const comparable = !!data.historyStart && data.historyStart <= prevFirst
  const delta = (a: number, b: number) => (comparable ? change(a, b) : null)
  const trafficDelta = (a: number, b: number) => change(a, b)
  const money = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  const int = (n: number) => formatNumber(Math.round(n))
  const noOrdersYet = !data.historyStart

  const ret = data.returning.now
  const retPrev = data.returning.prev
  const rate = ret.customers ? ret.returning / ret.customers : 0
  const prevRate = retPrev.customers ? retPrev.returning / retPrev.customers : 0
  const retPoints = comparable && retPrev.customers ? Math.round(rate * 100) - Math.round(prevRate * 100) : null

  const chart = data.series.slice(days).map((p, i) => {
    const before = data.series[i]
    return { date: p.date, revenue: p.revenue, orders: p.orders, previous: (trend === "revenue" ? before?.revenue : before?.orders) ?? 0, wishlists: p.wishlists }
  })

  const funnel = [
    { label: "Store visits", value: now.visits, hint: "Shoppers who opened your storefront or a product page, counted once per shopper per day." },
    { label: "Viewed a product", value: now.productVisitors, hint: "Of those, the ones who opened at least one of your product pages that day." },
    { label: "Ordered", value: now.orders, hint: "Paid orders placed in the period. Cancelled, unpaid and fully refunded orders don't count." },
  ]

  /* High views, low conversion: well-viewed live products (at or above the median) that aren't best sellers, fewest orders per view first. */
  const lowConv = useMemo(() => {
    const best = new Set(data.bestSellers.map((b) => b.productId))
    const counts = data.traffic.map((p) => p.views).sort((a, b) => a - b)
    const median = counts[Math.floor(counts.length / 2)] ?? 0
    return data.traffic
      .filter((p) => !best.has(p.productId) && p.views > 0 && p.views >= median)
      .map((p) => ({ ...p, rate: p.units / p.views }))
      .sort((a, b) => a.rate - b.rate || b.views - a.views)
      .slice(0, 3)
  }, [data])
  const mostSaved = data.traffic.filter((p) => p.saves > 0).sort((a, b) => b.saves - a.saves).slice(0, 4)
  // Every paid order in the period, whatever its currency: the share each country's orders make up.
  const located = now.orders + data.otherCurrencies.reduce((s, o) => s + o.orders, 0)
  const views = now.storefrontViews + now.productViews + now.postOpens

  return (
    <div className="grid gap-3">
      <section aria-labelledby="analytics-key-metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <h2 id="analytics-key-metrics" className="sr-only">Key metrics</h2>
        <StatCard icon={Coins} label="Revenue" value={now.revenue} format={money} delta={delta(now.revenue, prev.revenue)} deltaContext={versus} hint={<MetricHint tip="Item subtotal of paid orders placed in the period. Shipping isn't included; fully refunded orders don't count.">Item subtotal of paid orders</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        <StatCard icon={Cart} label="Orders" value={now.orders} format={int} delta={delta(now.orders, prev.orders)} deltaContext={versus} hint={<MetricHint tip="Paid orders placed in the period, the same ones the Overview counts. Cancelled and unpaid orders don't count.">Paid orders</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        <StatCard icon={Funnel} label="Conversion rate" value={now.conversion} format={(n) => formatPercent(n, 2)} delta={delta(now.conversion, prev.conversion)} deltaContext={versus} hint={<MetricHint tip="Paid orders divided by store visits in the same period.">Orders ÷ visits</MetricHint>} href="/studio/products" hrefLabel="Open products" />
        <StatCard icon={Receipt} label="Average order value" value={now.aov} format={money} delta={now.orders ? delta(now.aov, prev.aov) : null} deltaContext={versus} hint={<MetricHint tip="Revenue divided by orders in the period.">Revenue ÷ orders</MetricHint>} href="/studio/orders" hrefLabel="Open orders" />
        <StatCard icon={Returning} label="Returning customers" value={rate} format={(n) => formatPercent(n, 0)} hint={<MetricHint tip={`Customers who ordered in the period and had ordered from you before, as a share of everyone who ordered in the period.${retPoints === null ? "" : ` ${formatPercent(prevRate, 0)} in ${versus}.`}`}>{`${ret.returning} of ${plural(ret.customers, "customer")}${pointsText(retPoints)}`}</MetricHint>} href="/studio/customers" hrefLabel="Open customers" />
        <StatCard icon={Heart} label="Wishlist adds" value={now.wishlists} format={int} delta={trafficDelta(now.wishlists, prev.wishlists)} deltaContext={versus} hint={<MetricHint tip={`Times shoppers saved one of your products. ${plural(now.follows, "new follower")} in the period; ${plural(data.followers, "follower")} in all.`}>{`Saves, and ${plural(now.follows, "new follower")}`}</MetricHint>} href="/studio/products" hrefLabel="Open products" />
      </section>

      {data.otherCurrencies.length ? (
        <p className="text-xs text-ink-3">Also in this period: {data.otherCurrencies.map((o) => `${plural(o.orders, "order")} in ${o.currency} (${formatMoney(o.revenue, asCurrency(o.currency))})`).join(", ")}. The figures above are in {cur}.</p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          className="min-w-0"
          title="Sales trend"
          description={trend === "revenue" ? `Daily revenue in ${cur}, last ${label}. The dashed line is the period before.` : `Paid orders per day, last ${label}. Grey bars are the period before.`}
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
          {(trend === "revenue" ? now.revenue : now.orders) === 0 ? <p className="mt-2 text-xs text-ink-3">{noOrdersYet ? "No paid orders yet. Your sales show here from your first order." : "No paid orders in this period yet."}</p> : null}
        </Panel>

        <Panel className="min-w-0" title="Conversion funnel" description={`From visit to order, last ${label}.`}>
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
                  <span className="text-xs text-ink-3 tabular">{prevStep === null ? "Every visit starts here" : prevStep ? `${formatPercent(f.value / prevStep, 1)} of the step before` : "Nothing at the step before yet"}</span>
                </li>
              )
            })}
          </ol>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-2">
            {now.visits ? (
              <>
                Overall, <span className="text-ink tabular">{formatPercent(now.conversion, 2)}</span> of visits ended in an order.
              </>
            ) : (
              "Visits show here once shoppers open your storefront or products."
            )}
          </p>
          {views ? (
            <p className="mt-2 text-xs text-ink-3">
              Where views landed: {formatNumber(now.productViews)} on product pages, {formatNumber(now.storefrontViews)} on your storefront{now.postOpens ? `, ${formatNumber(now.postOpens)} on your posts` : ""}.
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="min-w-0" title="Best sellers" href="/studio/products" hrefLabel="Open products" description={`Units ordered in the last ${label}, before refunds.`}>
          {data.bestSellers.length ? (
            <ol className="grid gap-3">
              {data.bestSellers.map((p, i) => (
                <li key={p.productId}>
                  <Link href={`/studio/products/${p.productId}`} className="group flex items-center gap-3 rounded-md">
                    <span className="w-4 text-xs text-ink-3 tabular">{i + 1}</span>
                    <Thumb image={thumb(p.image)} size={40} />
                    <span className="grid min-w-0 flex-1 gap-1.5">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm text-ink group-hover:text-violet">{p.title}</span>
                        <span className="shrink-0 text-xs text-ink-2 tabular">{plural(p.units, "unit")}, {formatMoney(p.revenue, cur, { compact: true })}</span>
                      </span>
                      <ShareBar share={p.units / data.bestSellers[0].units} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={PackageSearch} title="No sales in this period" body={noOrdersYet ? "Your best sellers show here once orders come in." : "Try a longer period, or check back after your next orders."} className="py-10" />
          )}
        </Panel>

        <Panel className="min-w-0" title="High views, low conversion" description={`The products with the most views for each order in the last ${label}. Best sellers are left out.`}>
          {lowConv.length ? (
            <>
              <ul className="divide-y divide-line-soft">
                {lowConv.map((p) => (
                  <li key={p.productId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Thumb image={thumb(p.image)} size={48} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm text-ink">{p.title}</span>
                      <span className="text-xs text-ink-2 tabular">{plural(p.views, "view")}, {plural(p.units, "unit")} ordered</span>
                      <span className="text-xs text-ink-3 tabular">
                        {p.units ? `${formatPercent(p.rate, 2)} of views became an order` : "No orders yet this period"}
                        {p.soldOut ? <span className="text-acid">, {plural(p.soldOut, "variant")} out of stock</span> : null}
                      </span>
                    </span>
                    <Button asChild size="xs" variant="secondary" className="shrink-0">
                      {p.soldOut ? <Link href="/studio/inventory">Restock</Link> : <Link href={`/studio/products/${p.productId}`}>Review</Link>}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-3">Views are product page views in the period, one per shopper per product per day. Units come from your orders, the same ones counted in Best sellers.</p>
            </>
          ) : (
            <EmptyState icon={Eye} title="Nothing stands out" body={data.traffic.length ? "Every well-viewed product is selling in line with its views this period." : "Product views show here once shoppers open your products."} className="py-10" />
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Wishlist activity" description={`${formatNumber(now.wishlists)} ${now.wishlists === 1 ? "save" : "saves"} in the last ${label}.`} className="min-w-0 lg:col-span-1">
          <TimeSeriesChart data={chart} kind="bar" series={[{ key: "wishlists", label: "Saves" }]} format={(n) => formatNumber(n)} height={140} />
          {mostSaved.length ? (
            <>
              <h3 className="mt-4 text-xs text-ink-3">Most saved this period</h3>
              <ul className="mt-2 grid gap-2">
                {mostSaved.map((p) => (
                  <li key={p.productId} className="flex items-center gap-2.5">
                    <Thumb image={thumb(p.image)} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.title}</span>
                    <span className="text-xs text-ink-2 tabular">{formatNumber(p.saves)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-4 text-xs text-ink-3">Saves show here as shoppers add your products to their wishlists.</p>
          )}
        </Panel>

        <Panel className="min-w-0" title="Customer locations" description="Where this period's orders shipped to.">
          {data.locations.length ? (
            <ul className="grid gap-3">
              {data.locations.map((l) => (
                <li key={l.country} className="grid gap-1.5">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">{countryName(l.country)}</span>
                    <span className="text-xs text-ink-2 tabular">{plural(l.orders, "order")}, {formatPercent(located ? l.orders / located : 0, 0)}</span>
                  </span>
                  <ShareBar share={l.orders / data.locations[0].orders} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MapPin} title="No orders in this period" body="Locations appear once orders ship to them." className="py-10" />
          )}
        </Panel>

        <Panel className="min-w-0" title="Returning customers" description="Customers this period who had ordered from you before." href="/studio/customers" hrefLabel="Open customers">
          <p className="font-metric text-[2.25rem] leading-none text-ink">{formatPercent(rate, 0)}</p>
          <p className="mt-1 text-xs text-ink-2 tabular">{ret.returning} of {plural(ret.customers, "customer")} came back</p>
          <ShareBar share={rate} className="mt-4 h-2.5" />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-purple" aria-hidden /><dt className="text-ink-2">Returning</dt><dd className="ml-auto text-ink tabular">{ret.returning}</dd></div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-white/20" aria-hidden /><dt className="text-ink-2">First order</dt><dd className="ml-auto text-ink tabular">{ret.customers - ret.returning}</dd></div>
          </dl>
          <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-3">Counted across all your orders, not just this period. Previous period: {formatPercent(prevRate, 0)}{retPoints === null ? "" : retPoints === 0 ? ", no change" : `, ${retPoints > 0 ? "up" : "down"} ${Math.abs(retPoints)} ${Math.abs(retPoints) === 1 ? "point" : "points"}`}.</p>
        </Panel>
      </div>

      <DropsPanel drops={data.drops} cur={cur} />

      <Panel className="min-w-0" title="Campaign performance" description="Sponsored placements across Yard.">
        <EmptyState icon={Megaphone} title="Advertising is coming soon" body="Sponsored placements aren't on Yard yet. When they launch, their spend, clicks and attributed orders show here." className="py-10" />
      </Panel>
    </div>
  )
}

function DropsPanel({ drops, cur }: { drops: DropStat[]; cur: CurrencyCode }) {
  return (
    <Panel title="Drop performance" description="Sell-through is units sold against units allocated to the drop." href="/studio/drops" hrefLabel="All drops" bodyClassName="px-0 md:px-0 pb-0 md:pb-0">
      {drops.length === 0 ? (
        <div className="border-t border-white/[0.06] p-4 md:p-5">
          <EmptyState icon={CalendarClock} title="No drops yet" body="Schedule a limited release with a countdown. Followers who set a reminder hear when it opens." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops/new">Plan a drop</Link></Button>} className="py-10" />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06] md:hidden">
            {drops.map((r) => {
              const meta = dropMeta[r.status] ?? dropMeta.ended
              return (
                <li key={r.id}>
                  <Link href={`/studio/drops/${r.id}`} className="flex items-start gap-3 px-4 py-3">
                    <Thumb image={r.image ? { src: r.image, alt: "", width: 1, height: 1 } : undefined} size={48} />
                    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">{r.name}</span>
                        <StatusBadge tone={meta.tone} className="shrink-0">{meta.label}</StatusBadge>
                      </span>
                      <span className="text-xs text-ink-2 tabular">{r.sold} of {r.totalUnits} sold, {r.reminders ? `${formatNumber(r.reminders)} waiting for alerts` : "no alert sign-ups yet"}</span>
                      <ShareBar share={r.totalUnits ? r.sold / r.totalUnits : 0} tone="acid" />
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              )
            })}
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
                {drops.map((r) => {
                  const st = r.totalUnits ? r.sold / r.totalUnits : 0
                  const meta = dropMeta[r.status] ?? dropMeta.ended
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3 md:px-5">
                        <span className="flex items-center gap-3">
                          <Thumb image={r.image ? { src: r.image, alt: "", width: 1, height: 1 } : undefined} size={36} />
                          <Link href={`/studio/drops/${r.id}`} className="font-medium text-ink hover:text-violet">{r.name}</Link>
                        </span>
                      </td>
                      <td className="px-3 py-3"><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular">{formatDate(r.startsAt)}</td>
                      <td className="px-3 py-3">
                        <span className="grid gap-1.5">
                          <span className="text-xs text-ink-2 tabular">{r.sold} of {r.totalUnits}, {formatPercent(st, 0)}</span>
                          <ShareBar share={st} tone="acid" />
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-ink tabular">{r.reminders ? formatNumber(r.reminders) : <span className="text-ink-3">None yet</span>}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-ink tabular md:px-5">{r.revenue ? formatMoney(r.revenue, cur) : <span className="text-ink-3">{r.status === "scheduled" || r.status === "draft" ? "Not released" : "No sales yet"}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
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
