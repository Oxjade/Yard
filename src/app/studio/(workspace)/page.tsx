"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowSquareOutIcon,
  BellIcon,
  CalendarPlusIcon,
  CaretDownIcon,
  CoinsIcon,
  EyeIcon,
  LayoutIcon,
  LightningIcon,
  PackageIcon,
  PlusIcon,
  ShoppingCartIcon,
  SquaresFourIcon,
  TagIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { periodDays, periodLabel, type Period } from "@/components/dashboard/period-select"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { buckets, change, longDate, rangeLabel, shortDate, slices, today, weekdayByWeek, weekdays, type Bucket } from "@/components/dashboard/insight/derive"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { DonutChart, type DonutSegment } from "@/components/dashboard/insight/donut-chart"
import { Heatmap, PeakSwatch } from "@/components/dashboard/insight/heatmap"
import { InsightCard, InsightEmphasis } from "@/components/dashboard/insight/insight-card"
import { InsightPanel } from "@/components/dashboard/insight/insight-panel"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { SignalList } from "@/components/dashboard/insight/signal-list"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { NotificationRow } from "@/components/feedback/notification-bell"
import { bestSellers as rankBestSellers, lowConversion, periodSummary, productTraffic, salesByProduct, useBrandSeries } from "@/components/studio/business/brand-series"
import { orderCustomerName } from "@/components/studio/business/model"
import { SetupCard } from "@/components/studio/setup/setup-card"
import { LiveOverview } from "@/components/studio/business/live-overview"
import { SessionGate } from "@/components/session/session-gate"
import { useHydrated } from "@/hooks/use-hydrated"
import { brandById } from "@/lib/data/brands"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useNotifications, type AppNotification } from "@/lib/stores/notifications"
import { useServerSession } from "@/lib/session/use-server-session"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"

