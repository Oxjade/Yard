"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Info, Megaphone, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge, campaignStatusMeta } from "@/components/dashboard/status-badge"
import { useNow } from "@/hooks/use-now"
import { brandById } from "@/lib/data/brands"
import { ATTRIBUTION, campaignTypes, type Campaign } from "@/lib/data/ads"
import { convert, formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useStudio } from "@/lib/stores/studio"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { ListSkeleton } from "./form"
import { useGrowthReady } from "./store"
import { addDays, brandZone, campaignMetrics, campaignPriceUsd, campaignSpends, formatDate, todayIn, usdAndLocal, usdAndLocalText } from "./utils"

type Tab = "current" | "past"

export function AdvertisingIndex() {
  const ready = useGrowthReady()
  const now = useNow(60_000)
  if (!ready || now === null) return <ListSkeleton tiles={4} />
  return <AdvertisingView now={now} />
}

/** "Explained" ROAS: revenue per unit of spend, with a dash when nothing ran. */
export function roasText(roas: number | null) {
  return roas === null ? "No spend yet" : `${roas.toFixed(1)}×`
}

export function campaignDates(c: Campaign, today: string) {
  const start = addDays(today, c.startDaysFromToday)
  const end = addDays(start, c.days - 1)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${formatDate(start, { year: !sameYear })} to ${formatDate(end)}`
}

function AdvertisingView({ now }: { now: number }) {
  const brandId = useStudio((s) => s.brandId)
  const campaigns = useStudio((s) => s.campaigns)
  const brand = brandById.get(brandId)!
  const cur = brand.currency
  const today = todayIn(brandZone(brand).tz, now)
  const [tab, setTab] = useState<Tab>("current")

  const mine = campaigns.filter((c) => c.brandId === brandId)
  const current = mine.filter((c) => c.status !== "completed")
  const past = mine.filter((c) => c.status === "completed")
  const visible = tab === "current" ? current : past
  const ran = mine.filter(campaignSpends)
  const m = campaignMetrics(ran)
  const local = (usd: number) => formatMoney(convert(usd, "USD", cur), cur, { compact: true })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Advertising"
        description="Fixed-price sponsored placements on Discover, Brands, categories, search and Drops. Paid placements are always labelled Sponsored and never replace organic results."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/advertising/new"><Plus /> Create campaign</Link>
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {mine.length === 0 ? (
        <EmptyState icon={Megaphone} title="Run your first campaign" body="Book a sponsored slot for your brand, a product or a drop. Prices are fixed and shown before you pay." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/advertising/new"><Plus /> Create campaign</Link></Button>} />
      ) : (
        <>
          <section aria-label="Advertising results, all campaigns" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <MetricTile label="Spend" value={m.spend} format={(n) => formatMoney(Math.round(n), "USD")} hint={cur !== "USD" ? `about ${local(m.spend)}` : "campaigns that ran"} />
            <MetricTile label="Impressions" value={m.impressions} format={(n) => formatNumber(Math.round(n), { compact: true })} hint={`${formatNumber(m.reach, { compact: true })} people reached`} />
            <MetricTile label="Clicks" value={m.clicks} format={(n) => formatNumber(Math.round(n))} hint={`${formatPercent(m.ctr, 2)} click-through rate`} />
            <MetricTile label="Attributed purchases" value={m.purchases} format={(n) => formatNumber(Math.round(n))} hint={`from ${formatNumber(m.addToCarts)} add-to-carts`} />
            <MetricTile label="Attributed revenue" value={convert(m.revenue, "USD", cur)} format={(n) => formatMoney(Math.round(n), cur, { compact: true })} hint={m.roas === null ? "no spend yet" : `${roasText(m.roas)} return on ad spend`} className="col-span-2 md:col-span-1" />
          </section>

          <section aria-labelledby="attribution-title" className="flex gap-3 rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <Info className="mt-0.5 size-4 shrink-0 text-violet" />
            <div className="min-w-0">
              <h2 id="attribution-title" className="text-sm font-medium text-ink">How purchases are counted</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">
                {ATTRIBUTION.note} Each order is credited to one campaign at most, so totals never double count. Some of these shoppers might have bought anyway, so treat attributed revenue as the most a campaign can claim, not extra revenue on top of your sales.
              </p>
            </div>
          </section>

          <div className="grid gap-4">
            <StatusTabs
              id="campaign-status"
              label="Campaign status"
              value={tab}
              onChange={setTab}
              controls="campaign-list"
              tabs={[
                { value: "current", label: "Active and upcoming", count: current.length },
                { value: "past", label: "Past", count: past.length },
              ]}
            />

            <section id="campaign-list" aria-label="Campaigns" className="overflow-hidden rounded-lg border border-line-soft bg-card">
              {visible.length === 0 ? (
                <div className="p-4 md:p-5">
                  <EmptyState
                    icon={Megaphone}
                    title={tab === "current" ? "Nothing running or booked" : "No past campaigns yet"}
                    body={tab === "current" ? "Book a placement and it shows here from review to the last day." : "Campaigns move here when they finish, with their final results."}
                    action={tab === "current" ? <Button asChild variant="secondary" size="sm"><Link href="/studio/advertising/new">Create campaign</Link></Button> : <Button variant="secondary" size="sm" onClick={() => setTab("current")}>Show active and upcoming</Button>}
                  />
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-line-soft md:hidden">
                    {visible.map((c) => (
                      <CampaignCard key={c.id} c={c} today={today} cur={cur} />
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[1040px] text-left text-sm">
                      <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Campaign</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Dates</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Spend</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Impressions</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Clicks</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">CTR</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Purchases</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Revenue</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-normal md:px-5">ROAS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {visible.map((c) => {
                          const meta = campaignStatusMeta[c.status]
                          const r = c.results
                          const spends = campaignSpends(c)
                          const roas = spends && c.budget ? r.revenue / c.budget : null
                          return (
                            <Fragment key={c.id}>
                              <tr className="transition-colors hover:bg-white/[0.02]">
                                <td className="px-4 py-3 md:px-5">
                                  <Link href={`/studio/advertising/${c.id}`} className="group block max-w-[260px]">
                                    <span className="block truncate font-medium text-ink group-hover:text-violet">{c.name}</span>
                                    <span className="block truncate text-xs text-ink-3">{campaignTypes[c.type].name}</span>
                                  </Link>
                                </td>
                                <td className="px-3 py-3"><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></td>
                                <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular">{campaignDates(c, today)}</td>
                                <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                                  <Spend c={c} cur={cur} />
                                </td>
                                <Num v={r.impressions} />
                                <Num v={r.clicks} />
                                <td className="px-3 py-3 text-right text-ink-2 tabular">{r.impressions ? formatPercent(r.clicks / r.impressions, 2) : "–"}</td>
                                <Num v={r.purchases} />
                                <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">{r.revenue ? formatMoney(convert(r.revenue, c.currency, cur), cur, { compact: true }) : <span className="text-ink-3">–</span>}</td>
                                <td className="px-4 py-3 text-right text-ink tabular md:px-5">{roas !== null && r.impressions ? `${roas.toFixed(1)}×` : <span className="text-ink-3">–</span>}</td>
                              </tr>
                              {c.status === "rejected" ? (
                                <tr className="bg-danger/[0.03]">
                                  <td colSpan={10} className="px-4 pt-0 pb-3 md:px-5">
                                    <RejectedNote c={c} cur={cur} />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <p className="text-xs text-ink-3">Spend is the fixed booking price in USD, excluding VAT{cur !== "USD" ? `, with the ${cur} amount at today's rate under it` : ""}. Revenue is shown in {cur}. Results are sample data until the store is connected.</p>
          </div>
        </>
      )}
    </div>
  )
}

