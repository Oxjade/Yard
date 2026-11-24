"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ArrowSquareOutIcon as Open, CaretRightIcon as ChevronRight, ClockCounterClockwiseIcon as History, LockIcon as Lock, UsersIcon as Users } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { currencies, type CurrencyCode } from "@/config/markets"
import { showInPlace, useSearchParam } from "@/hooks/use-search-param"
import { useNow } from "@/hooks/use-now"
import { api, ApiError } from "@/lib/api/client"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, toMajor } from "@/lib/money"
import { useRealtimeEventName } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import type { BrandCustomerRow, BrandCustomers } from "@/server/analytics/brand-db"
import { countryName, customersDescription, formatDateYear, plural, relativeDay, segmentMeta, vipThreshold, type Segment } from "./model"
import { TableBlockSkeleton } from "./skeletons"
import { Initials, PhoneSort, phoneCell, useFocusReturn } from "./shared"

type Tab = "all" | Segment
type Sort = "recent" | "spent" | "orders"
type Row = BrandCustomerRow & { segment: Segment }

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

const asCurrency = (c: string | undefined): CurrencyCode => (c && c in currencies ? (c as CurrencyCode) : "NGN")
const place = (c: Pick<BrandCustomerRow, "city" | "country">) => (c.city ? `${c.city}, ${countryName(c.country)}` : countryName(c.country))

/**
 * Studio › Customers for a real brand: the people who bought from it, built on the server from
 * its own orders (GET /api/studio/customers): the name on their account, where their latest order
 * shipped, their paid orders and what they've spent. No email, phone or address: each order
 * shows the delivery details the brand needs to ship it.
 */
export function LiveCustomers({ member }: { member: BrandProfile }) {
  const router = useRouter()
  const pathname = usePathname()
  const brandId = member.brand.id
  const q = useApi<BrandCustomers>(`studio.customers:${brandId}`, () => api<BrandCustomers>("/api/studio/customers"), { revalidateOnFocus: true })
  useRealtimeEventName("order.updated", () => void q.revalidate())
  const now = useNow(60_000)
  const ready = !!q.data
  const cur = asCurrency(q.data?.currency)

  const [tab, setTab] = useState<Tab>("all")
  const linked = useSearchParam("customer")
  const [openId, setOpenId] = useState<string | null>(linked)
  const [seenLinked, setSeenLinked] = useState(linked)
  if (linked !== seenLinked) {
    setSeenLinked(linked)
    if (linked) setOpenId(linked)
  }
  const [sort, setSort] = useState<Sort>("recent")

  const vip = vipThreshold(cur)
  const customers: Row[] = (q.data?.customers ?? []).map((c) => ({ ...c, segment: c.spentMinor >= vip ? "vip" : c.orderCount >= 2 ? "repeat" : "new" }))
  const counts: Record<Tab, number> = { all: customers.length, new: 0, repeat: 0, vip: 0 }
  for (const x of customers) counts[x.segment] += 1
  const rows = customers
    .filter((c) => tab === "all" || c.segment === tab)
    .sort((a, b) => (sort === "spent" ? b.spentMinor - a.spentMinor : sort === "orders" ? b.orderCount - a.orderCount || b.spentMinor - a.spentMinor : b.lastOrderAt.localeCompare(a.lastOrderAt)))
  const open = customers.find((c) => c.id === openId) ?? null
  const when = (iso: string) => (now === null ? formatDateYear(iso) : relativeDay(iso, now))

  function close() {
    setOpenId(null)
    if (linked) showInPlace(pathname)
  }

  function exportRows(list: Row[]) {
    const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = [["Customer", "City", "Country", "Orders", `Spent (${cur})`, "First order", "Last order", "Segment"].join(","), ...list.map((c) => [c.name, c.city ?? "", countryName(c.country), c.orderCount, toMajor(c.spentMinor, cur), c.firstOrderAt.slice(0, 10), c.lastOrderAt.slice(0, 10), segmentMeta[c.segment].label].map(esc).join(","))].join("\n")
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `${member.brand.handle}-customers.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${plural(list.length, "customer")}`, { description: "Names, locations and order totals. Contact details stay with the platform." })
    } catch {
      toast.error("The file couldn't be created", { description: "Try again. If it keeps failing, try another browser." })
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <Initials name={c.name} className="hidden md:inline-flex" />
          <span className={cn(phoneCell, "relative")}>
            <span className="flex items-baseline justify-between gap-3">
              <button type="button" data-customer={c.id} onClick={() => setOpenId(c.id)} className="min-w-0 truncate rounded-sm text-left font-medium whitespace-nowrap text-ink outline-none after:absolute after:-inset-y-2 after:inset-x-0 hover:text-violet focus-visible:ring-2 focus-visible:ring-violet md:after:hidden">
                {c.name}
              </button>
              <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{formatMoney(c.spentMinor, cur)}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-2 md:hidden">{place(c)}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
              <StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge>
              <span className="text-xs text-ink-3">{plural(c.orderCount, "order")}</span>
            </span>
          </span>
        </span>
      ),
    },
    { key: "location", header: "Location", sortValue: (c) => `${countryName(c.country)} ${c.city ?? ""}`, hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink-2">{place(c)}</span> },
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
    { key: "spent", header: "Total spent", align: "right", sortValue: (c) => c.spentMinor, hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink">{formatMoney(c.spentMinor, cur)}</span> },
    { key: "last", header: "Last order", sortValue: (c) => c.lastOrderAt, hideBelow: "lg", cell: (c) => <span className="whitespace-nowrap text-ink-2">{when(c.lastOrderAt)}</span> },
    { key: "segment", header: "Segment", sortValue: (c) => c.segment, hideBelow: "md", cell: (c) => <StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge> },
  ]

  const rowActions: RowAction<Row>[] = [
    { label: "View purchase history", icon: History, onSelect: (c) => setOpenId(c.id) },
    { label: "Open last order", icon: Open, onSelect: (c) => router.push(`/studio/orders/${c.orders[0].id}`), hidden: (c) => !c.orders.length },
  ]
  const bulkActions: BulkAction<Row>[] = [{ label: "Export selected", onSelect: exportRows }]

  return (
    <div className="grid gap-6">
      <PageHeader title="Customers" description={customersDescription(member.brand.name)} />

      {q.error && !q.data ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink">Couldn&apos;t load your customers</p>
          <p className="max-w-sm text-sm text-ink-2">{q.error instanceof ApiError ? q.error.message : "Yard's server didn't answer."}</p>
          <Button variant="secondary" size="sm" className="h-10" onClick={() => void q.revalidate()}>
            Retry
          </Button>
        </div>
      ) : !ready ? (
        <div role="status" aria-label="Loading customers">
          <TableBlockSkeleton tabs={4} cols={6} />
        </div>
      ) : customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" body="Everyone who buys from you appears here, with their orders and what they've spent with you." action={<Button asChild size="sm" variant="secondary"><Link href={`/brands/${member.brand.handle}`} target="_blank" rel="noopener">View storefront</Link></Button>} />
      ) : (
        <div className="grid gap-4">
          <StatusTabs id="customer-segment" label="Customer segment" value={tab} onChange={setTab} controls="customer-list" tabs={tabs.map((t) => ({ ...t, count: counts[t.value] }))} />

          <section id="customer-list" aria-label="Customers">
            <DataTable
              label="Customers"
              rows={rows}
              columns={columns}
              getId={(c) => c.id}
              search={{ placeholder: "Search customers", text: (c) => `${c.name} ${c.city ?? ""} ${countryName(c.country)}` }}
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
                    <InfoTip label="How segments work">Orders are the paid ones; cancelled orders don&apos;t count. New: fewer than two orders with you. Repeat: two or more. VIP: {formatMoney(vipThreshold(cur), cur)} or more spent with you, refunds excluded.</InfoTip>
                  </p>
                </>
              }
              empty={{
                title: tab === "all" ? "No customers yet" : `No ${segmentMeta[tab as Segment].label.toLowerCase()} customers yet`,
                body: "Customers move between segments as they order again.",
                action: tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all customers</Button> : undefined,
              }}
            />
            {q.data?.truncated ? <p className="mt-3 text-xs text-ink-3">Showing your {plural(customers.length, "most recent customer")} of {q.data.total.toLocaleString("en-US")}.</p> : null}
          </section>
        </div>
      )}

      <CustomerSheet customer={open} cur={cur} onClose={close} />
    </div>
  )
}