function relDays(iso: string) {
  const d = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`
}

const periods: Period[] = ["today", "7d", "30d", "90d"]

/**
 * A real brand's session (not a demo account) gets the Overview from Yard's server. The sample
 * Overview (this browser's sample orders and generated traffic) is for demo and development only:
 * in production, everyone else gets the Studio sign-in, never sample figures.
 */
export default function StudioOverviewPage() {
  const member = useServerSession((s) => s.brand)
  const sampleData = useServerSession((s) => s.sampleData)
  if (member && !member.demo) return <LiveOverview member={member} />
  if (sampleData === true) return <SampleOverview />
  return (
    <SessionGate surface="studio" feature="the Overview">
      {member ? <LiveOverview member={member} /> : null}
    </SessionGate>
  )
}

function SampleOverview() {
  const router = useRouter()
  const hydrated = useHydrated()
  const [period, setPeriod] = useState<Period>("30d")
  const [bucket, setBucket] = useState<Bucket>("weekly")
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const products = useStudio((s) => s.products)
  const notifications = useNotifications((s) => s.items)
  const markRead = useNotifications((s) => s.markRead)
  const activity = useMemo(() => notifications.filter((n) => n.audience === "merchant").slice(0, 4), [notifications])
  const brand = brandById.get(brandId)!
  const cur = brand.currency

  const money = (n: number) => formatMoney(Math.round(n), cur, { compact: true })
  const moneyFull = (n: number) => formatMoney(Math.round(n), cur)
  const int = (n: number) => formatNumber(Math.round(n))

  /* Orders and revenue come from the orders in Studio, through the same hook as Analytics, so
     both pages give the same figures for the same days. Visits, views, follows and wishlists
     are generated sample traffic. */
  const brandSeries = useBrandSeries(brandId)
  const { series, counted, historyStart } = brandSeries

  const days = periodDays[period]
  const summary = useMemo(() => periodSummary(brandSeries, days), [brandSeries, days])
  const { now, prev, comparable } = summary
  const salesDelta = (a: number, b: number) => (comparable ? change(a, b) : null)
  const trafficDelta = (a: number, b: number) => change(a, b)
  const versus = period === "today" ? "yesterday" : `the ${periodLabel[period].toLowerCase()} before`
  // "today" or "last 30 days", for descriptions that name the period.
  const inPeriod = period === "today" ? "today" : `last ${periodLabel[period].toLowerCase()}`
  const salesHint = comparable ? `vs ${versus}` : `Order history starts ${shortDate(historyStart)}`

  // Everything not yet shipped, the same figure as the sidebar's Orders badge. The hint splits
  // it into the To fulfil and Processing tabs on /studio/orders, so each part matches a tab.
  const toFulfil = orders.filter((o) => o.status === "paid").length
  const processing = orders.filter((o) => o.status === "processing").length
  const notShipped = toFulfil + processing
  const notShippedHint = notShipped ? `${int(toFulfil)} to fulfil, ${int(processing)} processing` : "Everything has shipped"

  /* Sales by bucket. Windows end today, so the 7-day and 30-day periods equal the latest
     weekly and monthly bar, and 90 days equals the three monthly bars together. */
  const spec = buckets[bucket]
  const chartSlices = slices(series, spec.size, spec.count, historyStart)
  const bars: BarDatum[] = chartSlices.map((s) => {
    const revenue = s.rows.reduce((t, r) => t + r.revenue, 0)
    const count = s.rows.reduce((t, r) => t + r.orders, 0)
    return {
      key: s.from,
      // Three 30-day bars leave room for the whole range, so they never read as calendar months.
      label: bucket === "daily" ? shortDate(s.to) : bucket === "monthly" ? rangeLabel(s.from, s.to) : shortDate(s.from),
      fullLabel: bucket === "daily" ? longDate(s.to) : rangeLabel(s.from, s.to),
      value: revenue,
      delta: s.previous ? change(revenue, s.previous.reduce((t, r) => t + r.revenue, 0)) : null,
      meta: `${count} ${count === 1 ? "order" : "orders"}`,
    }
  })
  const chartTotal = bars.reduce((t, b) => t + b.value, 0)
  const chartDays = spec.size * spec.count
  const chartPrev = series.slice(series.length - chartDays * 2, series.length - chartDays)
  const chartDelta = chartPrev.length === chartDays && chartPrev[0].date >= historyStart ? change(chartTotal, chartPrev.reduce((t, r) => t + r.revenue, 0)) : null

  /* Units and item revenue per product in the selected period, from the same orders as the figures above. */
  const sales = useMemo(() => salesByProduct(summary.orders), [summary.orders])

  /* Revenue share by product in the selected period: top four and the rest. Adds up to Revenue. */
  const productShare: DonutSegment[] = useMemo(() => {
    const ranked = [...sales.values()].sort((a, b) => b.revenue - a.revenue)
    const top: DonutSegment[] = ranked.slice(0, 4).map((e) => ({ key: e.id, label: e.name, value: e.revenue, href: products.some((p) => p.id === e.id) ? `/studio/products/${e.id}` : undefined }))
    const rest = ranked.slice(4).reduce((t, e) => t + e.revenue, 0)
    return rest > 0 ? [...top, { key: "other", label: `Other (${ranked.length - 4})`, value: rest }] : top
  }, [sales, products])

  /* Orders by weekday over the last 13 weeks. */
  const heat = useMemo(() => weekdayByWeek(counted.map((o) => o.placedAt.slice(0, 10)), 13, historyStart), [counted, historyStart])
  const ordersUnit = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`

  /* Best sellers and the insight follow the period, with the rules Analytics uses. */
  const bestSellers = rankBestSellers(sales)
  const topUnits = bestSellers[0]?.units || 1
  const traffic = productTraffic(products, now.productViews, now.wishlists)
  const gap = lowConversion(traffic, sales, bestSellers, 1)[0]
  // "in the last 30 days" in a sentence; "30 days" or "today" in a short fact label.
  const factWindow = period === "today" ? "today" : periodLabel[period].toLowerCase()
  const sentenceWindow = period === "today" ? "today" : `in the last ${factWindow}`
  const recent = orders.slice(0, 6)

  function openNotification(n: AppNotification) {
    markRead(n.id)
    if (n.href) router.push(n.href)
  }

  return (
    <div className="@container">
      {/* Header */}
      <header className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:justify-between">
        <div className="min-w-0 @4xl:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-medium tracking-tight text-ink">Overview</h1>
            <SampleDataNote />
          </div>
          {/* The brand's name is in the sidebar and the drawer, so the line stays short enough to
              sit on one line at phone width in the fallback font and in Space Grotesk alike. Under
              20rem it may wrap, so two lines are held there and nothing moves when the font loads. */}
          <p className="mt-1.5 min-h-10 text-sm text-ink-2 @xs:min-h-0">
            {period === "today" ? `Today${comparable ? ", against yesterday" : ""}.` : `${inPeriod.charAt(0).toUpperCase()}${inPeriod.slice(1)}${comparable ? ` against ${versus}` : ""}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 @4xl:shrink-0 @4xl:flex-nowrap">
          <Segmented
            label="Period"
            value={period}
            onChange={setPeriod}
            options={periods.map((p) => ({ value: p, label: periodLabel[p] }))}
            className="w-full @2xl:w-auto [&>button]:flex-1 @2xl:[&>button]:flex-none"
          />
          <Button asChild variant="primary" className="h-10 rounded-full px-4">
            <Link href="/studio/products/new">
              <PlusIcon weight="bold" /> Add product
            </Link>
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" className="h-10 rounded-full px-3.5" aria-label="Quick actions">
                <LightningIcon />
                <span className="hidden @lg:inline">Quick actions</span>
                <CaretDownIcon className="size-3.5 text-ink-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-2xl p-1.5">
              {[
                { href: "/studio/collections", label: "Create collection", icon: SquaresFourIcon },
                { href: "/studio/drops/new", label: "Schedule a drop", icon: CalendarPlusIcon },
                { href: "/studio/campaigns", label: "Create a promotion", icon: TagIcon },
                { href: "/studio/storefront", label: "Edit storefront", icon: LayoutIcon },
              ].map((a) => (
                <DropdownMenuItem key={a.href} asChild className="gap-2.5 rounded-lg px-2 text-[13px] text-ink-2 focus:text-ink">
                  <Link href={a.href}>
                    <a.icon className="size-[18px] text-ink-3" />
                    {a.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-white/[0.07]" />
              <DropdownMenuItem asChild className="gap-2.5 rounded-lg px-2 text-[13px] text-ink-2 focus:text-ink">
                <Link href={`/brands/${brand.handle}`} target="_blank" rel="noopener">
                  <EyeIcon className="size-[18px] text-ink-3" />
                  <span className="flex-1">View storefront</span>
                  <ArrowSquareOutIcon aria-hidden className="size-3.5 text-ink-3" />
                  <span className="sr-only">(opens in a new tab)</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Server-backed guidance for the v2 features; nothing when signed out, dismissed or all done (§7.4). */}
      <SetupCard className="mt-6" />

      {/* Key metrics */}
      <section aria-labelledby="studio-key-metrics" className="mt-6 grid gap-3 @lg:grid-cols-2 @5xl:grid-cols-4">
        <h2 id="studio-key-metrics" className="sr-only">
          Key metrics
        </h2>
        <StatCard icon={CoinsIcon} label="Revenue" value={now.revenue} format={money} delta={salesDelta(now.revenue, prev.revenue)} deltaContext={versus} hint={salesHint} href="/studio/analytics" hrefLabel="Open analytics" ready={hydrated} />
        <StatCard icon={ShoppingCartIcon} label="Orders" value={now.orders} format={int} delta={salesDelta(now.orders, prev.orders)} deltaContext={versus} hint={salesHint} href="/studio/orders" hrefLabel="Open orders" ready={hydrated} />
        <StatCard icon={EyeIcon} label="Store visits" value={now.visits} format={int} delta={trafficDelta(now.visits, prev.visits)} deltaContext={versus} hint={`vs ${versus}`} href="/studio/analytics" hrefLabel="Open traffic in analytics" ready={hydrated} />
        <StatCard
          icon={PackageIcon}
          label="Not yet shipped"
          value={notShipped}
          format={int}
          // The split comes from the saved orders, so it waits for them like the figure does.
          hint={hydrated ? notShippedHint : <span aria-hidden className="inline-block h-3 w-32 rounded bg-white/15 align-middle" />}
          href="/studio/orders"
          hrefLabel="Open orders to fulfil"
          variant="brand"
          ready={hydrated}
        />
      </section>

      {/* Signals, sales, product mix */}
      <div className="mt-3 grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)_minmax(0,17.5rem)]">
        <InsightPanel title="Signal ledger" description={period === "today" ? "Today" : `Last ${periodLabel[period].toLowerCase()}`} href="/studio/analytics" hrefLabel="Open analytics">
          <SignalList
            ready={hydrated}
            deltaContext={versus}
            items={[
              { key: "aov", label: "Average order value", value: now.orders ? money(now.aov) : "No orders", empty: !now.orders, delta: now.orders ? salesDelta(now.aov, prev.aov) : null },
              { key: "conv", label: "Conversion rate", value: formatPercent(now.conversion, 2), delta: salesDelta(now.conversion, prev.conversion) },
              { key: "followers", label: "Followers gained", value: `+${int(now.followers)}`, delta: trafficDelta(now.followers, prev.followers) },
              { key: "views", label: "Product views", value: formatNumber(now.productViews, { compact: true }), delta: trafficDelta(now.productViews, prev.productViews) },
              { key: "wish", label: "Wishlist adds", value: int(now.wishlists), delta: trafficDelta(now.wishlists, prev.wishlists) },
            ]}
          />
        </InsightPanel>

        <InsightPanel
          title="Sales"
          description={`Revenue in ${cur}, ${spec.window}`}
          href="/studio/analytics"
          hrefLabel="Open sales in analytics"
          className="@xl:order-first @xl:col-span-2 @5xl:order-none @5xl:col-span-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
              {hydrated ? (
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
            <Segmented label="Bucket size" size="sm" value={bucket} onChange={setBucket} options={(Object.keys(buckets) as Bucket[]).map((b) => ({ value: b, label: buckets[b].label }))} />
          </div>
          <BarChart key={bucket} className="mt-4" data={bars} format={money} formatFull={moneyFull} label={`Revenue by ${bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "30 days"}`} deltaContext={bucket === "daily" ? "the day before" : bucket === "weekly" ? "the week before" : "the 30 days before"} height={236} />
        </InsightPanel>

        <InsightPanel title="Top products" description={`Share of revenue, ${inPeriod}`} href="/studio/products" hrefLabel="Open products">
          <DonutChart
            segments={productShare}
            format={money}
            formatFull={moneyFull}
            totalLabel="Revenue"
            label={`Share of revenue by product, ${inPeriod}`}
            empty={period === "today" ? "No sales yet today." : "No sales in this period."}
            emptyCentre="No sales"
            className="my-auto"
          />
        </InsightPanel>
      </div>

      {/* Insight, rhythm, activity */}
      <div className="mt-3 grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
        {gap ? (
          <InsightCard
            media={<Image src={gap.product.images[0].src} alt={gap.product.images[0].alt} fill sizes="56px" className="object-cover" />}
            ready={hydrated}
            title={
              <>
                {gap.product.name} had <InsightEmphasis>{int(gap.views)} {gap.views === 1 ? "view" : "views"}</InsightEmphasis> {sentenceWindow} and {gap.units ? `${int(gap.units)} ${gap.units === 1 ? "unit" : "units"} ordered` : "no orders"}.
              </>
            }
            body={
              gap.soldOut
                ? `The fewest orders per view of your well-viewed products, with ${gap.soldOut} ${gap.soldOut === 1 ? "variant" : "variants"} out of stock. Restock what shoppers are looking for.`
                : "The fewest orders per view of your well-viewed products. Check the price, the photos or the size range."
            }
            facts={[
              { label: `Units ordered, ${factWindow}`, value: int(gap.units) },
              { label: `Wishlist adds, ${factWindow}`, value: int(gap.saves) },
            ]}
            action={gap.soldOut ? { href: "/studio/inventory", label: "Restock" } : { href: `/studio/products/${gap.product.id}`, label: "Open product" }}
          />
        ) : null}

        <InsightPanel title="Orders by weekday" description="Each square is a day, last 13 weeks">
          <Heatmap
            rows={weekdays}
            columns={heat.columns}
            cells={heat.cells}
            unit={ordersUnit}
            label="Orders per day over the last 13 weeks"
            ready={hydrated}
            stats={[
              { label: "Busiest weekday", value: heat.busiestWeekday ? heat.busiestWeekday.name : "None yet" },
              { label: "Weekend share", value: heat.weekendShare === null ? "None yet" : formatPercent(heat.weekendShare, 0) },
              { label: "Most in a day", value: heat.max ? (heat.peak ? <><PeakSwatch />{ordersUnit(heat.max)} on {shortDate(heat.peak.date)}</> : `${ordersUnit(heat.max)} on ${heat.maxDays} days`) : "None yet" },
            ]}
          />
        </InsightPanel>

        <InsightPanel title="Store activity" description="Orders, follows and stock alerts" href="/studio/notifications" hrefLabel="All notifications" className="@2xl:col-span-2 @5xl:col-span-1" bodyClassName="px-2 md:px-3 pt-2">
          {/* Rows are held at one height, so the skeleton and the list are the same size. */}
          {!hydrated ? (
            <div className="grid auto-rows-[78px]" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 px-2.5 py-2.5">
                  <span className="skeleton mt-0.5 size-8 shrink-0 rounded-full" />
                  <span className="grid flex-1 gap-1.5 pt-1">
                    <span className="skeleton h-3.5 w-4/5 rounded" />
                    <span className="skeleton h-3 w-3/5 rounded" />
                    <span className="skeleton h-3 w-1/4 rounded" />
                  </span>
                </div>
              ))}
            </div>
          ) : activity.length ? (
            <ul className="grid auto-rows-[minmax(78px,auto)]">
              {activity.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={openNotification} compact />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-2 text-sm text-ink-2">
              <BellIcon className="size-4 text-ink-3" aria-hidden /> Orders, follows and stock alerts show up here as they happen.
            </p>
          )}
        </InsightPanel>
      </div>

      {/* Orders and best sellers */}
      <div className="mt-3 grid gap-3 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,22.5rem)]">
        <InsightPanel title="Recent orders" description="The latest six, newest first" href="/studio/orders" hrefLabel="All orders" bodyClassName="px-0 md:px-0 pt-3 pb-2 md:pb-2">
          <div className="@container">
            <div aria-hidden className="hidden grid-cols-[7rem_minmax(0,1fr)_8.5rem_6.5rem_7.5rem] gap-x-4 border-y border-white/[0.05] px-5 py-2 text-[11px] text-ink-3 @2xl:grid">
              <span>Order</span>
              <span>Product</span>
              <span>Customer</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
            </div>
            <ul className="divide-y divide-white/[0.05] border-t border-white/[0.05] @2xl:border-t-0">
              {!hydrated
                ? [0, 1, 2, 3, 4, 5].map((i) => (
                    <li key={i} aria-hidden>
                      <div className="flex h-[72px] items-center gap-4 px-5 @2xl:h-[62px]">
                        <span className="skeleton h-3.5 w-20 rounded" />
                        <span className="skeleton h-3.5 flex-1 rounded" />
                        <span className="skeleton h-5 w-20 rounded" />
                      </div>
                    </li>
                  ))
                : recent.map((o) => {
                    const customer = orderCustomerName(o)
                    const meta = orderStatusMeta[o.status]
                    const product = `${o.lines[0]?.name ?? "Order"}${o.lines.length > 1 ? ` +${o.lines.length - 1}` : ""}`
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/studio/orders/${o.id}`}
                          aria-label={`Order ${o.reference}, ${product}, ${customer}, ${relDays(o.placedAt).toLowerCase()}, ${formatMoney(o.total, o.currency)}, ${meta.label}`}
                          className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors duration-150 hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet @2xl:min-h-[62px] @2xl:grid-cols-[7rem_minmax(0,1fr)_8.5rem_6.5rem_7.5rem]"
                        >
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium whitespace-nowrap text-ink tabular transition-colors group-hover:text-violet">#{o.reference}</span>
                            <span className="mt-0.5 hidden text-[11.5px] whitespace-nowrap text-ink-3 @2xl:block">{relDays(o.placedAt)}</span>
                          </span>
                          <span className="row-start-2 min-w-0 truncate text-[12.5px] text-ink-2 @2xl:row-start-auto">{product}</span>
                          <span className="hidden truncate text-[12.5px] text-ink-2 @2xl:block">{customer}</span>
                          <span className="col-start-2 row-start-1 text-right text-[13px] text-ink tabular @2xl:col-start-auto @2xl:row-start-auto">{formatMoney(o.total, o.currency)}</span>
                          <span className="col-start-2 row-start-2 justify-self-end @2xl:col-start-auto @2xl:row-start-auto @2xl:justify-self-start">
                            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
            </ul>
          </div>
        </InsightPanel>

        <InsightPanel title="Best sellers" description={`Units ordered, ${inPeriod}`} href="/studio/products" hrefLabel="Open products" bodyClassName="pt-3">
          {!hydrated ? (
            <ol className="grid gap-1" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex h-14 items-center gap-3 px-1.5">
                  <span className="skeleton size-10 shrink-0 rounded-lg" />
                  <span className="skeleton h-3.5 flex-1 rounded" />
                </li>
              ))}
            </ol>
          ) : bestSellers.length ? (
            // One minmax(0, 1fr) column, so a long name truncates instead of widening the list past the panel.
            <ol className="grid grid-cols-1 gap-1">
              {bestSellers.map((p, i) => (
                <li key={p.id}>
                  <Link href={`/studio/products/${p.id}`} className="group flex h-14 items-center gap-3 rounded-xl px-1.5 transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet">
                    <span className="w-4 shrink-0 text-center text-[11px] text-ink-3 tabular">{i + 1}</span>
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-elevated">
                      <Image src={p.image.src} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink transition-colors group-hover:text-violet">{p.name}</span>
                      <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.05]">
                        <span className={cn("block h-full origin-left rounded-full", i === 0 ? "bg-violet" : "bg-white/25")} style={{ transform: `scaleX(${p.units / topUnits})` }} />
                      </span>
                    </span>
                    <span className="w-16 shrink-0 text-right text-[12px] text-ink-2 tabular">{int(p.units)} {p.units === 1 ? "unit" : "units"}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={PackageIcon} title={period === "today" ? "No sales yet today" : "No sales in this period"} body="Try a longer period, or check back after your next orders." className="border-0 py-10" />
          )}
        </InsightPanel>
      </div>
    </div>
  )
}
