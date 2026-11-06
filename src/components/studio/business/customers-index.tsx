"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { CaretRightIcon as ChevronRight, LockIcon as Lock, MagnifyingGlassIcon as Search, MagnifyingGlassMinusIcon as SearchX, UsersIcon as Users, XIcon as X } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { TableSkeleton } from "@/components/feedback/skeletons"
import { InfoTip } from "@/components/feedback/info-tip"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { brandById } from "@/lib/data/brands"
import type { CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { buildCustomers, countryName, customersDescription, formatDateYear, itemCount, plural, relativeDay, segmentMeta, vipThreshold, type BrandCustomer, type Segment } from "./model"
import { Thumb } from "@/components/studio/catalog/parts"
import { Initials, useStudioReady } from "./shared"

type Tab = "all" | Segment
type Sort = "recent" | "spent" | "orders"

const tabs: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "repeat", label: "Repeat" },
  { value: "vip", label: "VIP" },
]

/** "Today" reads as "last order today"; dates keep their capital month. */
const lowerRelative = (s: string) => (/^(Today|Yesterday|\d+ days ago)$/.test(s) ? s.toLowerCase() : s)

const sortLabel: Record<Sort, string> = { recent: "Last order", spent: "Total spent", orders: "Most orders" }

/** Same page size and footer as the Orders list. */
const PAGE = 25

export function CustomersIndex() {
  const ready = useStudioReady()
  const params = useSearchParams()
  const pathname = usePathname()
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const brand = brandById.get(brandId)!
  const cur = brand.currency

  const [tab, setTab] = useState<Tab>("all")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<Sort>("recent")
  const [limit, setLimit] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(() => params.get("customer"))

  const customers = useMemo(() => buildCustomers(orders, cur), [orders, cur])
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: customers.length, new: 0, repeat: 0, vip: 0 }
    for (const x of customers) c[x.segment] += 1
    return c
  }, [customers])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = customers
      .filter((c) => tab === "all" || c.segment === tab)
      .filter((c) => !term || [c.name, c.city, countryName(c.country)].join(" ").toLowerCase().includes(term))
    return [...list].sort((a, b) => (sort === "spent" ? b.spent - a.spent : sort === "orders" ? b.orderCount - a.orderCount || b.spent - a.spent : b.lastOrderAt.localeCompare(a.lastOrderAt)))
  }, [customers, tab, q, sort])

  const shown = filtered.slice(0, limit)
  const open = ready ? customers.find((c) => c.id === openId) ?? null : null

  function changeTab(t: Tab) {
    setTab(t)
    setLimit(PAGE)
  }

  function search(v: string) {
    setQ(v)
    setLimit(PAGE)
  }

  function close() {
    setOpenId(null)
    if (params.get("customer")) window.history.replaceState(null, "", pathname)
  }

  let body: React.ReactNode
  if (!ready) {
    body = <TableSkeleton rows={6} cols={6} />
  } else if (customers.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        <EmptyState icon={Users} title="No customers yet" body="Everyone who buys from you appears here, with their orders and what they've spent with you." />
      </div>
    )
  } else if (filtered.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        {q.trim() ? (
          <EmptyState icon={SearchX} title="No customers match" body="Search by name, city or country." action={<Button size="sm" variant="secondary" onClick={() => search("")}>Clear search</Button>} />
        ) : (
          <EmptyState icon={Users} title={`No ${segmentMeta[tab as Segment].label.toLowerCase()} customers yet`} body="Customers move between segments as they order again." action={<Button size="sm" variant="secondary" onClick={() => changeTab("all")}>Show all customers</Button>} />
        )}
      </div>
    )
  } else {
    body = (
      <>
        <ul className="divide-y divide-line-soft md:hidden">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:bg-white/[0.03]">
                <Initials name={c.name} className="size-9" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="text-sm text-ink tabular">{formatMoney(c.spent, cur)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs text-ink-2">
                    <span className="truncate">{c.city}, {countryName(c.country)}</span>
                    <span className="shrink-0 tabular">{plural(c.orderCount, "order")}{c.cancelledCount ? `, ${c.cancelledCount} cancelled` : ""}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge>
                    <span className="text-xs text-ink-3">Last order {lowerRelative(relativeDay(c.lastOrderAt))}</span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Customer</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Location</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Orders</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Total spent</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Last order</th>
                <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Segment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {shown.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3 md:px-5">
                    <span className="flex items-center gap-3">
                      <Initials name={c.name} />
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenId(c.id) }} className="font-medium whitespace-nowrap text-ink outline-none hover:text-violet focus-visible:text-violet">
                        {c.name}
                      </button>
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-2">{c.city}, {countryName(c.country)}</td>
                  <td className="px-3 py-3 text-right text-ink tabular">
                    {c.orderCount}
                    {c.cancelledCount ? <span className="block text-xs whitespace-nowrap text-ink-3">{c.cancelledCount} cancelled</span> : null}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">{formatMoney(c.spent, cur)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-2">{relativeDay(c.lastOrderAt)}</td>
                  <td className="px-4 py-3 md:px-5"><StatusBadge tone={segmentMeta[c.segment].tone}>{segmentMeta[c.segment].label}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs text-ink-2 md:px-5">
          <span className="tabular">Showing {shown.length} of {filtered.length}</span>
          {filtered.length > shown.length ? (
            <Button size="xs" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - shown.length)} more</Button>
          ) : null}
        </div>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Customers" description={customersDescription(brand.name)} />

      <div className="grid gap-4">
        <StatusTabs id="customer-segment" label="Customer segment" value={tab} onChange={changeTab} controls="customer-list" tabs={tabs.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-11 sm:max-w-sm md:h-9">
            <InputGroupAddon><Search className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => search(e.target.value)} placeholder="Search by name, city or country" aria-label="Search customers" />
            {q ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => search("")}><X /></InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as Sort)
              setLimit(PAGE)
            }}
          >
            <SelectTrigger aria-label="Sort customers" className="w-full data-[size=default]:h-11 sm:w-48 md:data-[size=default]:h-9">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-ink-3">Sort</span>
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent position="popper">
              {(Object.keys(sortLabel) as Sort[]).map((s) => (
                <SelectItem key={s} value={s}>{sortLabel[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="flex items-center gap-1 text-xs text-ink-3 sm:ml-auto">
            How segments work
            <InfoTip label="How segments work">Orders are the ones that went through; cancelled orders don&apos;t count. New: fewer than two orders with you. Repeat: two or more. VIP: {formatMoney(vipThreshold(cur), cur)} or more spent with you, refunds excluded.</InfoTip>
          </p>
        </div>

        <section id="customer-list" aria-label="Customers" aria-busy={!ready} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          {body}
        </section>
      </div>

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

  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <SheetContent side="right" className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
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
