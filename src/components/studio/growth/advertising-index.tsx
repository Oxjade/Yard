"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { WarningIcon as AlertTriangle, ChartLineUpIcon as Chart, InfoIcon as Info, MegaphoneIcon as Megaphone, PencilSimpleIcon as Pencil, PlusIcon as Plus, XIcon as X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
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
import { phoneCellWide, useFocusReturn } from "@/components/studio/business/shared"
import { advertisingDescription } from "./copy"
import { ListSkeleton } from "./form"
import { useCampaignReviewSync, useGrowthReady, withdrawCampaignFromReview } from "./store"
import { addDays, brandZone, campaignMetrics, campaignPriceUsd, campaignSpends, formatDate, todayIn, usdAndLocal, usdAndLocalText } from "./utils"

type Tab = "current" | "past"

/** Why Edit is unavailable for a campaign that's booked or has run. */
const lockedReason: Partial<Record<Campaign["status"], string>> = {
  scheduled: "Booked campaigns can't change.",
  active: "Running campaigns can't change.",
  paused: "Paused campaigns can't change mid-run.",
  completed: "Finished campaigns can't change.",
}

export function AdvertisingIndex() {
  const ready = useGrowthReady()
  const now = useNow(60_000)
  useCampaignReviewSync()
  if (!ready || now === null) return <ListSkeleton title="Advertising" description={advertisingDescription} tiles={5} tabs={2} />
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
  const router = useRouter()
  const brandId = useStudio((s) => s.brandId)
  const campaigns = useStudio((s) => s.campaigns)
  const brand = brandById.get(brandId)!
  const cur = brand.currency
  const today = todayIn(brandZone(brand).tz, now)
  const [tab, setTab] = useState<Tab>("current")
  const upsertCampaign = useStudio((s) => s.upsertCampaign)
  // "Edit" on a campaign in review asks to withdraw it first. The dialog keeps the campaign while it animates closed.
  const [withdrawing, setWithdrawing] = useState<Campaign | null>(null)
  const [lastWithdrawing, setLastWithdrawing] = useState<Campaign | null>(null)
  if (withdrawing && withdrawing !== lastWithdrawing) setLastWithdrawing(withdrawing)
  const asked = withdrawing ?? lastWithdrawing
  // Opened from the row menu: closing lands on that row's menu button, as in the other tables; the campaign link if the row has gone.
  const withdrawFocus = useFocusReturn(() => (asked ? (document.querySelector<HTMLElement>(`[data-row-actions="${CSS.escape(asked.id)}"]`) ?? document.querySelector<HTMLElement>(`a[href="/studio/advertising/${asked.id}"]`)) : null))

  function withdrawAndEdit(c: Campaign) {
    const now = useStudio.getState().campaigns.find((x) => x.id === c.id)
    if (now?.status === "in_review") {
      upsertCampaign({ ...now, status: "draft" })
      withdrawCampaignFromReview(c.id)
    }
    setWithdrawing(null)
    router.push(`/studio/advertising/${c.id}/edit`)
  }

  const mine = campaigns.filter((c) => c.brandId === brandId)
  const current = mine.filter((c) => c.status !== "completed")
  const past = mine.filter((c) => c.status === "completed")
  const visible = tab === "current" ? current : past
  const ran = mine.filter(campaignSpends)
  const m = campaignMetrics(ran)
  const local = (usd: number) => formatMoney(convert(usd, "USD", cur), cur, { compact: true })
  const rejected = visible.filter((c) => c.status === "rejected")
  const roasOf = (c: Campaign) => (campaignSpends(c) && c.budget && c.results.impressions ? c.results.revenue / c.budget : null)
  const dash = <span className="text-ink-3">–</span>

  const columns: Column<Campaign>[] = [
    {
      key: "name",
      header: "Campaign",
      sortValue: (c) => c.name,
      cell: (c) => {
        const meta = campaignStatusMeta[c.status]
        return (
          <div className={phoneCellWide}>
            <div className="flex items-start justify-between gap-3">
              <Link href={`/studio/advertising/${c.id}`} className="group block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-violet md:max-w-[260px]">
                <span className="block truncate font-medium text-ink group-hover:text-violet">{c.name}</span>
                <span className="block truncate text-xs text-ink-3">{campaignTypes[c.type].name}</span>
              </Link>
              <span className="text-right text-sm whitespace-nowrap md:hidden"><Spend c={c} cur={cur} /></span>
            </div>
            {/* Phones: status and dates fold into the first cell. */}
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
              <span className="text-xs text-ink-2 tabular">{campaignDates(c, today)}</span>
            </span>
          </div>
        )
      },
    },
    { key: "status", header: "Status", sortValue: (c) => campaignStatusMeta[c.status].label, hideBelow: "md", cell: (c) => <StatusBadge tone={campaignStatusMeta[c.status].tone}>{campaignStatusMeta[c.status].label}</StatusBadge> },
    { key: "dates", header: "Dates", sortValue: (c) => c.startDaysFromToday, hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink-2 tabular">{campaignDates(c, today)}</span> },
    { key: "spend", header: "Spend", align: "right", sortValue: (c) => (campaignSpends(c) ? campaignPriceUsd(c) : 0), hideBelow: "md", cell: (c) => <span className="whitespace-nowrap"><Spend c={c} cur={cur} /></span> },
    { key: "impressions", header: "Impressions", align: "right", sortValue: (c) => c.results.impressions, hideBelow: "lg", cell: (c) => (c.results.impressions ? formatNumber(c.results.impressions) : dash) },
    { key: "clicks", header: "Clicks", align: "right", sortValue: (c) => c.results.clicks, hideBelow: "lg", cell: (c) => (c.results.clicks ? formatNumber(c.results.clicks) : dash) },
    { key: "ctr", header: "CTR", align: "right", sortValue: (c) => (c.results.impressions ? c.results.clicks / c.results.impressions : 0), hideBelow: "lg", cell: (c) => (c.results.impressions ? <span className="text-ink-2">{formatPercent(c.results.clicks / c.results.impressions, 2)}</span> : dash) },
    { key: "purchases", header: "Purchases", align: "right", sortValue: (c) => c.results.purchases, hideBelow: "lg", cell: (c) => (c.results.purchases ? formatNumber(c.results.purchases) : dash) },
    { key: "revenue", header: "Revenue", align: "right", sortValue: (c) => convert(c.results.revenue, c.currency, "USD"), hideBelow: "md", cell: (c) => (c.results.revenue ? <span className="whitespace-nowrap">{formatMoney(convert(c.results.revenue, c.currency, cur), cur, { compact: true })}</span> : dash) },
    { key: "roas", header: "ROAS", align: "right", sortValue: (c) => roasOf(c) ?? -1, hideBelow: "lg", cell: (c) => { const r = roasOf(c); return r === null ? dash : `${r.toFixed(1)}×` } },
  ]
  const rowActions: RowAction<Campaign>[] = [
    { label: "View results", icon: Chart, onSelect: (c) => router.push(`/studio/advertising/${c.id}`) },
    // In review: Edit explains that it has to be withdrawn first, and does both on confirm.
    // Booked, running and finished campaigns can't change; the menu says why.
    { label: "Edit", icon: Pencil, onSelect: (c) => (c.status === "in_review" ? setWithdrawing(c) : router.push(`/studio/advertising/${c.id}/edit`)), disabled: (c) => c.status !== "draft" && c.status !== "rejected" && c.status !== "in_review", disabledReason: (c) => lockedReason[c.status] },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Advertising"
        description={advertisingDescription}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/advertising/new"><Plus /> Create campaign</Link>
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <p className="text-xs text-ink-3">Payment is simulated in this build: no card is charged and nothing is deducted from payouts.</p>
        </div>
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

            {rejected.length ? (
              <ul className="grid gap-2" aria-label="Rejected campaigns">
                {rejected.map((c) => (
                  <li key={c.id}>
                    <RejectedNote c={c} cur={cur} named />
                  </li>
                ))}
              </ul>
            ) : null}

            <section id="campaign-list" aria-label="Campaigns">
              <DataTable
                label="Campaigns"
                rows={visible}
                columns={columns}
                getId={(c) => c.id}
                rowActions={rowActions}
                search={{ placeholder: "Search campaigns", text: (c) => `${c.name} ${campaignTypes[c.type].name}` }}
                initialSort={{ key: "dates", dir: "desc" }}
                minWidth={300}
                empty={{
                  title: tab === "current" ? "Nothing running or booked" : "No past campaigns yet",
                  body: tab === "current" ? "Book a placement and it shows here from review to the last day." : "Campaigns move here when they finish, with their final results.",
                  action: tab === "current" ? <Button asChild variant="secondary" size="sm"><Link href="/studio/advertising/new">Create campaign</Link></Button> : <Button variant="secondary" size="sm" onClick={() => setTab("current")}>Show active and upcoming</Button>,
                }}
              />
            </section>
            <p className="text-xs text-ink-3">Drafts and rejected campaigns can be edited. One in review is withdrawn first; booked and running campaigns can&apos;t change.</p>
            <p className="-mt-3 text-xs text-ink-3">Spend is the fixed booking price in USD, excluding VAT{cur !== "USD" ? `, with the ${cur} amount at today's rate under it` : ""}. Revenue is shown in {cur}. Results are sample data.</p>
          </div>
        </>
      )}

      <Dialog open={!!withdrawing} onOpenChange={(o) => !o && setWithdrawing(null)}>
        <DialogContent className="sm:max-w-[440px]" {...withdrawFocus}>
          <DialogHeader>
            <DialogTitle>Withdraw {asked?.name ?? "this campaign"} to edit it?</DialogTitle>
            <DialogDescription className="text-ink-2">
              It&apos;s in review, so it can&apos;t change. Withdrawing takes it out of the review queue and back to drafts, and the simulated payment{asked ? ` of ${usdAndLocalText(campaignPriceUsd(asked), cur)}` : ""} is voided. Submit it again when you&apos;re done.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setWithdrawing(null)}>Keep in review</Button>
            <Button variant="destructive-solid" onClick={() => asked && withdrawAndEdit(asked)}><X /> Withdraw and edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** The booking price in USD with the brand-currency amount under it; refunded or unbooked campaigns say so instead. */
