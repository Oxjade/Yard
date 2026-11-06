"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ArrowSquareOutIcon as Open, CaretRightIcon as ChevronRight, ClockCounterClockwiseIcon as History, LockIcon as Lock, UsersIcon as Users } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { showInPlace, useSearchParam } from "@/hooks/use-search-param"
import { brandById } from "@/lib/data/brands"
import type { CurrencyCode } from "@/config/markets"
import { formatMoney, toMajor } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { buildCustomers, countryName, customersDescription, formatDateYear, itemCount, plural, relativeDay, segmentMeta, vipThreshold, type BrandCustomer, type Segment } from "./model"
import { Thumb } from "@/components/studio/catalog/parts"
import { Initials, PhoneSort, phoneCell, useFocusReturn, useStudioReady } from "./shared"

type Tab = "all" | Segment
type Sort = "recent" | "spent" | "orders"

const sortOptions: { value: Sort; label: string }[] = [
  { value: "recent", label: "Last order" },
  { value: "spent", label: "Total spent" },
  { value: "orders", label: "Most orders" },
]

const tabs: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "repeat", label: "Repeat" },
  { value: "vip", label: "VIP" },
]

export function CustomersIndex() {
  const ready = useStudioReady()
  const router = useRouter()
  const pathname = usePathname()
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const brand = brandById.get(brandId)!
  const cur = brand.currency

  const [tab, setTab] = useState<Tab>("all")
  // ?customer=<id> opens that customer: on arrival, and again whenever the parameter changes
  // while the page is open (the search palette applies it in place and notifies this reader,
  // the same URL reader the Control Center's records use).
  const linked = useSearchParam("customer")
  const [openId, setOpenId] = useState<string | null>(linked)
  const [seenLinked, setSeenLinked] = useState(linked)
  if (linked !== seenLinked) {
    setSeenLinked(linked)
    if (linked) setOpenId(linked)
  }
  const [sort, setSort] = useState<Sort>("recent")

  // Derived from the brand's orders on every render; the React compiler memoizes it.
  const customers = buildCustomers(orders, cur)
  const counts: Record<Tab, number> = { all: customers.length, new: 0, repeat: 0, vip: 0 }
  for (const x of customers) counts[x.segment] += 1
  // Rows arrive sorted by the phone sort menu (most recent first by default); the column headers re-sort on wider screens.
  const rows = customers
    .filter((c) => tab === "all" || c.segment === tab)
    .sort((a, b) => (sort === "spent" ? b.spent - a.spent : sort === "orders" ? b.orderCount - a.orderCount || b.spent - a.spent : b.lastOrderAt.localeCompare(a.lastOrderAt)))
  const open = ready ? customers.find((c) => c.id === openId) ?? null : null

  function close() {
    setOpenId(null)
    // Drops ?customer= in place (Next's router follows), so the same link opens it again later.
    if (linked) showInPlace(pathname)
  }

  function exportRows(list: BrandCustomer[]) {
    const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = [["Customer", "City", "Country", "Orders", `Spent (${cur})`, "First order", "Last order", "Segment"].join(","), ...list.map((c) => [c.name, c.city, countryName(c.country), c.orderCount, toMajor(c.spent, cur), c.firstOrderAt.slice(0, 10), c.lastOrderAt.slice(0, 10), segmentMeta[c.segment].label].map(esc).join(","))].join("\n")
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `${brand.handle}-customers.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${plural(list.length, "customer")}`, { description: "Names, locations and order totals. Contact details stay with the platform." })
    } catch {
      toast.error("The file couldn't be created", { description: "Try again. If it keeps failing, try another browser." })
    }
  }

  const columns: Column<BrandCustomer>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <Initials name={c.name} className="hidden md:inline-flex" />
          <span className={cn(phoneCell, "relative")}>
            <span className="flex items-baseline justify-between gap-3">
              {/* Phones: the button's hit area covers the whole first cell, never the checkbox or the row menu. */}
              <button type="button" data-customer={c.id} onClick={() => setOpenId(c.id)} className="min-w-0 truncate rounded-sm text-left font-medium whitespace-nowrap text-ink outline-none after:absolute after:-inset-y-2 after:inset-x-0 hover:text-violet focus-visible:ring-2 focus-visible:ring-violet md:after:hidden">
                {c.name}
              </button>
              <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{formatMoney(c.spent, cur)}</span>
            </span>
            {/* Phones: the hidden columns fold into the first cell. */}
            <span className="mt-0.5 block truncate text-xs text-ink-2 md:hidden">{c.city}, {countryName(c.country)}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
              <StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge>
              <span className="text-xs text-ink-3">{plural(c.orderCount, "order")}</span>
            </span>
          </span>
        </span>
      ),
    },
    { key: "location", header: "Location", sortValue: (c) => `${countryName(c.country)} ${c.city}`, hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink-2">{c.city}, {countryName(c.country)}</span> },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      sortValue: (c) => c.orderCount,
      hideBelow: "md",
      cell: (c) => (
        <>
          <span className="text-ink">{c.orderCount}</span>
          {c.cancelledCount ? <span className="block text-xs whitespace-nowrap text-ink-3">{c.cancelledCount} cancelled</span> : null}
        </>
      ),
    },
    { key: "spent", header: "Total spent", align: "right", sortValue: (c) => c.spent, hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink">{formatMoney(c.spent, cur)}</span> },
    { key: "last", header: "Last order", sortValue: (c) => c.lastOrderAt, hideBelow: "lg", cell: (c) => <span className="whitespace-nowrap text-ink-2">{relativeDay(c.lastOrderAt)}</span> },
    { key: "segment", header: "Segment", sortValue: (c) => c.segment, hideBelow: "md", cell: (c) => <StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge> },
  ]

  const rowActions: RowAction<BrandCustomer>[] = [
    { label: "View purchase history", icon: History, onSelect: (c) => setOpenId(c.id) },
    { label: "Open last order", icon: Open, onSelect: (c) => router.push(`/studio/orders/${c.orders[0].id}`) },
  ]
  const bulkActions: BulkAction<BrandCustomer>[] = [{ label: "Export selected", onSelect: exportRows }]

  return (
    <div className="grid gap-6">
      <PageHeader title="Customers" description={customersDescription(brand.name)}>
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {ready && customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" body="Everyone who buys from you appears here, with their orders and what they've spent with you." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/products">Go to products</Link></Button>} />
      ) : (
        <div className="grid gap-4">
          <StatusTabs id="customer-segment" label="Customer segment" value={tab} onChange={setTab} controls="customer-list" tabs={tabs.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />

          <section id="customer-list" aria-label="Customers">
            <DataTable
              label="Customers"
              rows={ready ? rows : []}
              loading={!ready}
              columns={columns}
              getId={(c) => c.id}
              search={{ placeholder: "Search customers", text: (c) => `${c.name} ${c.city} ${countryName(c.country)}` }}
              rowActions={rowActions}
              bulkActions={bulkActions}
              initialPageSize={25}
              pageSizes={[25, 50, 100]}
              minWidth={300}
              toolbar={
                <>
                <PhoneSort value={sort} onChange={setSort} options={sortOptions} />
                <p className="flex items-center gap-1 text-xs text-ink-3 sm:ml-auto">
                  How segments work
                  <InfoTip label="How segments work" side="left" className="relative after:absolute after:-inset-2.5">Orders are the ones that went through; cancelled orders don&apos;t count. New: fewer than two orders with you. Repeat: two or more. VIP: {formatMoney(vipThreshold(cur), cur)} or more spent with you, refunds excluded.</InfoTip>
                </p>
                </>
              }
              empty={{
                title: tab === "all" ? "No customers yet" : `No ${segmentMeta[tab as Segment].label.toLowerCase()} customers yet`,
                body: "Customers move between segments as they order again.",
                action: tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all customers</Button> : undefined,
              }}
            />
          </section>
        </div>
      )}

      <CustomerSheet customer={open} cur={cur} onClose={close} />
    </div>
  )
}

