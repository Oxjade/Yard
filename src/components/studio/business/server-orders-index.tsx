"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon as Open, CopyIcon as Copy, DownloadSimpleIcon as Download, SealCheckIcon as PackageCheck, ShoppingCartIcon as ShoppingCart } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { ApiError, api } from "@/lib/api/client"
import type { OrderSummaryDto, OrdersPageDto } from "@/lib/api/contracts/orders"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, toMajor } from "@/lib/money"
import type { CurrencyCode } from "@/config/markets"
import type { MerchantOrderStatus } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { countryName, emptyOrderTab, formatDateTime, orderTabs, ordersDescription, plural, relativeDay, type OrderTab } from "./model"
import { PhoneSort, phoneCell } from "./shared"

function statusOf(status: string): MerchantOrderStatus {
  const values: MerchantOrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refund_requested", "refunded"]
  return values.includes(status as MerchantOrderStatus) ? status as MerchantOrderStatus : "pending_payment"
}

/** "Today" and "3 days ago" read lower case mid-sentence; dates keep their capital month. */
const lowerRelative = (s: string) => (/^(Today|Yesterday|\d+ days ago)$/.test(s) ? s.toLowerCase() : s)

const money = (order: OrderSummaryDto, minor: number) => formatMoney(minor, order.currency as CurrencyCode)

function toCsv(rows: OrderSummaryDto[]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ["Order", "Placed", "Customer", "Items", "Currency", "Total", "Payment", "Fulfilment", "Ship to", "Shipping service"]
  const lines = rows.map((o) =>
    [o.reference, o.placedAt.slice(0, 10), o.customerName, o.itemCount, o.currency, toMajor(o.totalMinor, o.currency as CurrencyCode), paymentLabel(o.states.payment), orderStatusMeta[statusOf(o.states.merchant)].label, [o.shipToPreview.city, countryName(o.shipToPreview.country)].filter(Boolean).join(", "), o.service]
      .map(esc)
      .join(","),
  )
  return [header.join(","), ...lines].join("\n")
}

function paymentLabel(status: string) {
  if (status === "paid" || status === "partially_refunded") return status === "paid" ? "Paid" : "Partly refunded"
  if (status === "refunded") return "Refunded"
  if (status === "failed") return "Failed"
  return "Awaiting payment"
}

