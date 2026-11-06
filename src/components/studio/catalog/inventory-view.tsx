"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { WarningIcon as AlertTriangle, ArrowDownRightIcon as ArrowDownRight, ArrowUpRightIcon as ArrowUpRight, ClockCounterClockwiseIcon as History, PencilSimpleIcon as Pencil, SlidersHorizontalIcon as SlidersHorizontal, XIcon as X } from "@phosphor-icons/react"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { InfoTip } from "@/components/feedback/info-tip"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { availableStock, variantLabel } from "@/lib/data/products"
import type { Product, Variant } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { PhoneSort } from "@/components/studio/business/shared"
import { AdjustStockDialog, reasonLabel } from "./adjust-dialog"
import { selectedTabFor } from "./fields"
import { inventoryCopy } from "./page-copy"
import { CatalogueNote, Swatch, Thumb, VariantStatus } from "./parts"
import { StatusTabs } from "./status-tabs"
import { useCatalogReady } from "./store"
import { formatDateTime, LOW_VARIANT_STOCK, plural, soldByVariant, variantLevel, type StockLevel } from "./utils"

type Filter = "all" | "low" | "out"
type Row = { id: string; product: Product; variant: Variant; label: string; hex?: string; available: number; sold: number; level: StockLevel }

const levelRank: Record<StockLevel, number> = { out: 0, low: 1, in: 2 }

type Sort = "product" | "available" | "sold"

/** The phone sort menu: the same orders the desktop column headers give. A product's variants stay in their own order. */
const sortOptions: { value: Sort; label: string }[] = [
  { value: "product", label: "Product, A to Z" },
  { value: "available", label: "Lowest available first" },
  { value: "sold", label: "Most sold first" },
]

/** A number that fades in when it changes (after an adjustment), and not on first paint. */
function Changing({ value, className }: { value: number; className?: string }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={value} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className={cn("inline-block tabular", className)}>
        {value.toLocaleString("en-US")}
      </motion.span>
    </AnimatePresence>
  )
}