function CustomerSheet({ customer: c, cur, onClose }: { customer: BrandCustomer | null; cur: CurrencyCode; onClose: () => void }) {
  // Keep the last customer while the sheet animates out.
  const [last, setLast] = useState<BrandCustomer | null>(c)
  if (c && c !== last) setLast(c)
  const shown = c ?? last

  const products = useMemo(() => {
    if (!shown) return []
    const m = new Map<string, { name: string; image: BrandCustomer["orders"][number]["lines"][number]["image"]; qty: number; id: string }>()
    for (const o of shown.orders) {
      if (o.status === "cancelled") continue
      for (const l of o.lines) {
        const prev = m.get(l.productId)
        if (prev) prev.qty += l.quantity
        else m.set(l.productId, { id: l.productId, name: l.name, image: l.image, qty: l.quantity })
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 4)
  }, [shown])

  // Back to the customer's name in the list when the sheet closes (it may have opened from the row menu).
  const focus = useFocusReturn(() => (shown ? document.querySelector<HTMLElement>(`[data-customer="${CSS.escape(shown.id)}"]`) : null))

  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <SheetContent side="right" className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]" {...focus}>
        {shown ? (
          <>
            <SheetHeader className="gap-3 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
              <div className="flex min-w-0 items-center gap-3">
                <Initials name={shown.name} className="size-10 text-xs" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-[15px] text-ink">{shown.name}</SheetTitle>
                  <SheetDescription className="mt-0.5 truncate text-xs text-ink-2">{shown.city}, {countryName(shown.country)}. Customer since {formatDateYear(shown.firstOrderAt)}</SheetDescription>
                </div>
              </div>
              <div><StatusBadge tone={segmentMeta[shown.segment].tone}>{segmentMeta[shown.segment].label}</StatusBadge></div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="grid gap-6 p-4 md:p-5">
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft">
                  {[
                    { label: "Orders", value: String(shown.orderCount) },
                    { label: "Total spent", value: formatMoney(shown.spent, cur) },
                    { label: "Average order", value: shown.paidCount ? formatMoney(Math.round(shown.spent / shown.paidCount / 100) * 100, cur) : "None" },
                  ].map((s) => (
                    <div key={s.label} className="bg-card px-3 py-2.5">
                      <dt className="text-[11px] text-ink-3">{s.label}</dt>
                      <dd className="mt-1 truncate text-sm font-medium text-ink tabular">{s.value}</dd>
                    </div>
                  ))}
                </dl>

                <section aria-labelledby="history-title" className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 id="history-title" className="text-[13px] font-medium text-ink">Purchase history</h3>
                    {shown.cancelledCount ? <span className="text-xs text-ink-3">{plural(shown.cancelledCount, "cancelled order")} listed, not counted</span> : null}
                  </div>
                  <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line-soft bg-card">
                    {shown.orders.map((o) => {
                      const meta = orderStatusMeta[o.status]
                      return (
                        <li key={o.id}>
                          <Link href={`/studio/orders/${o.id}`} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-white/[0.02]">
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-medium whitespace-nowrap text-ink tabular">#{o.reference}</span>
                                <span className={cn("text-sm tabular", o.status === "cancelled" || o.status === "refunded" ? "text-ink-3 line-through" : "text-ink")}>{formatMoney(o.total, cur)}</span>
                              </span>
                              <span className="truncate text-xs text-ink-2">{formatDateYear(o.placedAt)}, {plural(itemCount(o), "item")}: {o.lines.map((l) => l.name).join(", ")}</span>
                              <span><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                {products.length ? (
                  <section aria-labelledby="bought-title" className="grid gap-2">
                    <h3 id="bought-title" className="text-[13px] font-medium text-ink">What they buy</h3>
                    <ul className="grid gap-2">
                      {products.map((p) => (
                        <li key={p.id} className="flex items-center gap-3">
                          <Thumb image={p.image} size={36} />
                          <Link href={`/studio/products/${p.id}`} className="min-w-0 flex-1 truncate text-sm text-ink hover:text-violet">{p.name}</Link>
                          <span className="text-xs text-ink-2 tabular">{p.qty} bought</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <p className="flex gap-2 rounded-md border border-line-soft bg-card p-3 text-xs text-ink-2">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                  Email address, phone and payment details stay with the platform. Each order shows the delivery details you need to ship it.
                </p>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