export function ServerOrdersIndex({ brandId, brandName, brandHandle, canFulfil }: { brandId: string; brandName: string; brandHandle: string; canFulfil: boolean }) {
  const router = useRouter()
  const [olderItems, setOlderItems] = useState<OrderSummaryDto[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [tab, setTab] = useState<OrderTab>("paid")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sort, setSort] = useState<"newest" | "oldest" | "total">("newest")
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
  // Rows arrive sorted by the phone sort menu (newest first by default); the column headers re-sort on wider screens.
  const rows = useMemo(
    () => items.filter((item) => tab === "all" || item.states.merchant === tab).sort((a, b) => (sort === "total" ? b.totalMinor - a.totalMinor : sort === "oldest" ? a.placedAt.localeCompare(b.placedAt) : b.placedAt.localeCompare(a.placedAt))),
    [items, tab, sort],
  )
  const tabLabel = orderTabs.find((entry) => entry.value === tab)!.label
  const ready = !loading && !error
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

  function download(list: OrderSummaryDto[], name: string) {
    if (!list.length) {
      toast.info("Nothing to export", { description: "This view has no orders." })
      return
    }
    try {
      const blob = new Blob([toCsv(list)], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${brandHandle || "brand"}-orders-${name}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${plural(list.length, "order")}`, { description: "Fulfilment details only. Customer emails stay with the platform." })
    } catch {
      toast.error("The file couldn't be created", { description: "Try again. If it keeps failing, try another browser." })
    }
  }

  async function copyReference(order: OrderSummaryDto) {
    try {
      await navigator.clipboard.writeText(order.reference)
      toast.success(`Copied #${order.reference}`)
    } catch {
      toast.error("Couldn't copy", { description: "Open the order and select the number to copy it." })
    }
  }

  function retry() {
    setOlderItems([])
    setOlderCursor(undefined)
    void ordersPage.revalidate()
  }

  const href = (order: OrderSummaryDto) => `/studio/orders/${encodeURIComponent(order.id)}`

  const columns: Column<OrderSummaryDto>[] = [
    {
      key: "order",
      header: "Order",
      sortValue: (order) => order.reference,
      cell: (order) => {
        const meta = orderStatusMeta[statusOf(order.states.merchant)]
        return (
          <div className={cn(phoneCell, "relative")}>
            <div className="flex items-baseline justify-between gap-3">
              {/* Phones: the link's hit area covers the whole first cell, never the row menu. */}
              <Link href={href(order)} className="rounded-sm font-medium whitespace-nowrap text-ink tabular outline-none after:absolute after:-inset-y-2 after:inset-x-0 hover:text-violet focus-visible:ring-2 focus-visible:ring-violet md:after:hidden">
                #{order.reference}
              </Link>
              <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{money(order, order.totalMinor)}</span>
            </div>
            {/* Phones: the hidden columns fold into the first cell. */}
            <span className="mt-0.5 block truncate text-xs text-ink-2 md:hidden">
              {order.customerName}, {plural(order.itemCount, "item")}, {lowerRelative(relativeDay(order.placedAt, Date.now()))}
            </span>
            <span className="mt-1.5 flex flex-wrap gap-1.5 md:hidden">
              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            </span>
          </div>
        )
      },
    },
    { key: "placed", header: "Placed", hideBelow: "md", sortValue: (order) => order.placedAt, cell: (order) => <span className="whitespace-nowrap text-ink-2" title={`${formatDateTime(order.placedAt)} UTC`}>{relativeDay(order.placedAt, Date.now())}</span> },
    {
      key: "customer",
      header: "Customer",
      hideBelow: "md",
      sortValue: (order) => order.customerName,
      cell: (order) => <><span className="block text-ink">{order.customerName}</span><span className="block text-xs text-ink-3">{order.shipToPreview.city ? `${order.shipToPreview.city}, ` : ""}{countryName(order.shipToPreview.country)}</span></>,
    },
    {
      key: "items",
      header: "Items",
      hideBelow: "lg",
      sortValue: (order) => order.itemCount,
      cell: (order) => <><span className="block text-ink-2">{plural(order.itemCount, "item")}</span><span className="block max-w-48 truncate text-xs text-ink-3">{order.previewItems[0]?.name ?? "Order items"}</span></>,
    },
    { key: "total", header: "Total", align: "right", hideBelow: "md", sortValue: (order) => order.totalMinor, cell: (order) => <span className="whitespace-nowrap text-ink">{money(order, order.totalMinor)}</span> },
    { key: "payment", header: "Payment", hideBelow: "md", sortValue: (order) => paymentLabel(order.states.payment), cell: (order) => <span className="text-ink-2">{paymentLabel(order.states.payment)}</span> },
    { key: "fulfilment", header: "Fulfilment", hideBelow: "md", sortValue: (order) => orderStatusMeta[statusOf(order.states.merchant)].label, cell: (order) => { const meta = orderStatusMeta[statusOf(order.states.merchant)]; return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge> } },
  ]

  const rowActions: RowAction<OrderSummaryDto>[] = [
    { label: "Open order", icon: Open, onSelect: (order) => router.push(href(order)) },
    { label: "Mark as processing", icon: PackageCheck, onSelect: (order) => void startProcessing(order), disabled: (order) => !canFulfil || order.states.merchant !== "paid" || busyId === order.id, separatorBefore: true },
    { label: "Copy order number", icon: Copy, onSelect: copyReference, separatorBefore: true },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Orders"
        description={ordersDescription(brandName)}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={retry} disabled={loading}>Refresh</Button>
            <Button size="sm" variant="secondary" onClick={() => download(rows, tabLabel.toLowerCase().replace(/\s+/g, "-"))} disabled={!ready}>
              <Download /> Export CSV
            </Button>
          </>
        }
      />
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={retry} loading={ordersPage.isValidating}>Retry</Button>
        </div>
      ) : null}
      {error && !items.length ? null : !loading && !items.length ? (
        <EmptyState icon={ShoppingCart} title="No orders yet" body="When a customer orders one of your products, it appears here, ready to fulfil once it's paid." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/products">Go to products</Link></Button>} />
      ) : (
        <div className="grid gap-4">
          <StatusTabs id="server-order-status" label="Order status" value={tab} onChange={setTab} controls="server-order-list" tabs={tabs.map((entry) => ({ ...entry, count: loading ? undefined : counts[entry.value] }))} />
          {nextCursor && !loading ? <p className="-mt-2 text-xs text-ink-3">Counts cover the {plural(items.length, "most recent order")} loaded. Load older orders to count the rest.</p> : null}
          <section id="server-order-list" aria-label={`Orders, ${tabLabel}`} tabIndex={-1} className="outline-none">
            <DataTable
              label={`Orders, ${tabLabel}`}
              rows={rows}
              columns={columns}
              getId={(order) => order.id}
              loading={loading}
              search={{ placeholder: "Search by order number or customer", text: (order) => `${order.reference} #${order.reference} ${order.customerName} ${order.shipToPreview.city ?? ""} ${order.previewItems.map((item) => item.name).join(" ")}` }}
              rowActions={rowActions}
              toolbar={<PhoneSort value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "total", label: "Highest total" }]} className="ml-auto" />}
              initialPageSize={25}
              pageSizes={[25, 50]}
              minWidth={300}
              empty={{ title: emptyOrderTab[tab].title, body: emptyOrderTab[tab].body, action: tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all orders</Button> : undefined }}
            />
          </section>
          {nextCursor ? <Button variant="secondary" className="justify-self-start" onClick={() => void loadOlder()} disabled={loading}>Load older orders</Button> : null}
        </div>
      )}
    </div>
  )
}