export function InventoryView() {
  const ready = useCatalogReady()
  const router = useRouter()
  const products = useStudio((s) => s.products)
  const log = useStudio((s) => s.inventoryLog)
  const [filter, setFilter] = useState<Filter>("all")
  const [target, setTarget] = useState<{ productId: string; variantId: string } | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [shown, setShown] = useState(10)
  const [sort, setSort] = useState<Sort>("product")

  const rows: Row[] = useMemo(
    () =>
      products
        .filter((p) => p.status !== "archived")
        .flatMap((p) => {
          const sold = soldByVariant(p)
          const colours = new Map(p.options.flatMap((o) => (o.name === "Colour" ? o.values.map((c) => [c.name, c.hex] as const) : [])))
          return p.variants.map((v) => {
            const available = availableStock(v)
            return { id: v.id, product: p, variant: v, label: variantLabel(v.options) || "Default variant", hex: v.options.Colour ? colours.get(v.options.Colour) : undefined, available, sold: sold.get(v.id) ?? 0, level: variantLevel(available) }
          })
        }),
    [products],
  )

  const counts = useMemo(() => ({ all: rows.length, low: rows.filter((r) => r.level === "low").length, out: rows.filter((r) => r.level === "out").length }), [rows])
  // Rows arrive sorted by the phone sort menu; the column headers re-sort on wider screens.
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => filter === "all" || r.level === filter)
        .sort((a, b) => (sort === "available" ? a.available - b.available : sort === "sold" ? b.sold - a.sold : a.product.name.localeCompare(b.product.name))),
    [rows, filter, sort],
  )

  const live = target ? products.find((p) => p.id === target.productId) : undefined
  const liveVariant = live?.variants.find((v) => v.id === target?.variantId)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const history = historyFor ? log.filter((e) => e.variantId === historyFor) : log
  const historyRow = historyFor ? rows.find((r) => r.variant.id === historyFor) : undefined

  function showHistory(variantId: string | null) {
    setHistoryFor(variantId)
    setShown(10)
    requestAnimationFrame(() => {
      const el = document.getElementById("stock-history")
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
      el?.focus({ preventScroll: true })
    })
  }

  const adjust = (r: Row) => setTarget({ productId: r.product.id, variantId: r.variant.id })

  const columns: Column<Row>[] = [
    {
      key: "variant",
      header: "Variant",
      sortValue: (r) => `${r.product.name} ${r.label}`.toLowerCase(),
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb image={r.product.images[0]} size={36} />
          <span className="grid min-w-0 gap-0.5">
            {/* Phones show whole names over two lines instead of cutting them off. */}
            <Link href={`/studio/products/${r.product.id}`} className="line-clamp-2 rounded-sm text-[13px] font-medium break-words text-ink outline-none hover:text-violet focus-visible:ring-2 focus-visible:ring-violet sm:line-clamp-1">
              {r.product.name}
            </Link>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
              <Swatch hex={r.hex} />
              <span className="line-clamp-2 break-words sm:line-clamp-1">{r.label}</span>
            </span>
            <span className="truncate text-[11px] text-ink-3 tabular md:hidden">{r.variant.sku}</span>
            {/* The Status column is hidden on phones: say low and out in words, not just acid. */}
            {r.level !== "in" ? (
              <span className="mt-0.5 sm:hidden">
                <VariantStatus available={r.available} />
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: "sku", header: "SKU", hideBelow: "md", sortValue: (r) => r.variant.sku, cell: (r) => <span className="text-xs whitespace-nowrap text-ink-2 tabular">{r.variant.sku}</span> },
    {
      key: "available",
      header: "Available",
      align: "right",
      sortValue: (r) => r.available,
      cell: (r) => <Changing value={r.available} className={cn("font-medium", r.level === "in" ? "text-ink" : "text-acid")} />,
    },
    { key: "reserved", header: "Reserved", align: "right", hideBelow: "lg", sortValue: (r) => r.variant.reserved, cell: (r) => <Changing value={r.variant.reserved} className="text-ink-2" /> },
    { key: "sold", header: "Sold, 30 days", align: "right", hideBelow: "lg", sortValue: (r) => r.sold, cell: (r) => <span className="text-ink-2">{r.sold}</span> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (r) => levelRank[r.level], cell: (r) => <VariantStatus available={r.available} /> },
    {
      key: "adjust",
      header: "Adjust",
      align: "right",
      hideBelow: "sm",
      cell: (r) => (
        <Button type="button" size="xs" variant="secondary" onClick={() => adjust(r)} aria-label={`Adjust stock for ${r.product.name}, ${r.label}`}>
          <SlidersHorizontal /> Adjust
        </Button>
      ),
    },
  ]

  const rowActions: RowAction<Row>[] = [
    { label: "Adjust stock", icon: SlidersHorizontal, onSelect: adjust },
    { label: "Stock history", icon: History, onSelect: (r) => showHistory(r.variant.id) },
    { label: "Edit product", icon: Pencil, onSelect: (r) => router.push(`/studio/products/${r.product.id}`), separatorBefore: true },
  ]

  const alerts = rows.filter((r) => r.level !== "in")
  const outN = counts.out
  const lowN = counts.low

  const empty =
    filter === "all"
      ? { title: "No stock to track yet", body: "Add a product with its sizes and colours, and each variant shows up here.", action: <Button asChild size="sm" variant="secondary"><Link href="/studio/products/new">Add product</Link></Button> }
      : {
          title: filter === "out" ? "Nothing is out of stock" : "Nothing is running low",
          body: filter === "out" ? "Every variant has at least one unit available." : `No variant is down to its last ${LOW_VARIANT_STOCK} units.`,
          action: <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all variants</Button>,
        }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={inventoryCopy.title}
        description={inventoryCopy.description}
        actions={
          <Button size="sm" variant="secondary" className="h-10 md:h-8" onClick={() => showHistory(null)}>
            <History /> Stock history
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <CatalogueNote>{inventoryCopy.note}</CatalogueNote>
        </div>
      </PageHeader>

      <AnimatePresence initial={false}>
        {ready && alerts.length ? (
          <motion.div key="alerts" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} role="status" className="flex flex-col gap-3 rounded-lg border border-acid/30 bg-acid/5 p-4 sm:flex-row sm:items-center">
            <AlertTriangle className="size-4 shrink-0 text-acid" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{plural(alerts.length, "variant")} {alerts.length === 1 ? "needs" : "need"} restocking</p>
              <p className="mt-0.5 text-xs text-ink-2">
                {[outN ? `${outN} out of stock` : null, lowN ? `${lowN} with ${LOW_VARIANT_STOCK} or fewer left` : null].filter(Boolean).join(" and ")}. You get a notification when a variant crosses either line.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {outN ? <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => setFilter("out")} disabled={filter === "out"}>Show out of stock</Button> : null}
              {lowN ? <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => setFilter("low")} disabled={filter === "low"}>Show low stock</Button> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
        <section id="stock-list" aria-label="Stock by variant" aria-busy={!ready}>
          <DataTable
            label="Stock by variant"
            rows={ready ? filtered : []}
            columns={columns}
            getId={(r) => r.id}
            loading={!ready}
            search={{ placeholder: "Search product, size or SKU", text: (r) => [r.product.name, r.label, r.variant.sku].join(" ") }}
            toolbar={
              <>
                <PhoneSort value={sort} onChange={setSort} options={sortOptions} />
                <p className="flex items-center gap-1 text-xs text-ink-3 sm:ml-auto">
                  Available is on hand minus reserved
                  <InfoTip label="How available is counted">Units on hand minus units reserved for open orders. Archived products aren&apos;t listed. Sold in 30 days is sample data.</InfoTip>
                </p>
              </>
            }
            rowActions={rowActions}
            empty={empty}
            density="dense"
            minWidth={340}
          />
        </section>
      </div>

      <section id="stock-history" tabIndex={-1} aria-labelledby="history-title" className="scroll-mt-24 rounded-lg border border-line-soft bg-card p-4 outline-none md:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="history-title" className="text-sm font-medium text-ink">Stock history</h2>
            <p className="mt-0.5 text-xs text-ink-2">Every adjustment made in Studio, newest first.</p>
          </div>
          {/* Announced, since picking "Stock history" from a row menu returns focus to that menu. */}
          <p className="sr-only" aria-live="polite">{historyRow ? `Stock history filtered to ${historyRow.product.name}, ${historyRow.label}.` : ""}</p>
          {historyRow ? (
            <button type="button" onClick={() => setHistoryFor(null)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-purple/60 bg-purple/15 pr-2 pl-3 text-xs text-ink transition-colors hover:bg-purple/25">
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
              <AnimatePresence initial={false}>
                {history.slice(0, shown).map((e) => {
                  const p = productById.get(e.productId)
                  const v = p?.variants.find((x) => x.id === e.variantId)
                  const up = e.delta > 0
                  return (
                    <motion.li key={e.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 py-3">
                      <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border", up ? "border-white/12 text-ink" : "border-white/10 text-ink-2")}>
                        {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-sm text-ink">
                          {reasonLabel[e.reason]} <span className="tabular">{up ? `+${e.delta}` : e.delta}</span>
                        </span>
                        <span className="truncate text-xs text-ink-2">{p ? `${p.name}, ${v ? variantLabel(v.options) || "Default variant" : "removed variant"}` : "Deleted product"}</span>
                        {e.note ? <span className="text-xs text-ink-3">{e.note}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs whitespace-nowrap text-ink-3 tabular">{formatDateTime(e.at)}</span>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
            {history.length > shown ? (
              <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setShown((n) => n + 20)}>
                Show {Math.min(20, history.length - shown)} more
              </Button>
            ) : null}
          </>
        )}
      </section>

      <AdjustStockDialog target={live && liveVariant ? { product: live, variant: liveVariant } : null} onOpenChange={(o) => !o && setTarget(null)} returnFocus={selectedTabFor("stock-list")} />
    </div>
  )
}
