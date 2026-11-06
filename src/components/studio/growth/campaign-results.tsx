"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Check, Clock, Info, Pencil, Plus, SearchX, Undo2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge, campaignStatusMeta } from "@/components/dashboard/status-badge"
import { BackLink } from "@/components/studio/business/shared"
import { useNow } from "@/hooks/use-now"
import { categories } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { ATTRIBUTION, campaignTypes, type Campaign } from "@/lib/data/ads"
import { rand } from "@/lib/data/seed"
import { convert, formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { campaignDates, roasText } from "./advertising-index"
import { EditorSkeleton, Panel } from "./form"
import { PlacementPreview, resolveTarget } from "./placement-preview"
import { useGrowthReady } from "./store"
import { addDays, brandZone, campaignMetrics, campaignPriceUsd, campaignSpends, countryName, formatDate, placementMeta, todayIn, usdAndLocalText } from "./utils"

export function CampaignResults({ id }: { id: string }) {
  const ready = useGrowthReady()
  const now = useNow(60_000)
  const campaign = useStudio((s) => s.campaigns.find((c) => c.id === id))
  if (!ready || now === null) return <EditorSkeleton />
  if (!campaign) {
    return (
      <div className="grid gap-6">
        <BackLink href="/studio/advertising">Advertising</BackLink>
        <EmptyState icon={SearchX} title="This campaign isn't here" body="It may have been created in another browser. Campaigns are saved in this browser until the store is connected." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/advertising">Back to advertising</Link></Button>} />
      </div>
    )
  }
  return <Results c={campaign} now={now} />
}

const TIMELINE = ["Paid and submitted", "In review", "Approved", "Running", "Finished"] as const

function timelineIndex(status: Campaign["status"]) {
  return { draft: -1, in_review: 1, scheduled: 2, active: 3, paused: 3, completed: 4, rejected: 1 }[status]
}

/** Spreads the campaign's totals over the days it has run. Sample shape, stable per campaign. */
function dailySeries(c: Campaign, today: string) {
  const start = addDays(today, c.startDaysFromToday)
  const ran = c.status === "completed" ? c.days : Math.min(c.days, Math.max(1, 1 - c.startDaysFromToday))
  const weights = Array.from({ length: ran }, (_, i) => 0.55 + rand(`${c.id}-day-${i}`) * 0.9)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  return weights.map((w, i) => ({ date: addDays(start, i), clicks: Math.round((c.results.clicks * w) / total), impressions: Math.round((c.results.impressions * w) / total) }))
}

function Results({ c, now }: { c: Campaign; now: number }) {
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const upsertCampaign = useStudio((s) => s.upsertCampaign)
  const brand = brandById.get(brandId)!
  const cur = brand.currency
  const today = todayIn(brandZone(brand).tz, now)
  const meta = campaignStatusMeta[c.status]
  const type = campaignTypes[c.type]
  const m = campaignMetrics([c])
  const hasResults = c.results.impressions > 0
  const series = hasResults ? dailySeries(c, today) : []
  const target = resolveTarget(c.targetIds[0], brand, products, drops)
  const start = addDays(today, c.startDaysFromToday)
  const [withdraw, setWithdraw] = useState(false)
  const price = usdAndLocalText(campaignPriceUsd(c), cur)
  const perDay = usdAndLocalText(Math.round(campaignPriceUsd(c) / Math.max(1, c.days)), cur)

  function confirmWithdraw() {
    upsertCampaign({ ...c, status: "draft" })
    setWithdraw(false)
    toast("Withdrawn from review", { description: `${price} will be refunded in full. The campaign is a draft again.` })
  }

  const funnel = [
    { label: "Impressions", value: c.results.impressions },
    { label: "Clicks", value: c.results.clicks },
    { label: "Product views", value: c.results.productViews },
    { label: "Add-to-carts", value: c.results.addToCarts },
    { label: "Purchases", value: c.results.purchases },
  ]

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/advertising">Advertising</BackLink>
        <PageHeader
          title={c.name}
          description={`${type.name}, ${campaignDates(c, today)}.`}
          actions={
            c.status === "rejected" ? (
              <Button asChild variant="primary" size="sm"><Link href={`/studio/advertising/${c.id}/edit`}><Pencil /> Edit and resubmit</Link></Button>
            ) : c.status === "draft" ? (
              <Button asChild variant="primary" size="sm"><Link href={`/studio/advertising/${c.id}/edit`}><Pencil /> Continue setup</Link></Button>
            ) : (
              <>
                {c.status === "in_review" ? <Button variant="secondary" size="sm" onClick={() => setWithdraw(true)}><Undo2 /> Withdraw</Button> : null}
                <Button asChild variant="secondary" size="sm"><Link href="/studio/advertising/new"><Plus /> New campaign</Link></Button>
              </>
            )
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {hasResults ? <SampleDataNote /> : null}
          </div>
        </PageHeader>
      </div>

      {/* Where the campaign is in its life */}
      <section aria-labelledby="status-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
        <h2 id="status-title" className="sr-only">Status</h2>
        {c.status === "rejected" ? (
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink">Rejected in review</p>
              <p className="mt-1 text-ink-2">{c.rejectionReason ?? "It didn't meet the advertising rules."}</p>
              <p className="mt-1 text-xs text-ink-3">Your payment of {price} was refunded in full. Fix the issue, then pay and submit again.</p>
            </div>
          </div>
        ) : c.status === "draft" ? (
          <p className="text-sm text-ink-2">A draft. Nothing is booked or paid yet. Continue setup to choose dates, pay and submit it for review.</p>
        ) : (
          <>
            <ol className="grid grid-cols-5 gap-2">
              {TIMELINE.map((label, i) => {
                const at = timelineIndex(c.status)
                const done = i < at || (i === at && c.status === "completed")
                const current = i === at && c.status !== "completed"
                return (
                  <li key={label} className="min-w-0">
                    <span className={cn("block h-1 rounded-full", done ? "bg-violet" : current ? (c.status === "in_review" ? "bg-acid" : "bg-purple") : "bg-line")} />
                    <span className={cn("mt-2 flex items-center gap-1 text-[11px] leading-tight sm:text-xs", done || current ? "text-ink" : "text-ink-3")}>
                      {done ? <Check className="hidden size-3 shrink-0 text-violet sm:block" /> : current ? <Clock className="hidden size-3 shrink-0 sm:block" /> : null}
                      <span className="min-w-0">{i === 3 && c.status === "paused" ? "Paused" : label}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-4 text-xs text-ink-2">
              {c.status === "in_review"
                ? "We review campaigns within 1 business day; ones that start within 48 hours go first. You'll get a notification when it's approved, or the reason if it isn't. Nothing runs until then."
                : c.status === "scheduled"
                  ? `Approved. It starts ${formatDate(start, { weekday: true })} and runs for ${c.days} days.`
                  : c.status === "active"
                    ? `Running until ${formatDate(addDays(start, c.days - 1), { weekday: true })}. Numbers update daily.`
                    : c.status === "paused"
                      ? "Paused by NOCTURNE. If it stays paused for more than a fifth of its run you get a credit for the missed days."
                      : "Finished. These are the final results."}
            </p>
          </>
        )}
      </section>

      {hasResults ? (
        <>
          <section aria-label="Results" className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <MetricTile label="Spend" value={m.spend} format={(n) => formatMoney(Math.round(n), "USD")} hint={cur !== "USD" ? `about ${formatMoney(convert(m.spend, "USD", cur), cur, { compact: true })}` : undefined} />
            <MetricTile label="Impressions" value={m.impressions} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Reach" value={m.reach} format={(n) => formatNumber(Math.round(n))} hint="different people" />
            <MetricTile label="Clicks" value={m.clicks} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="CTR" value={m.ctr} format={(n) => formatPercent(n, 2)} hint="clicks ÷ impressions" />
            <MetricTile label="Product views" value={m.productViews} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Add-to-carts" value={m.addToCarts} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Purchases" value={m.purchases} format={(n) => formatNumber(Math.round(n))} hint="attributed" />
            <MetricTile label="Attributed revenue" value={convert(m.revenue, "USD", cur)} format={(n) => formatMoney(Math.round(n), cur, { compact: true })} />
            <MetricTile label="ROAS" value={m.roas ?? 0} format={(n) => (m.roas === null ? "–" : `${n.toFixed(1)}×`)} hint="revenue ÷ spend" />
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section aria-labelledby="daily-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
              <div className="mb-4">
                <h2 id="daily-title" className="text-sm font-medium text-ink">Clicks by day</h2>
                <p className="mt-0.5 text-xs text-ink-2">{formatNumber(c.results.clicks)} clicks from {formatNumber(c.results.impressions)} impressions.</p>
              </div>
              <TimeSeriesChart data={series} series={[{ key: "clicks", label: "Clicks" }]} format={(n) => formatNumber(Math.round(n), { compact: true })} height={240} kind={series.length < 10 ? "bar" : "area"} />
            </section>

            <Panel title="From view to purchase" description="Each step as a share of the one before.">
              <ol className="grid gap-3">
                {funnel.map((f, i) => {
                  const base = funnel[0].value || 1
                  const prev = i ? funnel[i - 1].value : 0
                  return (
                    <li key={f.label}>
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-ink-2">{f.label}</span>
                        <span className="text-ink tabular">
                          {formatNumber(f.value)}
                          {i ? <span className="ml-2 text-ink-3">{prev ? formatPercent(f.value / prev, 1) : "–"}</span> : null}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                        <div className={cn("h-full rounded-full", i === funnel.length - 1 ? "bg-acid" : "bg-purple")} style={{ width: `${Math.max(f.value ? 1.5 : 0, (f.value / base) * 100)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ol>
            </Panel>
          </div>
        </>
      ) : (
        <Panel title="Results" description="What you'll see here once the campaign runs.">
          <p className="text-sm text-ink-2">Impressions, reach, clicks and click-through rate, product views, add-to-carts, attributed purchases and revenue, and return on ad spend, updated daily from the first day of the run.</p>
        </Panel>
      )}

      <section aria-labelledby="attr-title" className="flex gap-3 rounded-lg border border-line-soft bg-card p-4 md:p-5">
        <Info className="mt-0.5 size-4 shrink-0 text-violet" />
        <div className="min-w-0">
          <h2 id="attr-title" className="text-sm font-medium text-ink">How purchases are counted</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            {ATTRIBUTION.note} Each order is credited to one campaign at most, and refunds are taken back off. Attributed purchases are the most this campaign can claim; some of those shoppers might have bought anyway. Your 5% commission is the same either way.
          </p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Placement" description="How it looks to shoppers.">
          <PlacementPreview type={c.type} brand={brand} target={target} categories={c.audience.categories} />
        </Panel>
        <Panel title="Booking">
          <dl className="grid gap-2.5 text-xs">
            <Row label="Type" value={type.name} />
            <Row label="Promoting" value={target?.name ?? brand.name} />
            <Row label="Placements" value={c.placements.map((p) => placementMeta[p].label).join(", ")} />
            <Row label="Categories" value={c.audience.categories.length ? c.audience.categories.map((s) => categories.find((x) => x.slug === s)?.name ?? s).join(", ") : "All"} />
            <Row label="Markets" value={c.audience.countries.length ? c.audience.countries.map(countryName).join(", ") : "All markets"} />
            <Row label="Dates" value={campaignDates(c, today)} />
            <Row label="Price" value={price} />
            <Row label="Rate" value={type.unit === "day" ? `${perDay} a day for ${c.days} days` : "Flat price"} />
            <Row label="Paid" value={campaignSpends(c) || c.status === "in_review" || c.status === "scheduled" ? "Yes" : c.status === "rejected" ? "Refunded" : "Not yet"} />
            <Row label="ROAS" value={hasResults ? roasText(m.roas) : "–"} />
          </dl>
        </Panel>
      </div>

      <Dialog open={withdraw} onOpenChange={setWithdraw}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Withdraw from review?</DialogTitle>
            <DialogDescription className="text-ink-2">
              The booking is released and {price} is refunded in full. The campaign goes back to drafts so you can change it and submit again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setWithdraw(false)}>Keep in review</Button>
            <Button variant="destructive" onClick={confirmWithdraw}><X /> Withdraw</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="text-right text-ink tabular">{value}</dd>
    </div>
  )
}