function CustomerSheet({ customer: c, cur, onClose }: { customer: Row | null; cur: CurrencyCode; onClose: () => void }) {
  // Keep the last customer while the sheet animates out.
  const [last, setLast] = useState<Row | null>(c)
  if (c && c !== last) setLast(c)
  const shown = c ?? last
  const focus = useFocusReturn(() => (shown ? document.querySelector<HTMLElement>(`[data-customer="${CSS.escape(shown.id)}"]`) : null))

  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <SheetContent opaque side="right" className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]" {...focus}>
        {shown ? (
          <>
            <SheetHeader className="gap-3 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
              <div className="flex min-w-0 items-center gap-3">
                <Initials name={shown.name} className="size-10 text-xs" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-[15px] text-ink">{shown.name}</SheetTitle>
                  <SheetDescription className="mt-0.5 truncate text-xs text-ink-2">{place(shown)}. Customer since {formatDateYear(shown.firstOrderAt)}</SheetDescription>
                </div>
              </div>
              <div><StatusBadge tone={segmentMeta[shown.segment].tone}>{segmentMeta[shown.segment].label}</StatusBadge></div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="grid gap-6 p-4 md:p-5">
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft">
                  {[
                    { label: "Orders", value: String(shown.orderCount) },
                    { label: "Total spent", value: formatMoney(shown.spentMinor, cur) },
                    { label: "Average order", value: shown.orderCount ? formatMoney(Math.round(shown.spentMinor / shown.orderCount / 100) * 100, cur) : "None" },
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
                      const meta = orderStatusMeta[o.status] ?? orderStatusMeta.pending_payment
                      return (
                        <li key={o.id}>
                          <Link href={`/studio/orders/${o.id}`} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-white/[0.02]">
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-medium whitespace-nowrap text-ink tabular">#{o.reference}</span>
                                <span className={cn("text-sm tabular", o.status === "cancelled" || o.status === "refunded" ? "text-ink-3 line-through" : "text-ink")}>{formatMoney(o.totalMinor, asCurrency(o.currency))}</span>
                              </span>
                              <span className="truncate text-xs text-ink-2">{formatDateYear(o.placedAt)}, {plural(o.itemCount, "item")}{o.items.length ? `: ${o.items.join(", ")}` : ""}</span>
                              <span><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                  {shown.orders.length < shown.orderCount + shown.cancelledCount ? <p className="text-xs text-ink-3">The latest {shown.orders.length}. Every order is on the Orders page.</p> : null}
                </section>

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
