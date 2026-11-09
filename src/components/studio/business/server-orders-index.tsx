"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { ApiError, api } from "@/lib/api/client"
import type { OrderSummaryDto, OrdersPageDto } from "@/lib/api/contracts/orders"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { formatMoney } from "@/lib/money"
import type { MerchantOrderStatus } from "@/lib/data/types"
import { emptyOrderTab, orderTabs, plural, type OrderTab } from "./model"
import { useStudioReady } from "./shared"

function statusOf(status: string): MerchantOrderStatus {
  const values: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
  return values.includes(status as MerchantOrderStatus) ? status as MerchantOrderStatus : "pending_payment"
}

function paymentLabel(status: string) {
  if (status === "paid" || status === "partially_refunded") return status === "paid" ? "Paid" : "Partly refunded"
  if (status === "refunded") return "Refunded"
  if (status === "failed") return "Failed"
  return "Awaiting payment"
}

export function ServerOrdersIndex({ brandId, brandName, canFulfil }: { brandId: string; brandName: string; canFulfil: boolean }) {
  const ready = useStudioReady()
  const [olderItems, setOlderItems] = useState<OrderSummaryDto[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [tab, setTab] = useState<OrderTab>("paid")
  const [busyId, setBusyId] = useState<string | null>(null)
  const member = useServerSession((state) => state.brand)
  const ordersPage = useApi(brandId ? `studio.orders:${brandId}` : null, () => api<OrdersPageDto>("/api/studio/orders", { query: { limit: 50 } }), { revalidateOnFocus: true, keepPrevious: false })
  const items = useMemo(() => [...(ordersPage.data?.items ?? []), ...olderItems], [ordersPage.data?.items, olderItems])
  const nextCursor = olderCursor === undefined ? ordersPage.data?.nextCursor ?? null : olderCursor
  const loading = ordersPage.isLoading
  const error = ordersPage.error instanceof ApiError ? ordersPage.error.message : ordersPage.error ? "Couldn't load this brand's orders." : null

  async function loadOlder() {
    if (!nextCursor || loading) return
    try {
      const page = await api<OrdersPageDto>("/api/studio/orders", { query: { limit: 50, before: nextCursor } })
      setOlderItems((current) => [...current, ...page.items])
      setOlderCursor(page.nextCursor)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Couldn't load older orders.")
    }
  }

  const counts = useMemo(() => {
    const result = Object.fromEntries(orderTabs.map((entry) => [entry.value, 0])) as Record<OrderTab, number>
    for (const item of items) {
      const status = statusOf(item.states.merchant)
      result.all += 1
      if (status in result) result[status as OrderTab] += 1
    }
    return result
  }, [items])
  const rows = useMemo(() => items.filter((item) => tab === "all" || item.states.merchant === tab), [items, tab])
  const tabs = orderTabs.filter((entry) => entry.value === tab || entry.value === "all" || counts[entry.value] > 0)

  async function startProcessing(order: OrderSummaryDto) {
    if (!canFulfil || busyId) return
    setBusyId(order.id)
    try {
      await api(`/api/studio/orders/${encodeURIComponent(order.id)}/processing`, { method: "POST" })
      await ordersPage.revalidate()
      toast.success(`#${order.reference} moved to processing`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Couldn't update this order.")
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<OrderSummaryDto>[] = [
    {
      key: "order",
      header: "Order",
      sortValue: (order) => order.reference,
      cell: (order) => <Link href={`/studio/orders/${encodeURIComponent(order.id)}`} className="font-medium text-ink hover:text-violet">#{order.reference}</Link>,
    },
    { key: "placed", header: "Placed", hideBelow: "md", sortValue: (order) => order.placedAt, cell: (order) => <span className="text-ink-2">{new Date(order.placedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span> },
    {
      key: "customer",
      header: "Customer",
      hideBelow: "md",
      sortValue: (order) => order.customerName,
      cell: (order) => <><span className="block text-ink">{order.customerName}</span><span className="block text-xs text-ink-3">{order.shipToPreview.city ? `${order.shipToPreview.city}, ` : ""}{order.shipToPreview.country}</span></>,
    },
    {
      key: "items",
      header: "Items",
      hideBelow: "lg",
      sortValue: (order) => order.itemCount,
      cell: (order) => <><span className="block text-ink-2">{plural(order.itemCount, "item")}</span><span className="block max-w-48 truncate text-xs text-ink-3">{order.previewItems[0]?.name ?? "Order items"}</span></>,
    },
    { key: "total", header: "Total", align: "right", hideBelow: "md", sortValue: (order) => order.totalMinor, cell: (order) => <span className="whitespace-nowrap text-ink">{formatMoney(order.totalMinor, order.currency as Parameters<typeof formatMoney>[1])}</span> },
    { key: "payment", header: "Payment", hideBelow: "md", sortValue: (order) => paymentLabel(order.states.payment), cell: (order) => <span className="text-ink-2">{paymentLabel(order.states.payment)}</span> },
    { key: "fulfilment", header: "Fulfilment", hideBelow: "md", sortValue: (order) => orderStatusMeta[statusOf(order.states.merchant)].label, cell: (order) => { const meta = orderStatusMeta[statusOf(order.states.merchant)]; return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge> } },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader title="Orders" description={`Orders for ${brandName}, loaded from Yard.`} actions={<Button size="sm" variant="secondary" onClick={() => { setOlderItems([]); setOlderCursor(undefined); void ordersPage.revalidate() }} disabled={loading}>Refresh</Button>} />
      {error ? <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}
      {!loading && !items.length ? <EmptyState title="No orders yet" body="Orders placed with this brand will appear here." /> : (
        <div className="grid gap-4">
          <StatusTabs id="server-order-status" label="Order status" value={tab} onChange={setTab} controls="server-order-list" tabs={tabs.map((entry) => ({ ...entry, count: ready ? counts[entry.value] : undefined }))} />
          <DataTable
            label="Brand orders"
            rows={rows}
            columns={columns}
            getId={(order) => order.id}
            loading={loading}
            search={{ placeholder: "Search by order number or customer", text: (order) => `${order.reference} ${order.customerName} ${order.previewItems.map((item) => item.name).join(" ")}` }}
            rowActions={[{ label: "Mark as processing", onSelect: (order) => void startProcessing(order), disabled: (order) => !canFulfil || order.states.merchant !== "paid" || busyId === order.id }]}
            toolbar={<span className="ml-auto text-xs text-ink-3">{member?.brand.id === brandId ? "Live server orders" : ""}</span>}
            initialPageSize={25}
            pageSizes={[25, 50]}
            empty={{ title: emptyOrderTab[tab].title, body: emptyOrderTab[tab].body, action: tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all orders</Button> : undefined }}
          />
          {nextCursor ? <Button variant="secondary" className="justify-self-start" onClick={() => void loadOlder()} disabled={loading}>Load older orders</Button> : null}
        </div>
      )}
    </div>
  )
}
