"use client"

import { useId, useMemo } from "react"
import { ArrowCounterClockwiseIcon, ChartLineUpIcon, CopyIcon, EyeIcon, GavelIcon, PackageIcon, ShoppingCartIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { BrandMark } from "@/components/market/brand-mark"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { site } from "@/config/site"
import { brands } from "@/lib/data/brands"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useOrders } from "@/lib/stores/orders"
import { useNow } from "@/hooks/use-now"
import { Filters } from "../marketplace/filters"
import { AdminPageHead, PanelRail, StatRow } from "../marketplace/page-head"
import { buildOrderRows, groupState, isPaidOrder, type OrderRow } from "./derive"
import { amountIn, daysUntil, formatWhen, relDays, usd, usdCompact } from "./format"
import { fulfilMeta, groupMeta, payMeta, type FulfilState } from "./meta"
import { OrderDetail } from "./order-detail"
import { OrdersLiveView } from "./orders-live-view"
import { downloadCsv, InPageLinks, useAdminReady, useSearchParam, writeParams, usePhone } from "./table"
import { useServerSession } from "@/lib/session/use-server-session"


type StatusFilter = "all" | FulfilState | "awaiting_payment" | "refund_requested" | "refunded" | "failed" | "disputed"
type View = "orders" | "checkouts"

const statusGroups = [
  { label: "Fulfilment", options: (["unfulfilled", "on_hold", "processing", "shipped", "delivered", "cancelled"] as const).map((v) => ({ value: v, label: fulfilMeta[v].label })) },
  {
    label: "Payment",
    options: [
      { value: "awaiting_payment", label: "Awaiting payment" },
      { value: "refund_requested", label: "Refund requested" },
      { value: "disputed", label: "Disputed or charged back" },
      { value: "refunded", label: "Refunded" },
      { value: "failed", label: "Charge failed" },
    ],
  },
]
const statusValues = new Set<string>(["all", ...statusGroups.flatMap((g) => g.options.map((o) => o.value))])

function matchesStatus(r: OrderRow, f: StatusFilter) {
  if (f === "all") return true
  if (f === "awaiting_payment") return r.pay === "pending"
  if (f === "refund_requested") return r.pay === "refund_requested" || r.pay === "refund_approved"
  if (f === "refunded") return r.pay === "refunded"
  if (f === "failed") return r.pay === "failed"
  if (f === "disputed") return r.pay === "disputed" || r.pay === "charged_back"
  return r.fulfil === f
}

type CheckoutRow = { id: string; ref: string; customer: string; placedAt: string; orders: OrderRow[]; totalUsd: number; search: string }

const n = (v: number) => formatNumber(Math.round(v))
const copy = (text: string, what: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`, { description: text }),
    () => toast.error("Couldn't reach the clipboard", { description: `Select ${text} and copy it by hand.` }),
  )

function exportOrders(rows: OrderRow[]) {
  downloadCsv(
    `${site.name.toLowerCase()}-orders-${rows.length}.csv`,
    ["Order", "Checkout", "Brand", "Customer", "Placed (UTC)", "Currency", "Total", "Total (USD)", "Payment", "Fulfilment"],
    rows.map((r) => [`#${r.order.reference}`, r.groupRef, r.brand.name, r.customer.name, r.order.placedAt, r.order.currency, amountIn(r.order.total, r.order.currency), (r.totalUsd / 100).toFixed(2), payMeta[r.pay].label, fulfilMeta[r.fulfil].label]),
    `${site.name} brand orders, sample data`,
  )
}

export function OrdersView() {
  const admin = useServerSession((session) => session.admin)
  if (admin && !admin.demo) return <OrdersLiveView />
  return <DemoOrdersView />
}

