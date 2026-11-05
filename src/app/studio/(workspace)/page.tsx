"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { CalendarPlusIcon as CalendarPlus, EyeIcon as Eye, HeartIcon as Heart, LayoutIcon as LayoutTemplate, PackageIcon as Package, PlusIcon as Plus, ShoppingBagOpenIcon as ShoppingBag, TagIcon as Tags, UserPlusIcon as UserPlus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { PeriodSelect, periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { useHydrated } from "@/hooks/use-hydrated"
import { attentionGap, brandDailySeries, sumSeries } from "@/lib/data/analytics"
import { brandById } from "@/lib/data/brands"
import { shoppers } from "@/lib/data/orders"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"

function relDays(iso: string) {
  const d = Math.round((new Date("2026-11-05T12:00:00Z").getTime() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`
}

export default function StudioOverviewPage() {
  const hydrated = useHydrated()
  const [period, setPeriod] = useState<Period>("30d")
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const products = useStudio((s) => s.products)
  const brand = brandById.get(brandId)!
  const cur = brand.currency

  const series = useMemo(() => brandDailySeries(brandId, 180), [brandId])
  const days = periodDays[period]
  const now = sumSeries(series, series.length - days)
  const prev = sumSeries(series, series.length - days * 2, series.length - days)
  const delta = (a: number, b: number) => (b ? (a - b) / b : null)
  const toFulfil = orders.filter((o) => o.status === "paid" || o.status === "processing").length

  const chartDays = Math.max(days, 14)
  const chart = series.slice(-chartDays).map((p, i) => ({ date: p.date, revenue: p.revenue, previous: series[series.length - chartDays * 2 + i]?.revenue ?? 0 }))

  const bestSellers = [...products].sort((a, b) => b.stats.sales30d - a.stats.sales30d).slice(0, 5)
  const gap = attentionGap(brandId)[0]
  const recent = orders.slice(0, 6)

  const activity = [
    { icon: UserPlus, text: `${formatNumber(Math.round(now.followers / Math.max(1, days)) || 12)} new followers today`, when: "Today" },
    { icon: Heart, text: `${bestSellers[1]?.name ?? "A product"} was saved 14 times`, when: "Today" },
    { icon: ShoppingBag, text: `${shoppers[3].name} bought ${recent[0]?.lines[0]?.name ?? "a piece"}`, when: relDays(recent[0]?.placedAt ?? "") },
    { icon: Eye, text: "Your Drop 07 preview page had 1,204 views", when: "Yesterday" },
    { icon: Tags, text: "Homepage spotlight campaign is in review", when: "Yesterday" },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Overview"
        description={`How ${brand.name} is doing over the last ${periodLabel[period].toLowerCase()}, compared with the period before.`}
        actions={
          <>
            <PeriodSelect value={period} onChange={setPeriod} />
            <Button asChild variant="primary" size="sm">
              <Link href="/studio/products/new"><Plus /> Add product</Link>
            </Button>
          </>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Revenue" value={now.revenue} format={(n) => formatMoney(Math.round(n), cur, { compact: true })} delta={delta(now.revenue, prev.revenue)} hint={`vs previous ${periodLabel[period].toLowerCase()}`} />
        <MetricTile label="Orders" value={now.orders} format={(n) => formatNumber(Math.round(n))} delta={delta(now.orders, prev.orders)} />
        <MetricTile label="Store visits" value={now.visits} format={(n) => formatNumber(Math.round(n))} delta={delta(now.visits, prev.visits)} />
        <MetricTile label="Conversion rate" value={now.conversion} format={(n) => formatPercent(n, 2)} delta={delta(now.conversion, prev.conversion)} hint="orders ÷ visits" />
        <MetricTile label="Average order value" value={now.aov} format={(n) => formatMoney(Math.round(n), cur, { compact: true })} delta={delta(now.aov, prev.aov)} />
        <MetricTile label="Followers gained" value={now.followers} format={(n) => `+${formatNumber(Math.round(n))}`} delta={delta(now.followers, prev.followers)} />
        <MetricTile label="Product views" value={now.productViews} format={(n) => formatNumber(Math.round(n), { compact: true })} delta={delta(now.productViews, prev.productViews)} />
        <MetricTile label="Orders to fulfil" value={hydrated ? toFulfil : 0} format={(n) => formatNumber(Math.round(n))} hint="paid, not yet shipped" highlight={toFulfil > 0} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="sales-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="sales-title" className="text-sm font-medium text-ink">Sales</h2>
              <p className="mt-0.5 text-xs text-ink-2">Daily revenue in {cur}. The dashed line is the previous period.</p>
            </div>
            <p className="text-xl font-medium tabular">{formatMoney(now.revenue, cur)}</p>
          </div>
          <TimeSeriesChart data={chart} series={[{ key: "revenue", label: "Revenue" }, { key: "previous", label: "Previous period" }]} format={(n) => formatMoney(n, cur, { compact: true })} height={280} />
        </section>

        <section aria-labelledby="actions-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
          <h2 id="actions-title" className="text-sm font-medium text-ink">Quick actions</h2>
          <div className="mt-4 grid gap-2">
            <Button asChild variant="primary" className="justify-start"><Link href="/studio/products/new"><Package /> Add product</Link></Button>
            <Button asChild variant="secondary" className="justify-start"><Link href="/studio/collections"><Plus /> Create collection</Link></Button>
            <Button asChild variant="secondary" className="justify-start"><Link href="/studio/drops/new"><CalendarPlus /> Schedule a drop</Link></Button>
            <Button asChild variant="secondary" className="justify-start"><Link href="/studio/campaigns"><Tags /> Create a promotion</Link></Button>
            <Button asChild variant="secondary" className="justify-start"><Link href="/studio/storefront"><LayoutTemplate /> Edit storefront</Link></Button>
          </div>
          {gap ? (
            <div className="mt-5 rounded-md border border-acid/25 bg-acid/5 p-3">
              <p className="text-xs font-medium text-acid">Worth a look</p>
              <p className="mt-1 text-sm text-ink">{gap.product.name} gets attention but rarely sells.</p>
              <p className="mt-1 text-xs text-ink-2">{formatNumber(gap.product.stats.views7d)} views this week, {gap.product.stats.sales30d} sales in 30 days. Check the price, the photos or the size range.</p>
              <Link href={`/studio/products/${gap.product.id}`} className="mt-2 inline-block text-xs text-violet hover:underline">Open product</Link>
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="orders-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex items-center justify-between px-4 py-3 md:px-5">
            <h2 id="orders-title" className="text-sm font-medium text-ink">Recent orders</h2>
            <Link href="/studio/orders" className="text-xs text-ink-2 hover:text-ink">All orders</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y border-line-soft bg-surface/60 text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Order</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">Product</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">Customer</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">Placed</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">Amount</th>
                  <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {recent.map((o) => {
                  const customer = shoppers.find((c) => c.id === o.customerId)
                  const meta = orderStatusMeta[o.status]
                  return (
                    <tr key={o.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3 md:px-5"><Link href={`/studio/orders/${o.id}`} className="font-medium whitespace-nowrap text-ink tabular hover:text-violet">#{o.reference}</Link></td>
                      <td className="px-3 py-3 text-ink-2"><span className="line-clamp-1">{o.lines[0]?.name}{o.lines.length > 1 ? ` +${o.lines.length - 1}` : ""}</span></td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2">{customer?.name ?? "Customer"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2">{relDays(o.placedAt)}</td>
                      <td className="px-3 py-3 text-right text-ink tabular">{formatMoney(o.total, o.currency)}</td>
                      <td className="px-4 py-3 md:px-5"><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6">
          <section aria-labelledby="best-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <h2 id="best-title" className="text-sm font-medium text-ink">Best sellers, 30 days</h2>
            <ol className="mt-3 grid gap-2">
              {bestSellers.map((p) => (
                <li key={p.id}>
                  <Link href={`/studio/products/${p.id}`} className="flex items-center gap-3 rounded-md p-1.5 hover:bg-white/[0.03]">
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-surface">
                      <Image src={p.images[0].src} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                    <span className="text-xs text-ink-2 tabular">{p.stats.sales30d} sold</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="activity-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <h2 id="activity-title" className="text-sm font-medium text-ink">Store activity</h2>
            <ul className="mt-3 grid gap-3">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line"><a.icon className="size-3.5 text-ink-2" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{a.text}</span>
                    <span className="block text-xs text-ink-3">{a.when}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
