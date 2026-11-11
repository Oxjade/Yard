"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowSquareOutIcon, CoinsIcon, PackageIcon, PlusIcon, ShoppingCartIcon, TruckIcon, WalletIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { change } from "@/components/dashboard/insight/derive"
import { InsightPanel } from "@/components/dashboard/insight/insight-panel"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { SetupCard } from "@/components/studio/setup/setup-card"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api, ApiError } from "@/lib/api/client"
import type { StudioOverviewDto } from "@/lib/api/contracts/orders"
import type { PayoutSummaryDto } from "@/lib/api/contracts/payouts"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, formatNumber } from "@/lib/money"
import { useRealtimeEventName } from "@/lib/realtime/use-realtime"
import { useNow } from "@/hooks/use-now"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { plural, relativeDay } from "./model"

type Days = 7 | 30 | 90
const periodLabel: Record<Days, string> = { 7: "7 days", 30: "30 days", 90: "90 days" }

const asCurrency = (c: string | undefined, fallback: CurrencyCode): CurrencyCode => (c && c in currencies ? (c as CurrencyCode) : fallback)

/**
 * The Studio Overview for a real brand: every figure is read from Yard's server (GET
 * /api/studio/overview, and the payout balance from GET /api/studio/payouts, the same request the
 * sidebar makes). No traffic, follows or views: those have no real source yet, so they aren't shown.
 */
