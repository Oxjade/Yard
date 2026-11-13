"use client"

import { useMemo, useState } from "react"
import { CubeIcon, ReceiptIcon, StorefrontIcon, UsersIcon } from "@phosphor-icons/react"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { Panel } from "@/components/admin/ui/panel"
import { RevealItem } from "@/components/admin/ui/motion"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { formatNumber } from "@/lib/money"

type OverviewStats = {
  accounts: { total: number; today: number; last7: number; last30: number }
  brands: { listed: number; pendingReview: number; total: number }
  products: { published: number }
  orders: { total: number; last30: number; paid30: number }
  sales30: { currency: string; minor: number }[]
  daily: { day: string; signups: number; orders: number }[]
}

const n = (v: number) => formatNumber(Math.round(v))
const money = (currency: string, minor: number) => {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100)
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`
  }
}
const dayLabel = (day: string, long = false) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", long ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" })

/** The Control Center's real business figures: accounts, brands, products, orders and sales, from Yard's database. */
export function BusinessFigures() {
  const q = useApi("admin:overview:stats", () => api<OverviewStats>("/api/admin/overview"), { refreshInterval: 60_000 })
  const s = q.data
  const ready = !!s
  const [series, setSeries] = useState<"signups" | "orders">("signups")
  const chart = useMemo<BarDatum[]>(
    () => (s?.daily ?? []).map((d, i, all) => {
      const value = series === "signups" ? d.signups : d.orders
      const prev = i ? (series === "signups" ? all[i - 1].signups : all[i - 1].orders) : null
      return { key: d.day, label: dayLabel(d.day), fullLabel: dayLabel(d.day, true), value, delta: prev ? (value - prev) / prev : null }
    }),
    [s, series],
  )
  const sales = s?.sales30.length ? s.sales30.map((x) => money(x.currency, x.minor)).join(" · ") : null

  if (q.error && !s) {
    return (
      <Panel title="Marketplace" description="Couldn't load the figures from Yard's server. They retry every minute." className="rounded-[20px]">
        <span />
      </Panel>
    )
  }

  return (
    <>
      <RevealItem className="px-1 pt-3">
        <h2 className="font-label text-[15px] text-ink">Marketplace</h2>
        <p className="mt-1 text-[12px] text-ink-3">Real figures from Yard&apos;s database, updated every minute.</p>
      </RevealItem>
      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={UsersIcon} label="Shopper accounts" value={s?.accounts.total ?? 0} format={n} hint={s ? `${n(s.accounts.today)} today · ${n(s.accounts.last7)} this week` : undefined} href="/admin/users" hrefLabel="Open Users" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={StorefrontIcon} label="Brands live" value={s?.brands.listed ?? 0} format={n} hint={s ? `${n(s.brands.pendingReview)} waiting for review · ${n(s.brands.total)} in all` : undefined} href="/admin/brands" hrefLabel="Open Brands" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={CubeIcon} label="Products published" value={s?.products.published ?? 0} format={n} hint="Across every brand" href="/admin/products" hrefLabel="Open Listings" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" variant="brand" icon={ReceiptIcon} label="Orders, 30 days" value={s?.orders.last30 ?? 0} format={n} hint={s ? (sales ? `Paid sales: ${sales}` : `${n(s.orders.paid30)} paid · no sales yet`) : undefined} href="/admin/orders" hrefLabel="Open Orders" ready={ready} className="h-full" />
        </RevealItem>
      </div>
      <RevealItem className="min-w-0">
        <Panel
          title={series === "signups" ? "Sign-ups, last 30 days" : "Orders, last 30 days"}
          description={series === "signups" ? "New shopper accounts per day (UTC)." : "Orders placed per day (UTC), every brand."}
          action={<Switch label="Series" value={series} onChange={(v) => setSeries(v as "signups" | "orders")} options={[{ value: "signups", label: "Sign-ups" }, { value: "orders", label: "Orders" }]} />}
          className="rounded-[20px]"
        >
          {ready ? <BarChart data={chart} format={n} formatFull={(v) => `${n(v)} ${series === "signups" ? (v === 1 ? "sign-up" : "sign-ups") : v === 1 ? "order" : "orders"}`} label={series === "signups" ? "Sign-ups per day" : "Orders per day"} height={220} /> : <div className="h-[220px] animate-pulse rounded-lg bg-white/[0.03]" />}
        </Panel>
      </RevealItem>
    </>
  )
}
