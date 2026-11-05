"use client"

import { useMemo, useState } from "react"
import { MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { BrandMark } from "@/components/market/brand-mark"
import { brands } from "@/lib/data/brands"
import { formatNumber } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useOrders } from "@/lib/stores/orders"
import { buildOrderRows, type OrderRow } from "./derive"
import { DEMO_NOW, amountIn, formatDateTime, relDays, usd, usdCompact } from "./format"
import { fulfilMeta, payMeta, type FulfilState } from "./meta"
import { OrderDetail } from "./order-detail"
import { FilterSelect, Pagination, SearchField } from "../platform/table"
import { AdminTable, TablePanel, useSearchParam, writeParams, type Column } from "./table"

const PAGE_SIZE = 25
const DAY = 86_400_000

type StatusFilter = "all" | FulfilState | "refund_requested" | "refunded" | "failed" | "disputed"

const statusGroups = [
  { label: "Fulfilment", options: (["unfulfilled", "on_hold", "processing", "shipped", "delivered", "cancelled"] as const).map((v) => ({ value: v, label: fulfilMeta[v].label })) },
  {
    label: "Payment",
    options: [
      { value: "refund_requested", label: "Refund requested" },
      { value: "disputed", label: "Disputed or charged back" },
      { value: "refunded", label: "Refunded" },
      { value: "failed", label: "Charge failed" },
    ],
  },
]

function matchesStatus(r: OrderRow, f: StatusFilter) {
  if (f === "all") return true
  if (f === "refund_requested") return r.pay === "refund_requested" || r.pay === "refund_approved"
  if (f === "refunded") return r.pay === "refunded"
  if (f === "failed") return r.pay === "failed"
  if (f === "disputed") return r.pay === "disputed" || r.pay === "charged_back"
  return r.fulfil === f
}

const n = (v: number) => formatNumber(Math.round(v))

