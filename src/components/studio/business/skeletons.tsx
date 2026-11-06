import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { Bone, ChartSkeleton } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"

/**
 * Content-shaped loading states for the Studio business pages. Each route's loading.tsx and
 * the page's own "waiting for saved data" state render the same piece, so nothing moves
 * between the two.
 */

/** A DataTable-shaped block: search row, header, rows and the pagination footer. */
export function TableBlockSkeleton({ rows = 8, cols = 5, search = true, tabs = 0 }: { rows?: number; cols?: number; search?: boolean; tabs?: number }) {
  return (
    <div className="grid gap-4" aria-hidden>
      {tabs ? (
        <div className="flex gap-1 overflow-hidden border-b border-line-soft">
          {Array.from({ length: tabs }, (_, i) => (
            <div key={i} className="flex h-10 items-center px-3">
              <Bone className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3">
        {search ? <Bone className="h-9 w-full rounded-md sm:max-w-xs" /> : null}
        <div className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex gap-4 border-b border-line-soft bg-[#111111] px-4 py-3">
            {Array.from({ length: cols }, (_, i) => (
              <Bone key={i} className={cn("h-3 flex-1", i > 1 && "hidden md:block")} />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex h-[61px] items-center gap-4 border-b border-line-soft px-4 last:border-0">
              {Array.from({ length: cols }, (_, c) => (
                <Bone key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-40", c > 1 && "hidden md:block")} />
              ))}
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line-soft px-4 py-3">
            <Bone className="h-3 w-24" />
            <Bone className="h-6 w-32" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrdersSkeleton({ description }: { description: string }) {
  return (
    <div role="status" aria-label="Loading orders" className="grid gap-6">
      <PageHeader title="Orders" description={description} actions={<Bone className="h-8 w-28" />}>
        <SampleDataNote className="mt-3" />
      </PageHeader>
      <TableBlockSkeleton tabs={7} cols={6} />
    </div>
  )
}

export function OrderDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading order" className="grid gap-6">
      <div className="grid gap-2">
        <Bone className="h-3 w-14" />
        <div className="flex flex-col gap-4 border-b border-line-soft pb-5 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <Bone className="h-7 w-56" />
            <Bone className="h-4 w-80 max-w-full" />
            <div className="mt-1 flex gap-2">
              <Bone className="h-5 w-20" />
              <Bone className="h-5 w-16" />
            </div>
          </div>
          <div className="flex gap-2">
            <Bone className="h-8 w-28" />
            <Bone className="h-8 w-36" />
          </div>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-6">
          <div className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <Bone className="h-4 w-24" />
            <Bone className="mt-2 h-3 w-full max-w-md" />
            <div className="mt-5 grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <Bone key={i} className="h-1" />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Bone className="size-14 shrink-0" />
                <div className="grid flex-1 gap-2">
                  <Bone className="h-3.5 w-1/2" />
                  <Bone className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-6">
          <Bone className="h-56 rounded-lg" />
          <Bone className="h-44 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export function CustomersSkeleton({ description }: { description: string }) {
  return (
    <div role="status" aria-label="Loading customers" className="grid gap-6">
      <PageHeader title="Customers" description={description}>
        <SampleDataNote className="mt-3" />
      </PageHeader>
      <TableBlockSkeleton tabs={4} cols={6} />
    </div>
  )
}

export const analyticsDescription = (brandName: string) => `How shoppers find, consider and buy from ${brandName}, compared with the period before.`

export function AnalyticsBodySkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-[20px] border border-white/[0.06] bg-surface p-4 md:p-5">
            <Bone className="h-3 w-28" />
            <Bone className="mt-5 h-10 w-32" />
            <Bone className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-[20px] border border-white/[0.06] bg-surface p-4 md:p-5">
          <Bone className="h-4 w-28" />
          <Bone className="mt-2 h-3 w-56" />
          <div className="mt-4">
            <ChartSkeleton height={280} />
          </div>
        </div>
        <div className="rounded-[20px] border border-white/[0.06] bg-surface p-4 md:p-5">
          <Bone className="h-4 w-36" />
          <div className="mt-5 grid gap-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid gap-2">
                <Bone className="h-3.5 w-full" />
                <Bone className="h-2.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AnalyticsSkeleton({ description }: { description: string }) {
  return (
    <div role="status" aria-label="Loading analytics" className="grid gap-6">
      <PageHeader title="Analytics" description={description} actions={<Bone className="h-10 w-60 rounded-full" />} />
      <AnalyticsBodySkeleton />
    </div>
  )
}

export function SettingsSectionsSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
          <Bone className="h-4 w-32" />
          <Bone className="mt-2 h-3 w-64 max-w-full" />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Bone className="h-10" />
            <Bone className="h-10" />
            <Bone className="h-10" />
            <Bone className="h-10" />
          </div>
          <div className="mt-5 flex justify-end border-t border-line-soft pt-4">
            <Bone className="h-8 w-28" />
          </div>
        </div>
      ))}
    </div>
  )
}

const settingsSections = ["Brand profile", "Payouts", "Shipping", "Returns", "Team", "Fees"]

export function SettingsSkeleton({ description }: { description: string }) {
  return (
    <div role="status" aria-label="Loading settings" className="grid gap-6">
      <PageHeader title="Settings" description={description} />
      <div className="flex gap-1.5 overflow-hidden xl:hidden" aria-hidden>
        {settingsSections.map((s) => (
          <span key={s} className="inline-flex h-8 shrink-0 items-center rounded-full border border-line px-3 text-xs text-ink-3">{s}</span>
        ))}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[200px_minmax(0,1fr)]">
        <ul className="hidden gap-0.5 xl:grid" aria-hidden>
          {settingsSections.map((s) => (
            <li key={s} className="flex h-9 items-center px-3 text-sm text-ink-3">{s}</li>
          ))}
        </ul>
        <SettingsSectionsSkeleton />
      </div>
    </div>
  )
}

/**
 * The payout balance tiles' grid, shared by the page and its skeletons so nothing moves.
 * Available leads: the full row on phones, a double tile beside the other four from xl.
 */
export const payoutTileGrid = "grid grid-cols-2 gap-3 xl:grid-cols-4"
export const payoutTilePrimary = "col-span-2 border-acid/25 xl:row-span-2"

export function PayoutTilesSkeleton() {
  return (
    <div role="status" aria-label="Loading balances" className={payoutTileGrid}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={cn("flex flex-col rounded-[20px] border border-white/[0.06] bg-surface p-4 md:p-5", i === 0 && payoutTilePrimary)}>
          <Bone className="h-3 w-28" />
          <Bone className={i === 0 ? "mt-4 h-9 w-44 md:h-10 xl:h-12" : "mt-4 h-7 w-28 md:h-8"} />
          {i === 0 ? <Bone className="mt-auto hidden h-3 w-64 max-w-full xl:block" /> : null}
        </div>
      ))}
    </div>
  )
}

export function PayoutsSkeleton({ description }: { description: string }) {
  return (
    <div role="status" aria-label="Loading payouts" className="grid gap-6">
      <PageHeader title="Payouts" description={description} actions={<Bone className="h-8 w-36" />}>
        <SampleDataNote className="mt-3" />
      </PageHeader>
      <PayoutTilesSkeleton />
      <Bone className="h-[118px] rounded-lg" />
      <TableBlockSkeleton rows={3} cols={5} search={false} />
    </div>
  )
}