/** The booking price in USD with the brand-currency amount under it; refunded or unbooked campaigns say so instead. */
function Spend({ c, cur }: { c: Campaign; cur: Parameters<typeof formatMoney>[1] }) {
  if (c.status === "rejected" || c.status === "draft") return <span className="text-ink-3">{c.status === "rejected" ? "Refunded" : "Not booked"}</span>
  const { usd, local } = usdAndLocal(campaignPriceUsd(c), cur)
  return (
    <>
      <span className={cn("block", campaignSpends(c) ? "text-ink" : "text-ink-3")}>{usd}</span>
      {local ? <span className="block text-xs text-ink-3">{local}</span> : null}
    </>
  )
}

function Num({ v }: { v: number }) {
  return <td className="px-3 py-3 text-right text-ink tabular">{v ? formatNumber(v) : <span className="text-ink-3">–</span>}</td>
}

export function RejectedNote({ c, cur }: { c: Campaign; cur: Parameters<typeof formatMoney>[1] }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 p-3 sm:flex-row sm:items-center">
      <AlertTriangle className="hidden size-4 shrink-0 text-danger sm:block" />
      <p className="min-w-0 flex-1 text-xs text-ink-2">
        <span className="font-medium text-danger">Rejected: </span>
        {c.rejectionReason ?? "It didn't meet the advertising rules."} Your payment of {usdAndLocalText(campaignPriceUsd(c), cur)} was refunded.
      </p>
      <Button asChild variant="secondary" size="xs" className="w-fit">
        <Link href={`/studio/advertising/${c.id}/edit`}>Edit and resubmit</Link>
      </Button>
    </div>
  )
}

function CampaignCard({ c, today, cur }: { c: Campaign; today: string; cur: Parameters<typeof formatMoney>[1] }) {
  const meta = campaignStatusMeta[c.status]
  const r = c.results
  return (
    <li className="p-4">
      <Link href={`/studio/advertising/${c.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{c.name}</p>
            <p className="truncate text-xs text-ink-3">{campaignTypes[c.type].name}</p>
          </div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
        <p className="mt-2 text-xs text-ink-2 tabular">{campaignDates(c, today)}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-ink-3">Spend</dt>
            <dd className="mt-0.5 tabular"><Spend c={c} cur={cur} /></dd>
          </div>
          <div>
            <dt className="text-ink-3">Clicks</dt>
            <dd className="mt-0.5 text-ink tabular">{r.clicks ? `${formatNumber(r.clicks)} (${formatPercent(r.clicks / Math.max(1, r.impressions), 1)})` : "–"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Revenue</dt>
            <dd className="mt-0.5 text-ink tabular">{r.revenue ? formatMoney(convert(r.revenue, c.currency, cur), cur, { compact: true }) : "–"}</dd>
          </div>
        </dl>
      </Link>
      {c.status === "rejected" ? <div className="mt-3"><RejectedNote c={c} cur={cur} /></div> : null}
    </li>
  )
}