export function LiveOverview({ member }: { member: BrandProfile }) {
  const [days, setDays] = useState<Days>(30)
  // The viewer's clock, for "Today" and "3 days ago" (null until mounted; the orders load after that).
  const now = useNow(60_000)
  const brandId = member.brand.id
  const overview = useApi<StudioOverviewDto>(`studio.overview:${brandId}:${days}`, () => api<StudioOverviewDto>("/api/studio/overview", { query: { days } }), { revalidateOnFocus: true })
  // Owners, admins and finance read payouts (the server's finance roles); the key matches the sidebar's, so it's one request.
  const financeView = member.role === "owner" || member.role === "admin" || member.role === "finance"
  const payouts = useApi<PayoutSummaryDto>(financeView ? `studio.payouts:${brandId}` : null, () => api<PayoutSummaryDto>("/api/studio/payouts"), { revalidateOnFocus: true })
  useRealtimeEventName("order.updated", () => void overview.revalidate())
  useRealtimeEventName("payout.updated", () => {
    if (financeView) void payouts.revalidate()
  })

  const data = overview.data
  const ready = !!data
  const failed = !data && !!overview.error
  const errorText = overview.error instanceof ApiError ? overview.error.message : "Yard's server didn't answer."

  // Orders are priced in the brand's currency; any other currency shows as its own line under the card.
  const brandCurrency = asCurrency(overview.data?.currency ?? payouts.data?.currency, "NGN")
  const sales = data?.sales ?? []
  const main = sales.find((s) => s.currency === brandCurrency) ?? [...sales].sort((a, b) => b.orders - a.orders)[0]
  const cur = asCurrency(main?.currency, brandCurrency)
  const others = sales.filter((s) => s !== main && s.orders > 0)
  const net = main ? main.grossMinor - main.refundedMinor : 0
  const prevNet = main ? main.prevGrossMinor - main.prevRefundedMinor : 0
  const orders = main?.orders ?? 0
  const money = (n: number) => formatMoney(Math.round(n), cur)
  const int = (n: number) => formatNumber(Math.round(n))
  const versus = `the ${periodLabel[days]} before`
  const noOrdersYet = ready && !data.recentOrders.length

  const balance = payouts.data?.balances.find((b) => b.currency === payouts.data?.currency)
  const payoutCur = asCurrency(payouts.data?.currency, brandCurrency)

  return (
    <div className="@container">
      <header className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:justify-between">
        <div className="min-w-0 @4xl:flex-1">
          <h1 className="text-2xl font-medium tracking-tight text-ink">Overview</h1>
          <p className="mt-1.5 text-sm text-ink-2">Last {periodLabel[days]}, against {versus}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 @4xl:shrink-0 @4xl:flex-nowrap">
          <Segmented
            label="Period"
            value={String(days) as "7" | "30" | "90"}
            onChange={(v) => setDays(Number(v) as Days)}
            options={([7, 30, 90] as const).map((d) => ({ value: String(d) as "7" | "30" | "90", label: periodLabel[d] }))}
            className="w-full @2xl:w-auto [&>button]:flex-1 @2xl:[&>button]:flex-none"
          />
          <Button asChild variant="primary" className="h-10 rounded-full px-4">
            <Link href="/studio/products/new">
              <PlusIcon weight="bold" /> Add product
            </Link>
          </Button>
          <Button asChild variant="secondary" className="h-10 rounded-full px-3.5">
            <Link href={`/brands/${member.brand.handle}`} target="_blank" rel="noopener">
              View storefront <ArrowSquareOutIcon aria-hidden className="size-3.5 text-ink-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
          </Button>
        </div>
      </header>

      {/* Server-backed setup guidance; nothing when dismissed or all done. */}
      <SetupCard className="mt-6" />

      {failed ? (
        <div role="alert" className="mt-6 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink">Couldn&apos;t load your overview</p>
          <p className="max-w-sm text-sm text-ink-2">{errorText}</p>
          <Button variant="secondary" size="sm" className="h-10" onClick={() => void overview.revalidate()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <section aria-labelledby="studio-key-metrics" className={`mt-6 grid gap-3 @lg:grid-cols-2 ${financeView ? "@5xl:grid-cols-4" : "@5xl:grid-cols-3"}`}>
            <h2 id="studio-key-metrics" className="sr-only">
              Key metrics
            </h2>
            <StatCard
              icon={CoinsIcon}
              label="Sales"
              value={net}
              format={money}
              delta={ready ? change(net, prevNet) : null}
              deltaContext={versus}
              hint={ready ? (others.length ? `Paid orders, after refunds. Also ${others.map((o) => formatMoney(o.grossMinor - o.refundedMinor, asCurrency(o.currency, cur))).join(", ")}` : "Paid orders, after refunds") : undefined}
              href="/studio/orders"
              hrefLabel="Open orders"
              ready={ready}
            />
            <StatCard icon={ShoppingCartIcon} label="Paid orders" value={orders} format={int} delta={ready ? change(orders, main?.prevOrders ?? 0) : null} deltaContext={versus} hint={ready ? `vs ${int(main?.prevOrders ?? 0)} in ${versus}` : undefined} href="/studio/orders" hrefLabel="Open orders" ready={ready} />
            <StatCard
              icon={TruckIcon}
              label="Not yet shipped"
              value={data?.toShip.total ?? 0}
              format={int}
              hint={ready ? (data.toShip.total ? `${int(data.toShip.paid)} to fulfil, ${int(data.toShip.processing)} processing` : "Everything has shipped") : undefined}
              href="/studio/orders"
              hrefLabel="Open orders to fulfil"
              variant="brand"
              ready={ready}
            />
            {financeView ? (
              <StatCard
                icon={WalletIcon}
                label="Available to pay out"
                value={payouts.error && !payouts.data ? 0 : Math.max(0, balance?.availableMinor ?? 0)}
                format={(n) => (payouts.error && !payouts.data ? "Unavailable" : formatMoney(n, payoutCur))}
                hint={payouts.data ? (balance?.pendingMinor ? `${formatMoney(balance.pendingMinor, payoutCur)} pending` : "Nothing pending") : payouts.error ? "Couldn't load payouts" : undefined}
                href="/studio/payouts"
                hrefLabel="Open payouts"
                ready={!!payouts.data || !!payouts.error}
              />
            ) : null}
          </section>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,22.5rem)]">
            <InsightPanel title="Recent orders" description="The latest six, newest first" href="/studio/orders" hrefLabel="All orders" bodyClassName="px-0 md:px-0 pt-3 pb-2 md:pb-2">
              {!ready ? (
                <ul aria-hidden className="divide-y divide-white/[0.05] border-t border-white/[0.05]">
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="flex h-[72px] items-center gap-4 px-5">
                      <span className="skeleton h-3.5 w-20 rounded" />
                      <span className="skeleton h-3.5 flex-1 rounded" />
                      <span className="skeleton h-5 w-20 rounded" />
                    </li>
                  ))}
                </ul>
              ) : noOrdersYet ? (
                <EmptyState
                  icon={ShoppingCartIcon}
                  title="No orders yet"
                  body="Share your storefront: orders show here the moment a shopper checks out."
                  action={
                    <Button asChild size="sm" variant="secondary" className="h-10">
                      <Link href={`/brands/${member.brand.handle}`} target="_blank" rel="noopener">
                        View storefront
                      </Link>
                    </Button>
                  }
                  className="mx-5 mb-3 border-0 py-10"
                />
              ) : (
                <ul className="divide-y divide-white/[0.05] border-t border-white/[0.05]">
                  {data.recentOrders.map((o) => {
                    const meta = orderStatusMeta[o.states.merchant] ?? orderStatusMeta.pending_payment
                    const product = `${o.previewItems[0]?.name ?? "Order"}${o.itemCount > 1 ? `, ${plural(o.itemCount, "item")}` : ""}`
                    const when = now === null ? "" : relativeDay(o.placedAt, now)
                    const total = formatMoney(o.totalMinor, asCurrency(o.currency, cur))
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/studio/orders/${o.id}`}
                          aria-label={`Order ${o.reference}, ${product}, ${o.customerName}, ${when}, ${total}, ${meta.label}`}
                          className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors duration-150 hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-ink tabular transition-colors group-hover:text-violet">#{o.reference}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                              {when ? `${o.customerName}, ${when}` : o.customerName}
                            </span>
                          </span>
                          <span className="text-right text-[13px] text-ink tabular">{total}</span>
                          <span className="min-w-0 truncate text-[12.5px] text-ink-2">{product}</span>
                          <span className="justify-self-end">
                            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </InsightPanel>

            <InsightPanel title="Top products" description={`Units sold, last ${periodLabel[days]}`} href="/studio/products" hrefLabel="Open products" bodyClassName="pt-3">
              {!ready ? (
                <ol className="grid gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="flex h-14 items-center gap-3 px-1.5">
                      <span className="skeleton size-10 shrink-0 rounded-lg" />
                      <span className="skeleton h-3.5 flex-1 rounded" />
                    </li>
                  ))}
                </ol>
              ) : data.topProducts.length ? (
                <ol className="grid grid-cols-1 gap-1">
                  {data.topProducts.map((p, i) => (
                    <li key={`${p.productId}:${p.currency}`}>
                      <Link href={`/studio/products/${p.productId}`} className="group flex min-h-14 items-center gap-3 rounded-xl px-1.5 py-1.5 transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet">
                        <span className="w-4 shrink-0 text-center text-[11px] text-ink-3 tabular">{i + 1}</span>
                        <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-elevated">
                          {p.image ? <Image src={p.image.src} alt="" fill sizes="40px" className="object-cover" /> : <PackageIcon aria-hidden className="absolute inset-0 m-auto size-4 text-ink-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink transition-colors group-hover:text-violet">{p.title}</span>
                          <span className="mt-0.5 block truncate text-[12px] text-ink-3 tabular">{formatMoney(p.revenueMinor, asCurrency(p.currency, cur))}</span>
                        </span>
                        <span className="shrink-0 text-right text-[12px] text-ink-2 tabular">{plural(p.units, "unit")}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState icon={PackageIcon} title="No sales in this period" body={noOrdersYet ? "Your best sellers show here once orders come in." : "Try a longer period."} className="border-0 py-10" />
              )}
            </InsightPanel>
          </div>
        </>
      )}
    </div>
  )
}
