"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, History, PackageSearch, Search, SearchX, SlidersHorizontal, X } from "lucide-react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { ListSkeleton, TableSkeleton } from "@/components/feedback/skeletons"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { availableStock, variantLabel } from "@/lib/data/products"
import type { Product, Variant } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { AdjustStockDialog, reasonLabel } from "./adjust-dialog"
import { Swatch, Thumb, VariantStatus } from "./parts"
import { StatusTabs } from "./status-tabs"
import { useCatalogReady } from "./store"
import { formatDateTime, LOW_VARIANT_STOCK, plural, soldByVariant, variantLevel, type StockLevel } from "./utils"

type Filter = "all" | "low" | "out"
type Row = { product: Product; variant: Variant; label: string; hex?: string; available: number; sold: number; level: StockLevel }

export function InventoryView() {
  const ready = useCatalogReady()
  const products = useStudio((s) => s.products)
  const log = useStudio((s) => s.inventoryLog)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [target, setTarget] = useState<{ productId: string; variantId: string } | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [shown, setShown] = useState(10)

  const rows: Row[] = useMemo(
    () =>
      products
        .filter((p) => p.status !== "archived")
        .flatMap((p) => {
          const sold = soldByVariant(p)
          const colours = new Map(p.options.flatMap((o) => (o.name === "Colour" ? o.values.map((c) => [c.name, c.hex] as const) : [])))
          return p.variants.map((v) => {
            const available = availableStock(v)
            return { product: p, variant: v, label: variantLabel(v.options) || "Default variant", hex: v.options.Colour ? colours.get(v.options.Colour) : undefined, available, sold: sold.get(v.id) ?? 0, level: variantLevel(available) }
          })
        }),
    [products],
  )

  const counts = useMemo(() => ({ all: rows.length, low: rows.filter((r) => r.level === "low").length, out: rows.filter((r) => r.level === "out").length }), [rows])
  const alerts = rows.filter((r) => r.available <= LOW_VARIANT_STOCK)

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows
      .filter((r) => filter === "all" || r.level === filter)
      .filter((r) => !term || [r.product.name, r.label, r.variant.sku].join(" ").toLowerCase().includes(term))
  }, [rows, filter, q])

  const groups = useMemo(() => {
    const map = new Map<string, { product: Product; rows: Row[]; total: number }>()
    for (const r of filtered) {
      const g = map.get(r.product.id) ?? { product: r.product, rows: [], total: rows.filter((x) => x.product.id === r.product.id).reduce((n, x) => n + x.available, 0) }
      g.rows.push(r)
      map.set(r.product.id, g)
    }
    return [...map.values()]
  }, [filtered, rows])

  const live = target ? products.find((p) => p.id === target.productId) : undefined
  const liveVariant = live?.variants.find((v) => v.id === target?.variantId)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const history = historyFor ? log.filter((e) => e.variantId === historyFor) : log
  const historyRow = historyFor ? rows.find((r) => r.variant.id === historyFor) : undefined

  function showHistory(variantId: string) {
    setHistoryFor(variantId)
    setShown(10)
    requestAnimationFrame(() => document.getElementById("stock-history")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  const adjustButton = (r: Row, className?: string) => (
    <Button type="button" size="xs" variant="secondary" className={className} onClick={() => setTarget({ productId: r.product.id, variantId: r.variant.id })} aria-label={`Adjust stock for ${r.product.name}, ${r.label}`}>
      <SlidersHorizontal /> Adjust
    </Button>
  )

  let body: React.ReactNode
  if (!ready)
    body = (
      // The shared skeleton brings its own card; -m-px lays its border over this one's.
      <div className="-m-px">
        <TableSkeleton rows={8} cols={6} />
      </div>
    )
  else if (rows.length === 0)
    body = (
      <div className="p-4 md:p-5">
        <EmptyState icon={PackageSearch} title="No stock to track yet" body="Add a product with its sizes and colours, and each variant shows up here." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/products/new">Add product</Link></Button>} />
      </div>
    )
  else if (filtered.length === 0)
    body = (
      <div className="p-4 md:p-5">
        {q.trim() ? (
          <EmptyState icon={SearchX} title="No variants match" body="Try a product name, a size or a SKU." action={<Button size="sm" variant="secondary" onClick={() => setQ("")}>Clear search</Button>} />
        ) : (
          <EmptyState
            icon={PackageSearch}
            title={filter === "out" ? "Nothing is out of stock" : "Nothing is running low"}
            body={
              filter === "out"
                ? "Every variant has at least one unit available."
                : counts.out
                  ? `No variant is down to its last ${LOW_VARIANT_STOCK} units. Sold-out variants are under Out of stock.`
                  : `Every variant has more than ${LOW_VARIANT_STOCK} units available.`
            }
            action={<Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all variants</Button>}
          />
        )}
      </div>
    )
  else
    body = (
      <>
        {/* Phones: one card per product, a compact line per variant */}
        <ul className="divide-y divide-line-soft md:hidden">
          {groups.map((g) => (
            <li key={g.product.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Thumb image={g.product.images[0]} size={40} />
                <Link href={`/studio/products/${g.product.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{g.product.name}</Link>
                <span className="text-xs text-ink-3 tabular">{g.total} available</span>
              </div>
              <ul className="mt-2 grid gap-1">
                {g.rows.map((r) => (
                  <li key={r.variant.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md bg-surface/60 py-2.5 pr-2 pl-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink"><Swatch hex={r.hex} /><span className="truncate">{r.label}</span></span>
                    <span className="text-right text-[11px] whitespace-nowrap text-ink-3">
                      <span className={cn("text-sm font-medium tabular", r.level === "in" ? "text-ink" : "text-acid")}>{r.available}</span> available
                    </span>
                    <span className="truncate text-[11px] text-ink-3 tabular">{r.variant.sku}</span>
                    <span className="justify-self-end"><VariantStatus available={r.available} /></span>
                    <span className="text-[11px] text-ink-3 tabular">{r.variant.reserved} reserved, {r.sold} sold in 30 days</span>
                    <span className="flex justify-end gap-1">
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Stock history for ${r.product.name}, ${r.label}`} onClick={() => showHistory(r.variant.id)}><History /></Button>
                      {adjustButton(r, "h-8")}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* Tablet and desktop: grouped by product */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Variant</th>
                <th scope="col" className="px-3 py-2.5 font-normal">SKU</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Available</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Reserved</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Sold, 30 days</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                <th scope="col" className="px-4 py-2.5 text-right font-normal md:px-5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.product.id} className="divide-y divide-line-soft border-b border-line-soft last:border-b-0">
                <tr className="bg-white/[0.015]">
                  <th scope="rowgroup" colSpan={7} className="px-4 py-2.5 text-left font-normal md:px-5">
                    <span className="flex items-center gap-3">
                      <Thumb image={g.product.images[0]} size={32} />
                      <Link href={`/studio/products/${g.product.id}`} className="truncate font-medium text-ink hover:text-violet">{g.product.name}</Link>
                      <span className="text-xs text-ink-3 tabular">{plural(g.product.variants.length, "variant")}, {g.total} available</span>
                    </span>
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.variant.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="py-3 pr-3 pl-4 text-ink-2 md:pl-16"><span className="flex items-center gap-1.5 whitespace-nowrap"><Swatch hex={r.hex} />{r.label}</span></td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-2 tabular">{r.variant.sku}</td>
                    <td className={cn("px-3 py-3 text-right font-medium tabular", r.level === "in" ? "text-ink" : "text-acid")}>{r.available}</td>
                    <td className="px-3 py-3 text-right text-ink-2 tabular">{r.variant.reserved}</td>
                    <td className="px-3 py-3 text-right text-ink-2 tabular">{r.sold}</td>
                    <td className="px-3 py-3"><VariantStatus available={r.available} /></td>
                    <td className="px-4 py-3 md:px-5">
                      <span className="flex justify-end gap-1">
                        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Stock history for ${r.product.name}, ${r.label}`} onClick={() => showHistory(r.variant.id)}><History /></Button>
                        {adjustButton(r)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </>
    )

  const outN = alerts.filter((r) => r.level === "out").length
  const lowN = alerts.length - outN

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Inventory"
        description="Stock for every size and colour you sell. Adjust a count when stock arrives, gets damaged or comes back."
        actions={
          <Button size="sm" variant="secondary" onClick={() => document.getElementById("stock-history")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <History /> Stock history
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {ready && alerts.length ? (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-acid/30 bg-acid/5 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="size-4 shrink-0 text-acid" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{plural(alerts.length, "variant")} {alerts.length === 1 ? "needs" : "need"} restocking</p>
            <p className="mt-0.5 text-xs text-ink-2">
              {[outN ? `${outN} out of stock` : null, lowN ? `${lowN} with ${LOW_VARIANT_STOCK} or fewer left` : null].filter(Boolean).join(" and ")}. Shoppers can&apos;t buy what&apos;s out.
            </p>
          </div>
          <div className="flex gap-2">
            {outN ? <Button size="sm" variant="secondary" onClick={() => setFilter("out")}>Show out of stock</Button> : null}
            {lowN ? <Button size="sm" variant="secondary" onClick={() => setFilter("low")}>Show low stock</Button> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4">
        <StatusTabs
          id="inventory-filter"
          label="Stock level"
          value={filter}
          onChange={setFilter}
          controls="stock-list"
          tabs={[
            { value: "all", label: "All", count: ready ? counts.all : undefined },
            { value: "low", label: "Low stock", count: ready ? counts.low : undefined },
            { value: "out", label: "Out of stock", count: ready ? counts.out : undefined },
          ]}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-11 sm:max-w-sm md:h-9">
            <InputGroupAddon><Search className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, size or SKU" aria-label="Search inventory" />
            {q ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQ("")}><X /></InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>

        <section id="stock-list" aria-label="Stock by variant" aria-busy={!ready} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          {body}
        </section>
        <p className="text-xs text-ink-3">Available is on hand minus units reserved for open orders. Archived products aren&apos;t listed.</p>
      </div>

      <section id="stock-history" aria-labelledby="history-title" className="scroll-mt-20 rounded-lg border border-line-soft bg-card p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="history-title" className="text-sm font-medium text-ink">Stock history</h2>
            <p className="mt-0.5 text-xs text-ink-2">Every adjustment, newest first.</p>
          </div>
          {historyRow ? (
            <button type="button" onClick={() => setHistoryFor(null)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-purple/60 bg-purple/15 pr-1.5 pl-2.5 text-xs text-ink">
              {historyRow.product.name}, {historyRow.label}
              <X className="size-3.5" aria-hidden />
              <span className="sr-only">Show all history</span>
            </button>
          ) : null}
        </div>
        {!ready ? (
          <ListSkeleton rows={3} />
        ) : history.length === 0 ? (
          <EmptyState icon={History} title={historyFor ? "No changes for this variant yet" : "No stock changes yet"} body="When you adjust stock here or change a count on a product page, it's recorded with the reason." className="py-10" />
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {history.slice(0, shown).map((e) => {
                const p = productById.get(e.productId)
                const v = p?.variants.find((x) => x.id === e.variantId)
                const up = e.delta > 0
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border", up ? "border-white/12 text-ink" : "border-white/10 text-ink-2")}>
                      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm text-ink">
                        {reasonLabel[e.reason]} <span className="tabular">{up ? `+${e.delta}` : e.delta}</span>
                      </span>
                      <span className="truncate text-xs text-ink-2">{p ? `${p.name}, ${v ? variantLabel(v.options) || "Default variant" : "removed variant"}` : "Deleted product"}</span>
                      {e.note ? <span className="text-xs text-ink-3">{e.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs whitespace-nowrap text-ink-3 tabular">{formatDateTime(e.at)}</span>
                  </li>
                )
              })}
            </ul>
            {history.length > shown ? (
              <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setShown((n) => n + 20)}>
                Show {Math.min(20, history.length - shown)} more
              </Button>
            ) : null}
          </>
        )}
      </section>

      <AdjustStockDialog target={live && liveVariant ? { product: live, variant: liveVariant } : null} onOpenChange={(o) => !o && setTarget(null)} />
    </div>
  )
}
