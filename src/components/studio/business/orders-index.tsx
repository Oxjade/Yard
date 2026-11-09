"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon as Open, CopyIcon as Copy, DownloadSimpleIcon as Download, SealCheckIcon as PackageCheck, ShoppingCartIcon as ShoppingCart, TruckIcon as Truck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { Button } from "@/components/ui/button"
import { brandById } from "@/lib/data/brands"
import type { MerchantOrder } from "@/lib/data/types"
import { formatMoney, toMajor } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { conditionalOrderTabs, ordersDescription, countryName, emptyOrderTab, formatDateTime, itemCount, orderMatchesTab, orderTabs, paymentView, plural, relativeDay, shopperName, type OrderTab } from "./model"
import { TrackingDialog } from "./order-dialogs"
import { useShipmentQueue } from "@/components/studio/shipping/shipment-sync"
import { useServerSession } from "@/lib/session/use-server-session"
import { PhoneSort, phoneCell, useStudioReady } from "./shared"
import { ServerOrdersIndex } from "./server-orders-index"

/** "Today" and "3 days ago" read lower case mid-sentence; dates keep their capital month. */
const lowerRelative = (s: string) => (/^(Today|Yesterday|\d+ days ago)$/.test(s) ? s.toLowerCase() : s)

function toCsv(rows: MerchantOrder[], currency: string) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ["Order", "Placed", "Customer", "Items", `Total (${currency})`, "Payment", "Fulfilment", "Ship to", "Shipping method", "Carrier", "Tracking"]
  const lines = rows.map((o) =>
    [
      o.reference,
      o.placedAt.slice(0, 10),
      shopperName(o.customerId),
      itemCount(o),
      toMajor(o.total, o.currency),
      paymentView(o).label,
      orderStatusMeta[o.status].label,
      `${o.shippingAddress.city}, ${countryName(o.shippingAddress.country)}`,
      o.shippingMethod.replace(" — ", ", "),
      o.tracking?.carrier ?? "",
      o.tracking?.number ?? "",
    ]
      .map(esc)
      .join(","),
  )
  return [header.join(","), ...lines].join("\n")
}

export function OrdersIndex() {
  const brand = useServerSession((state) => state.brand)
  if (brand && !brand.demo) {
    return <ServerOrdersIndex key={brand.brand.id} brandId={brand.brand.id} brandName={brand.brand.name} canFulfil={brand.permissions.includes("orders.fulfil")} />
  }
  return <DemoOrdersIndex />
}