export function OrdersView() {
  const clientOrders = useOrders((s) => s.orders)
  const groups = useOrders((s) => s.groups)
  const refunds = useAdmin((s) => s.refunds)
  const [query, setQuery] = useState("")
  const [brand, setBrand] = useState("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [page, setPage] = useState(0)
  // The open order: what the admin picked, else the one a link named (/admin/orders?order=mo_…).
  const [picked, setPicked] = useState<{ id: string | null; open: boolean } | null>(null)
  const linkedId = useSearchParam("order")

  const rows = useMemo(() => buildOrderRows(clientOrders, groups, refunds), [clientOrders, groups, refunds])
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => rows.filter((r) => (brand === "all" || r.brand.id === brand) && matchesStatus(r, status) && (!q || r.search.includes(q))), [rows, brand, status, q])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const pageRows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  // Orders placed in this browser arrive with the store's rehydration, so a linked one opens once its row exists.
  const linked = !picked && linkedId && rows.some((r) => r.order.id === linkedId) ? linkedId : null
  const selected = picked ? picked.id : linked
  const open = picked ? picked.open : !!linked

  function openOrder(id: string) {
    setPicked({ id, open: true })
    writeParams({ order: id })
  }

  const recent = rows.filter((r) => new Date(r.order.placedAt).getTime() > DEMO_NOW - 30 * DAY)
  const today = rows.filter((r) => new Date(r.order.placedAt).getTime() > DEMO_NOW - DAY).length
  const gmv = recent.filter((r) => r.fulfil !== "cancelled").reduce((s, r) => s + r.totalUsd, 0)
  const unfulfilled = rows.filter((r) => r.fulfil === "unfulfilled").length
  const refundAsks = rows.filter((r) => r.refund?.status === "requested").length

  const reset = (fn: () => void) => {
    fn()
    setPage(0)
  }

  const columns: Column<OrderRow>[] = [
    { key: "ref", header: "Order", primary: true, cell: (r) => <span className="font-medium whitespace-nowrap text-ink tabular">#{r.order.reference}</span> },
    {
      key: "group",
      header: "Checkout",
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
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <BrandMark brand={r.brand} size="xs" />
          <span className="truncate whitespace-nowrap text-ink">{r.brand.name}</span>
        </span>
      ),
    },
    { key: "customer", header: "Customer", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.customer.name}</span> },
    { key: "placed", header: "Placed", cell: (r) => <time dateTime={r.order.placedAt} title={formatDateTime(r.order.placedAt)} className="whitespace-nowrap text-ink-2">{relDays(r.order.placedAt)}</time> },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{usd(r.totalUsd)}</span>
          {r.order.currency !== "USD" ? <span className="block text-[11px] text-ink-3">{amountIn(r.order.total, r.order.currency)}</span> : null}
        </span>
      ),
    },
    { key: "pay", header: "Payment", cell: (r) => <StatusBadge tone={payMeta[r.pay].tone}>{payMeta[r.pay].label}</StatusBadge> },
    { key: "fulfil", header: "Fulfilment", cell: (r) => <StatusBadge tone={fulfilMeta[r.fulfil].tone}>{fulfilMeta[r.fulfil].label}</StatusBadge> },
  ]

  const filtersOn = brand !== "all" || status !== "all" || !!q

  return (
    <div className="grid gap-5">
      <PageHeader title="Orders" description="Every brand order on the marketplace, with the checkout it came from, how it was paid and where it is. Orders are records: refunds and corrections go through Finance.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Order figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Orders, 30 days" value={recent.length} format={n} hint={`${n(today)} today`} />
        <MetricTile density="dense" label="GMV, 30 days" value={gmv} format={usdCompact} hint="converted to USD" />
        <MetricTile density="dense" label="Unfulfilled" value={unfulfilled} format={n} hint="paid, not yet processing" highlight={unfulfilled > 0} />
        <MetricTile density="dense" label="Refunds to decide" value={refundAsks} format={n} hint="in the Finance queue" highlight={refundAsks > 0} />
      </section>

      <TablePanel
        id="orders-title"
        title="All brand orders"
        description={`${n(filtered.length)} of ${n(rows.length)} orders, newest first. One checkout can create orders with several brands.`}
        toolbar={
          <>
            <SearchField value={query} onChange={(v) => reset(() => setQuery(v))} label="Search orders" placeholder="Order, checkout, customer" />
            <FilterSelect
              label="Filter by brand"
              value={brand}
              onChange={(v) => reset(() => setBrand(v))}
              options={[{ value: "all", label: "All brands" }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
              className="w-auto min-w-0 flex-1 md:w-[168px] md:flex-none"
            />
            <FilterSelect
              label="Filter by status"
              value={status}
              onChange={(v) => reset(() => setStatus(v as StatusFilter))}
              options={[{ value: "all", label: "All statuses" }]}
              groups={statusGroups}
              className="w-auto min-w-0 flex-1 md:w-[168px] md:flex-none"
            />
          </>
        }
      >
        {pageRows.length ? (
          <>
            <AdminTable
              rows={pageRows}
              columns={columns}
              rowKey={(r) => r.order.id}
              onOpen={(r) => openOrder(r.order.id)}
              openLabel={(r) => `Open order ${r.order.reference}`}
              selectedKey={open ? selected : null}
              caption="Brand orders"
              minWidth={980}
              mobileRow={(r) => {
                const badge = r.pay !== "paid" ? payMeta[r.pay] : fulfilMeta[r.fulfil]
                return {
                  lead: <BrandMark brand={r.brand} size="sm" />,
                  title: (
                    <>
                      <span className="tabular">#{r.order.reference}</span> <span className="text-ink-2">{r.brand.name}</span>
                    </>
                  ),
                  meta: `${r.customer.name}, ${relDays(r.order.placedAt).toLowerCase()}${r.groupSize > 1 ? `, ${r.groupSize} brands in checkout` : ""}`,
                  trail: (
                    <>
                      <span className="text-[13px] text-ink tabular">{usd(r.totalUsd)}</span>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </>
                  ),
                }
              }}
            />
            <Pagination page={current} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} noun="orders" />
          </>
        ) : (
          <EmptyState
            icon={SearchX}
            className="m-4"
            title="No orders match"
            body={q ? `Nothing matches “${query.trim()}” with these filters. Search by order reference, checkout reference, customer name or email.` : "No orders have this brand and status. Try another status."}
            action={
              filtersOn ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    reset(() => {
                      setQuery("")
                      setBrand("all")
                      setStatus("all")
                    })
                  }
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        )}
      </TablePanel>

      <OrderDetail
        rows={rows}
        id={selected}
        open={open}
        onSelect={openOrder}
        onOpenChange={(o) => {
          setPicked({ id: selected, open: o })
          if (!o) writeParams({ order: null })
        }}
      />
    </div>
  )
}