function Spend({ c, cur }: { c: Campaign; cur: Parameters<typeof formatMoney>[1] }) {
  if (c.status === "rejected" || c.status === "draft") return <span className="text-ink-3">{c.status === "rejected" ? "Voided" : "Not booked"}</span>
  const { usd, local } = usdAndLocal(campaignPriceUsd(c), cur)
  return (
    <>
      <span className={cn("block", campaignSpends(c) ? "text-ink" : "text-ink-3")}>{usd}</span>
      {local ? <span className="block text-xs text-ink-3">{local}</span> : null}
    </>
  )
}

export function RejectedNote({ c, cur, named }: { c: Campaign; cur: Parameters<typeof formatMoney>[1]; named?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 p-3 sm:flex-row sm:items-center">
      <AlertTriangle className="hidden size-4 shrink-0 text-danger sm:block" />
      <p className="min-w-0 flex-1 text-xs text-ink-2">
        <span className="font-medium text-danger">{named ? `${c.name} was rejected: ` : "Rejected: "}</span>
        {c.rejectionReason ?? "It didn't meet the advertising rules."} The simulated payment of {usdAndLocalText(campaignPriceUsd(c), cur)} is voided.
      </p>
      <Button asChild variant="secondary" size="xs" className="w-fit">
        <Link href={`/studio/advertising/${c.id}/edit`}>Edit and resubmit</Link>
      </Button>
    </div>
  )
}