function DemoOrdersIndex() {
  const ready = useStudioReady()
  const router = useRouter()
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const brand = brandById.get(brandId)!
  // Shipment events saved while signed out or offline go to Yard's server once a brand session is back.
  useShipmentQueue()
  const cur = brand.currency

  const [tab, setTab] = useState<OrderTab>("paid")
  // The order stays set while the dialog animates closed.
  const [sort, setSort] = useState<"newest" | "oldest" | "total">("newest")
  const [tracking, setTracking] = useState<{ order: MerchantOrder; open: boolean } | null>(null)

  const counts = useMemo(() => {
    const c = Object.fromEntries(orderTabs.map((t) => [t.value, 0])) as Record<OrderTab, number>
    for (const o of orders) {
      c.all += 1
      if (o.status in c) c[o.status as OrderTab] += 1
    }
    return c
  }, [orders])

  // Rows arrive sorted by the phone sort menu (newest first by default); the column headers re-sort on wider screens.
  const rows = useMemo(
    () => orders.filter((o) => orderMatchesTab(o, tab)).sort((a, b) => (sort === "total" ? b.total - a.total : sort === "oldest" ? a.placedAt.localeCompare(b.placedAt) : b.placedAt.localeCompare(a.placedAt))),
    [orders, tab, sort],
  )
  const tabs = orderTabs.filter((t) => !conditionalOrderTabs.has(t.value) || t.value === tab || (ready && counts[t.value] > 0))
  const awaiting = ready ? counts.pending_payment : 0

  function moveToProcessing(list: MerchantOrder[]) {
    const ids = list.filter((o) => o.status === "paid").map((o) => o.id)
    const skipped = list.length - ids.length
    if (!ids.length) {
      toast.info("Nothing moved", { description: "Only orders in To fulfil can move to processing." })
      return
    }
    for (const id of ids) setOrderStatus(id, "processing", "Brand started processing")
    toast.success(`${plural(ids.length, "order")} moved to processing`, {
      description: skipped ? `${plural(skipped, "order")} skipped: only orders in To fulfil can move.` : "Add tracking to each one when it ships.",
      action: {
        label: "Undo",
        onClick: () => {
          for (const id of ids) useStudio.getState().setOrderStatus(id, "paid", "Moved back to To fulfil")
        },
      },
    })
  }

  function download(list: MerchantOrder[], name: string) {
    if (!list.length) {
      toast.info("Nothing to export", { description: "This view has no orders." })
      return
    }
    try {
      const blob = new Blob([toCsv(list, cur)], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${brand.handle}-orders-${name}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${plural(list.length, "order")}`, { description: "Fulfilment details only. Customer emails stay with the platform." })
    } catch {
      toast.error("The file couldn't be created", { description: "Try again. If it keeps failing, try another browser." })
    }
  }

  async function copyReference(o: MerchantOrder) {
    try {
      await navigator.clipboard.writeText(o.reference)
      toast.success(`Copied #${o.reference}`)
    } catch {
      toast.error("Couldn't copy", { description: "Open the order and select the number to copy it." })
    }
  }

  const columns: Column<MerchantOrder>[] = [
    {
      key: "order",
      header: "Order",
      sortValue: (o) => o.reference,
      cell: (o) => {
        const status = orderStatusMeta[o.status]
        return (
          <div className={cn(phoneCell, "relative")}>
            <div className="flex items-baseline justify-between gap-3">
              {/* Phones: the link's hit area covers the whole first cell, never the checkbox or the row menu. */}
              <Link href={`/studio/orders/${o.id}`} className="rounded-sm font-medium whitespace-nowrap text-ink tabular outline-none after:absolute after:-inset-y-2 after:inset-x-0 hover:text-violet focus-visible:ring-2 focus-visible:ring-violet md:after:hidden">
                #{o.reference}
              </Link>
              <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{formatMoney(o.total, cur)}</span>
            </div>
            {/* Phones: the hidden columns fold into the first cell. */}
            <span className="mt-0.5 block truncate text-xs text-ink-2 md:hidden">
              {shopperName(o.customerId)}, {plural(itemCount(o), "item")}, {lowerRelative(relativeDay(o.placedAt))}
            </span>
            <span className="mt-1.5 flex flex-wrap gap-1.5 md:hidden">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </span>
          </div>
        )
      },
    },
    { key: "placed", header: "Placed", sortValue: (o) => o.placedAt, hideBelow: "md", cell: (o) => <span className="whitespace-nowrap text-ink-2" title={`${formatDateTime(o.placedAt)} UTC`}>{relativeDay(o.placedAt)}</span> },
    {
      key: "customer",
      header: "Customer",
      sortValue: (o) => shopperName(o.customerId),
      hideBelow: "md",
      cell: (o) => (
        <>
          <span className="block whitespace-nowrap text-ink">{shopperName(o.customerId)}</span>
          <span className="block text-xs whitespace-nowrap text-ink-3">{o.shippingAddress.city}, {countryName(o.shippingAddress.country)}</span>
        </>
      ),
    },
    {
      key: "items",
      header: "Items",
      sortValue: (o) => itemCount(o),
      hideBelow: "lg",
      className: "max-w-[220px]",
      cell: (o) => (
        <>
          <span className="block text-ink-2 tabular">{plural(itemCount(o), "item")}</span>
          <span className="block truncate text-xs text-ink-3">{o.lines[0]?.name}{o.lines.length > 1 ? ` and ${o.lines.length - 1} more` : ""}</span>
        </>
      ),
    },
    { key: "total", header: "Total", align: "right", sortValue: (o) => o.total, hideBelow: "md", cell: (o) => <span className="whitespace-nowrap text-ink">{formatMoney(o.total, cur)}</span> },
    { key: "payment", header: "Payment", sortValue: (o) => paymentView(o).label, hideBelow: "md", cell: (o) => { const pay = paymentView(o); return <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge> } },
    { key: "fulfilment", header: "Fulfilment", sortValue: (o) => orderStatusMeta[o.status].label, hideBelow: "md", cell: (o) => { const st = orderStatusMeta[o.status]; return <StatusBadge tone={st.tone}>{st.label}</StatusBadge> } },
  ]

  const rowActions: RowAction<MerchantOrder>[] = [
    { label: "Open order", icon: Open, onSelect: (o) => router.push(`/studio/orders/${o.id}`) },
    { label: "Mark as processing", icon: PackageCheck, onSelect: (o) => moveToProcessing([o]), disabled: (o) => o.status !== "paid", separatorBefore: true },
    { label: "Add tracking", icon: Truck, onSelect: (o) => setTracking({ order: o, open: true }), disabled: (o) => o.status !== "paid" && o.status !== "processing" },
    { label: "Copy order number", icon: Copy, onSelect: copyReference, separatorBefore: true },
  ]

  const bulkActions: BulkAction<MerchantOrder>[] = [
    { label: "Mark as processing", onSelect: moveToProcessing },
    { label: "Export selected", onSelect: (list) => download(list, "selected") },
  ]

  const tabLabel = orderTabs.find((t) => t.value === tab)!.label

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Orders"
        description={ordersDescription(brand.name)}
        actions={
          <Button size="sm" variant="secondary" onClick={() => download(rows, tabLabel.toLowerCase().replace(/\s+/g, "-"))} disabled={!ready}>
            <Download /> Export CSV
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {ready && orders.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No orders yet" body="When a customer orders one of your products, it appears here, ready to fulfil once it's paid." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/products">Go to products</Link></Button>} />
      ) : (
        <div className="grid gap-4">
          <StatusTabs id="order-status" label="Order status" value={tab} onChange={setTab} controls="order-list" tabs={tabs.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />

          <section id="order-list" aria-label={`Orders, ${tabLabel}`} tabIndex={-1} className="outline-none">
            <DataTable
              label={`Orders, ${tabLabel}`}
              rows={ready ? rows : []}
              loading={!ready}
              columns={columns}
              getId={(o) => o.id}
              search={{ placeholder: "Search by order number or customer", text: (o) => `${o.reference} #${o.reference} ${shopperName(o.customerId)} ${o.shippingAddress.city}` }}
              rowActions={rowActions}
              bulkActions={bulkActions}
              toolbar={<PhoneSort value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "total", label: "Highest total" }]} className="ml-auto" />}
              initialPageSize={25}
              pageSizes={[25, 50, 100]}
              minWidth={300}
              empty={{
                title: emptyOrderTab[tab].title,
                body: emptyOrderTab[tab].body,
                action: tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all orders</Button> : undefined,
              }}
            />
          </section>

          <div className="grid gap-1 text-xs text-ink-3">
            {awaiting ? <p>No payment provider is connected in this development build, so orders placed at checkout stay in Awaiting payment. Don&apos;t ship them.</p> : null}
            <p>Only {brand.name}&apos;s orders are shown here. In the backend phase the server enforces this on every request, so no brand can read another brand&apos;s orders.</p>
          </div>
        </div>
      )}

      {tracking ? <TrackingDialog open={tracking.open} onOpenChange={(v) => setTracking((t) => (t ? { ...t, open: v } : t))} order={tracking.order} brand={brand} /> : null}
    </div>
  )
}