function DemoOrdersView() {
  const router = useRouter()
  const ready = useAdminReady()
  const phone = usePhone()
  const qid = useId()
  const clientOrders = useOrders((s) => s.orders)
  const groups = useOrders((s) => s.groups)
  // Every row counts days from one today, sample orders and orders placed here alike (see relDays).
  const now = useNow(60_000)
  const refunds = useAdmin((s) => s.refunds)
  const disputes = useAdmin((s) => s.disputes)
  const linkedStatus = useSearchParam("status")
  const linkedBrand = useSearchParam("brand")
  const view: View = useSearchParam("view") === "checkouts" ? "checkouts" : "orders"
  const status = (linkedStatus && statusValues.has(linkedStatus) ? linkedStatus : "all") as StatusFilter
  const brand = linkedBrand && brands.some((b) => b.id === linkedBrand) ? linkedBrand : "all"
  // The open order lives in the URL (/admin/orders?order=mo_…), so other screens link straight to it.
  const orderId = useSearchParam("order")

  const rows = useMemo(() => buildOrderRows(clientOrders, groups, refunds, disputes), [clientOrders, groups, refunds, disputes])
  const filtered = useMemo(() => rows.filter((r) => (brand === "all" || r.brand.id === brand) && matchesStatus(r, status)), [rows, brand, status])
  const checkouts = useMemo(() => {
    const byGroup = new Map<string, CheckoutRow>()
    for (const r of filtered) {
      const g = byGroup.get(r.order.groupId) ?? { id: r.order.groupId, ref: r.groupRef, customer: r.customer.name, placedAt: r.order.placedAt, orders: [], totalUsd: 0, search: "" }
      g.orders.push(r)
      g.totalUsd += r.totalUsd
      g.search += ` ${r.search}`
      byGroup.set(r.order.groupId, g)
    }
    return [...byGroup.values()]
  }, [filtered])

  // Orders placed in this browser arrive with the store's rehydration, so a linked one opens once its row exists.
  const open = !!orderId && rows.some((r) => r.order.id === orderId)
  const openOrder = (id: string) => writeParams({ order: id })

  // Whole days since an order was placed, from the same today as its Placed column (see relDays),
  // so "today" and "30 days" mean what the column says. Paid orders and GMV follow the Overview's
  // rule (isPaidOrder) on the same days, so the two pages agree to the dollar.
  const age = (r: OrderRow) => -daysUntil(r.order.placedAt, now)
  const recent = rows.filter((r) => age(r) < 30 && isPaidOrder(r))
  const today = recent.filter((r) => age(r) <= 0).length
  const gmv = recent.reduce((s, r) => s + r.totalUsd, 0)
  const unfulfilled = rows.filter((r) => r.fulfil === "unfulfilled").length
  const refundAsks = refunds.filter((r) => r.status === "requested").length
  const awaiting = rows.filter((r) => r.pay === "pending").length

  const setFilter = (k: "status" | "brand", v: string) => writeParams({ [k]: v === "all" ? null : v })
  const clear = () => writeParams({ status: null, brand: null })

  const orderColumns: Column<OrderRow>[] = [
    {
      key: "ref",
      header: "Order",
      sortValue: (r) => r.order.reference,
      cell: (r) => (
        <button type="button" onClick={() => openOrder(r.order.id)} className="group block max-w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="block font-medium whitespace-nowrap text-ink tabular group-hover:text-violet">#{r.order.reference}</span>
          <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[200px] md:hidden">
            {r.brand.name}
            <span className="sm:hidden">, {(r.pay !== "paid" ? payMeta[r.pay] : fulfilMeta[r.fulfil]).label.toLowerCase()}</span>
          </span>
        </button>
      ),
    },
    {
      key: "group",
      header: "Checkout",
      // Checkout and Customer fold by the table's own width, not the viewport's: beside the open
      // sidebar they would push the row menu out of view. The order's sheet carries both.
      hideBelowContainer: "6xl",
      sortValue: (r) => r.groupRef,
      cell: (r) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-ink-2 tabular">{r.groupRef}</span>
          {r.groupSize > 1 ? <span className="rounded-[4px] bg-purple/20 px-1.5 text-[10px] leading-4 text-violet">{r.groupSize} brands</span> : null}
        </span>
      ),
    },
    {
      key: "brand",
      header: "Brand",
      hideBelow: "md",
      sortValue: (r) => r.brand.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <BrandMark brand={r.brand} size="xs" />
          <span className="truncate whitespace-nowrap text-ink">{r.brand.name}</span>
        </span>
      ),
    },
    { key: "customer", header: "Customer", hideBelowContainer: "5xl", sortValue: (r) => r.customer.name, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.customer.name}</span> },
    { key: "placed", header: "Placed", hideBelow: "md", sortValue: (r) => r.order.placedAt, cell: (r) => <time dateTime={r.order.placedAt} title={formatWhen(r.order.placedAt)} className="whitespace-nowrap text-ink-2">{relDays(r.order.placedAt, now)}</time> },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (r) => r.totalUsd,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{usd(r.totalUsd)}</span>
          {/* The amount in the order's own currency, at every width: on a phone the table's only amount column carries it too. */}
          {r.order.currency !== "USD" ? <span className="block text-[11px] text-ink-3">{amountIn(r.order.total, r.order.currency)}</span> : null}
        </span>
      ),
    },
    { key: "pay", header: "Payment", hideBelow: "sm", sortValue: (r) => payMeta[r.pay].label, cell: (r) => <StatusBadge tone={payMeta[r.pay].tone}>{payMeta[r.pay].label}</StatusBadge> },
    { key: "fulfil", header: "Fulfilment", hideBelow: "md", sortValue: (r) => fulfilMeta[r.fulfil].label, cell: (r) => <StatusBadge tone={fulfilMeta[r.fulfil].tone}>{fulfilMeta[r.fulfil].label}</StatusBadge> },
  ]

  const orderActions: RowAction<OrderRow>[] = [
    { label: "Open order", icon: EyeIcon, onSelect: (r) => openOrder(r.order.id) },
    { label: "Copy order reference", icon: CopyIcon, separatorBefore: true, onSelect: (r) => copy(`#${r.order.reference}`, "Order reference") },
    { label: "Copy checkout reference", icon: CopyIcon, onSelect: (r) => copy(r.groupRef, "Checkout reference") },
    { label: "Refund in Finance", icon: ArrowCounterClockwiseIcon, separatorBefore: true, disabled: (r) => !r.refund, onSelect: (r) => r.refund && router.push(`/admin/finance?tab=refunds&focus=${r.refund.id}`) },
    { label: "Dispute in Finance", icon: GavelIcon, disabled: (r) => !r.dispute, onSelect: (r) => r.dispute && router.push(`/admin/finance?tab=disputes&focus=${r.dispute.id}`) },
  ]
  const bulkActions: BulkAction<OrderRow>[] = [{ label: "Export as CSV", onSelect: exportOrders }]

  const checkoutColumns: Column<CheckoutRow>[] = [
    {
      key: "ref",
      header: "Checkout",
      sortValue: (c) => c.ref,
      cell: (c) => (
        <button type="button" onClick={() => openOrder(c.orders[0].order.id)} className="group block max-w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="block font-medium whitespace-nowrap text-ink tabular group-hover:text-violet">{c.ref}</span>
          <span className="block max-w-[36vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">{c.orders.map((o) => o.brand.name).join(", ")}</span>
        </button>
      ),
    },
    { key: "customer", header: "Customer", hideBelow: "md", sortValue: (c) => c.customer, cell: (c) => <span className="whitespace-nowrap text-ink-2">{c.customer}</span> },
    { key: "placed", header: "Placed", hideBelow: "md", sortValue: (c) => c.placedAt, cell: (c) => <time dateTime={c.placedAt} title={formatWhen(c.placedAt)} className="whitespace-nowrap text-ink-2">{relDays(c.placedAt, now)}</time> },
    { key: "orders", header: "Brand orders", align: "right", hideBelow: "sm", sortValue: (c) => c.orders.length, cell: (c) => <span className="text-ink">{c.orders.length}</span> },
    { key: "total", header: "Total", align: "right", sortValue: (c) => c.totalUsd, cell: (c) => <span className="whitespace-nowrap text-ink">{usd(c.totalUsd)}</span> },
    {
      key: "state",
      header: "Status",
      hideBelow: "lg",
      cell: (c) => {
        const pending = c.orders.every((o) => o.pay === "pending")
        const failed = c.orders.every((o) => o.pay === "failed")
        const m = pending ? payMeta.pending : failed ? payMeta.failed : groupMeta[groupState(c.orders.map((o) => o.order))]
        return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
      },
    },
  ]
  const checkoutActions: RowAction<CheckoutRow>[] = checkoutActionsFor(openOrder)

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Orders"
        description="Every brand order on the marketplace, with the checkout it came from, how it was paid and where it is. Orders are records: refunds and corrections go through Finance."
        note="Orders from checkout stay Awaiting payment: no payments provider is connected in this build, so nothing is charged and nothing should ship."
      />

      <InPageLinks>
        <StatRow label="Order figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ShoppingCartIcon} label="Paid orders" value={recent.length} format={n} hint={`30 days, ${n(today)} today${awaiting ? `, ${n(awaiting)} awaiting payment` : ""}`} href="/admin/orders#orders" hrefLabel="Show all orders" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ChartLineUpIcon} label="GMV" value={gmv} format={usdCompact} hint="30 days of paid orders, in USD" href="/admin/finance" hrefLabel="Open transactions in Finance" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && unfulfilled ? "brand" : "default"} icon={PackageIcon} label="Unfulfilled" value={unfulfilled} format={n} hint="Paid, not yet processing" href="/admin/orders?status=unfulfilled#orders" hrefLabel="Show unfulfilled orders" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ArrowCounterClockwiseIcon} label="Refunds to decide" value={refundAsks} format={n} hint="In the Finance queue" href="/admin/finance?tab=refunds" hrefLabel="Open refunds in Finance" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="orders" title="All orders" description={view === "orders" ? `${n(filtered.length)} of ${n(rows.length)} brand orders, newest first. One checkout can create orders with several brands.` : `${n(checkouts.length)} checkouts. Each is one payment, split into an order per brand; totals in USD.`} className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={view}>
          <Segmented
            label="Show orders"
            size="sm"
            value={view}
            onChange={(v) => writeParams({ view: v === "orders" ? null : v })}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={[
              { value: "orders", label: "Brand orders" },
              { value: "checkouts", label: "Checkouts" },
            ]}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, view)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {(() => {
            const toolbar = (
              <Filters
                noun={view === "orders" ? "orders" : "checkouts"}
                results={view === "orders" ? filtered.length : checkouts.length}
                onClear={clear}
                filters={[
                  { key: "brand", label: "Brand", value: brand, onChange: (v) => setFilter("brand", v), all: { value: "all", label: "All brands" }, options: brands.map((b) => ({ value: b.id, label: b.name })), width: "w-[176px]" },
                  { key: "status", label: "Status", value: status, onChange: (v) => setFilter("status", v), all: { value: "all", label: "All statuses" }, groups: statusGroups, width: "w-[184px]" },
                ]}
              />
            )
            const empty = { title: "No orders match these filters", body: "Try another brand or status.", action: <Button size="sm" variant="secondary" onClick={clear}>Clear filters</Button> }
            return view === "orders" ? (
              <DataTable key="orders" label="Brand orders" rows={filtered} columns={orderColumns} getId={(r) => r.order.id} loading={!ready} search={{ placeholder: "Order, checkout, customer or email", text: (r) => r.search }} toolbar={toolbar} rowActions={orderActions} bulkActions={phone ? undefined : bulkActions} empty={empty} initialPageSize={25} minWidth={300} />
            ) : (
              <DataTable key="checkouts" label="Checkouts" rows={checkouts} columns={checkoutColumns} getId={(c) => c.id} loading={!ready} search={{ placeholder: "Checkout, order, customer or email", text: (c) => `${c.ref} ${c.search}` }} toolbar={toolbar} rowActions={checkoutActions} empty={empty} initialPageSize={25} minWidth={300} />
            )
          })()}
        </div>
      </Panel>

      <OrderDetail rows={rows} id={open ? orderId : null} open={open} onSelect={openOrder} onOpenChange={(o) => !o && writeParams({ order: null })} />
    </Reveal>
  )
}

function checkoutActionsFor(openOrder: (id: string) => void): RowAction<CheckoutRow>[] {
  return [
    { label: "Open checkout", icon: EyeIcon, onSelect: (c) => openOrder(c.orders[0].order.id) },
    { label: "Copy checkout reference", icon: CopyIcon, separatorBefore: true, onSelect: (c) => copy(c.ref, "Checkout reference") },
  ]
}

