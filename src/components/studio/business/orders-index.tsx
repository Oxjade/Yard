"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { ChevronRight, Download, PackageCheck, Search, SearchX, ShoppingCart, X } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { TableSkeleton } from "@/components/feedback/skeletons"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { SelectAll } from "@/components/studio/catalog/select-all"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { brandById } from "@/lib/data/brands"
import { formatMoney, toMajor } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { countryName, emptyOrderTab, formatDateTime, itemCount, orderMatchesTab, orderTabs, paymentMeta, paymentState, plural, relativeDay, shopperName, type OrderTab } from "./model"
import { useStudioReady } from "./shared"

const PAGE = 25

export function OrdersIndex() {
  const ready = useStudioReady()
  const router = useRouter()
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const brand = brandById.get(brandId)!
  const cur = brand.currency

  const [tab, setTab] = useState<OrderTab>("paid")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(PAGE)

  const sorted = useMemo(() => [...orders].sort((a, b) => b.placedAt.localeCompare(a.placedAt)), [orders])

  const counts = useMemo(() => {
    const c = Object.fromEntries(orderTabs.map((t) => [t.value, 0])) as Record<OrderTab, number>
    for (const o of sorted) {
      c.all += 1
      if (o.status in c) c[o.status as OrderTab] += 1
    }
    return c
  }, [sorted])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, "")
    return sorted.filter((o) => orderMatchesTab(o, tab)).filter((o) => !term || o.reference.toLowerCase().includes(term) || shopperName(o.customerId).toLowerCase().includes(term))
  }, [sorted, tab, q])

  const shown = filtered.slice(0, limit)
  const chosen = filtered.filter((o) => selected.has(o.id))
  const eligible = chosen.filter((o) => o.status === "paid")
  const allChosen = shown.length > 0 && shown.every((o) => selected.has(o.id))
  const someChosen = shown.some((o) => selected.has(o.id)) && !allChosen

  function changeTab(t: OrderTab) {
    setTab(t)
    setSelected(new Set())
    setLimit(PAGE)
  }

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(shown.map((o) => o.id)) : new Set())
  }

  function markProcessing() {
    if (!eligible.length) return
    const ids = eligible.map((o) => o.id)
    for (const id of ids) setOrderStatus(id, "processing", "Brand started processing")
    const skipped = chosen.length - ids.length
    setSelected(new Set())
    toast.success(`${plural(ids.length, "order")} moved to processing`, {
      description: skipped ? `${plural(skipped, "order")} skipped: only orders to fulfil can move to processing.` : "Add tracking to each one when it ships.",
      action: {
        label: "Undo",
        onClick: () => {
          for (const id of ids) useStudio.getState().setOrderStatus(id, "paid", "Moved back to To fulfil")
          toast(`${plural(ids.length, "order")} back in To fulfil`)
        },
      },
    })
  }

  function exportCsv() {
    const rows = filtered
    if (!rows.length) {
      toast("Nothing to export", { description: "This view has no orders." })
      return
    }
    const esc = (v: string | number) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ["Order", "Placed", "Customer", "Items", `Total (${cur})`, "Payment", "Fulfilment", "Ship to", "Shipping method", "Carrier", "Tracking"]
    const lines = rows.map((o) =>
      [
        o.reference,
        o.placedAt.slice(0, 10),
        shopperName(o.customerId),
        itemCount(o),
        toMajor(o.total, o.currency),
        paymentMeta[paymentState(o)].label,
        orderStatusMeta[o.status].label,
        `${o.shippingAddress.city}, ${countryName(o.shippingAddress.country)}`,
        o.shippingMethod.replace(" — ", ", "),
        o.tracking?.carrier ?? "",
        o.tracking?.number ?? "",
      ]
        .map(esc)
        .join(","),
    )
    try {
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${brand.handle}-orders-${orderTabs.find((t) => t.value === tab)!.label.toLowerCase().replace(/\s+/g, "-")}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${plural(rows.length, "order")}`, { description: "Fulfilment details only. Customer emails stay with the platform." })
    } catch {
      toast.error("Couldn't export. Try again.")
    }
  }

  const bulkBar = (
    <AnimatePresence initial={false}>
      {chosen.length > 0 ? (
        <motion.div
          key="bulk"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={spring.snappy}
          className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-purple/10 px-4 py-2.5 md:px-5"
          role="region"
          aria-label="Bulk actions"
        >
          <Button size="icon-sm" variant="ghost" className="-ml-2" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X />
          </Button>
          <span className="mr-auto text-sm text-ink tabular">{chosen.length} selected</span>
          {eligible.length < chosen.length ? <span className="text-xs text-ink-2">{eligible.length ? `${plural(eligible.length, "order")} can move` : "Only orders to fulfil can move to processing"}</span> : null}
          <Button size="sm" variant="secondary" onClick={markProcessing} disabled={!eligible.length}>
            <PackageCheck /> Mark as processing
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  let body: React.ReactNode
  if (!ready) {
    body = <TableSkeleton rows={6} cols={6} />
  } else if (orders.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        <EmptyState icon={ShoppingCart} title="No orders yet" body="When a customer pays for one of your products, the order appears here, ready to fulfil." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/products">Go to products</Link></Button>} />
      </div>
    )
  } else if (filtered.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        {q.trim() ? (
          <EmptyState icon={SearchX} title="No orders match" body="Search by order number, like LS-10427, or by the customer's name." action={<Button size="sm" variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
        ) : (
          <EmptyState icon={ShoppingCart} title={emptyOrderTab[tab].title} body={emptyOrderTab[tab].body} action={tab !== "all" ? <Button size="sm" variant="secondary" onClick={() => changeTab("all")}>Show all orders</Button> : undefined} />
        )}
      </div>
    )
  } else {
    body = (
      <>
        {/* Phones: a list of order cards */}
        <ul className="divide-y divide-line-soft md:hidden">
          {shown.map((o) => {
            const status = orderStatusMeta[o.status]
            const pay = paymentMeta[paymentState(o)]
            return (
              <li key={o.id} className={cn("relative flex items-start gap-3 px-4 py-3.5", selected.has(o.id) && "bg-purple/[0.06]")}>
                <Checkbox checked={selected.has(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} aria-label={`Select order ${o.reference}`} className="relative z-10 mt-0.5" />
                <Link href={`/studio/orders/${o.id}`} className="flex min-w-0 flex-1 items-start gap-2 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-violet focus-visible:after:ring-inset">
                  <span className="grid min-w-0 flex-1 gap-1.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium whitespace-nowrap text-ink tabular">#{o.reference}</span>
                      <span className="text-sm text-ink tabular">{formatMoney(o.total, cur)}</span>
                    </span>
                    <span className="truncate text-sm text-ink-2">{shopperName(o.customerId)}, {plural(itemCount(o), "item")}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      <StatusBadge tone={pay.tone}>{pay.label}</StatusBadge>
                      <span className="ml-auto text-xs text-ink-3">{relativeDay(o.placedAt)}</span>
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Tablet and desktop: the table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="w-10 py-2.5 pr-1 pl-4 font-normal md:pl-5">
                  <SelectAll checked={allChosen ? true : someChosen ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all orders shown" />
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">Order</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Placed</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Customer</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Items</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Total</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Payment</th>
                <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Fulfilment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {shown.map((o) => {
                const status = orderStatusMeta[o.status]
                const pay = paymentMeta[paymentState(o)]
                const on = selected.has(o.id)
                return (
                  <tr key={o.id} onClick={() => router.push(`/studio/orders/${o.id}`)} className={cn("cursor-pointer transition-colors hover:bg-white/[0.02]", on && "bg-purple/[0.06]")}>
                    <td className="py-3 pr-1 pl-4 md:pl-5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(o.id, v === true)} aria-label={`Select order ${o.reference}`} />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/studio/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium whitespace-nowrap text-ink tabular hover:text-violet">#{o.reference}</Link>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-2" title={formatDateTime(o.placedAt)}>{relativeDay(o.placedAt)}</td>
                    <td className="px-3 py-3">
                      <span className="block whitespace-nowrap text-ink">{shopperName(o.customerId)}</span>
                      <span className="block text-xs whitespace-nowrap text-ink-3">{o.shippingAddress.city}, {countryName(o.shippingAddress.country)}</span>
                    </td>
                    <td className="max-w-[220px] px-3 py-3 text-ink-2">
                      <span className="block tabular">{plural(itemCount(o), "item")}</span>
                      <span className="block truncate text-xs text-ink-3">{o.lines[0]?.name}{o.lines.length > 1 ? ` and ${o.lines.length - 1} more` : ""}</span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">{formatMoney(o.total, cur)}</td>
                    <td className="px-3 py-3"><StatusBadge tone={pay.tone}>{pay.label}</StatusBadge></td>
                    <td className="px-4 py-3 md:px-5"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                  </tr>
                )
              })}
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
      <PageHeader
        title="Orders"
        description={`Paid orders for ${brand.name}, newest first. Payment on every order here was verified by the payment provider before it reached you.`}
        actions={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!ready}>
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="grid gap-4">
        <StatusTabs id="order-status" label="Order status" value={tab} onChange={changeTab} controls="order-list" tabs={orderTabs.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-11 sm:max-w-sm md:h-9">
            <InputGroupAddon><Search className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setLimit(PAGE)
              }}
              placeholder="Search by order number or customer"
              aria-label="Search orders"
            />
            {q ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQ("")}><X /></InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          {ready && q.trim() ? <p className="text-xs text-ink-3 tabular sm:ml-auto">{plural(filtered.length, "result")}</p> : null}
        </div>

        <section id="order-list" aria-label="Orders" aria-busy={!ready} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          {ready && shown.length > 0 ? (
            <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 md:hidden">
              <SelectAll checked={allChosen ? true : someChosen ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all orders shown" />
              <span className="text-xs text-ink-3">Select all</span>
            </div>
          ) : null}
          {bulkBar}
          {body}
        </section>

        <p className="text-xs text-ink-3">Only {brand.name}&apos;s orders are shown here. In the backend phase the server enforces this on every request, so no brand can read another brand&apos;s orders.</p>
      </div>
    </div>
  )
}
