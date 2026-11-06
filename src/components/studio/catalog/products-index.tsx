"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { Archive, ChevronRight, Package, Plus, Search, SearchX, Send, X } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { TableSkeleton } from "@/components/feedback/skeletons"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNow } from "@/hooks/use-now"
import { brandById } from "@/lib/data/brands"
import { categoryBySlug } from "@/lib/data/catalog"
import type { CategorySlug, Product, ProductStatus } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "./fields"
import { ProductStock, Thumb } from "./parts"
import { SelectAll } from "./select-all"
import { StatusTabs } from "./status-tabs"
import { useCatalog, useCatalogReady } from "./store"
import { formatDateTime, plural, relativeDay, totalAvailable } from "./utils"

type Tab = "all" | ProductStatus

const tabOrder: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "scheduled", label: "Scheduled" },
  { value: "archived", label: "Archived" },
]

const emptyTab: Record<Exclude<Tab, "all">, { title: string; body: string }> = {
  draft: { title: "No drafts", body: "Products you save as a draft wait here until you publish them." },
  published: { title: "Nothing published yet", body: "Publish a product to put it on your storefront and in the marketplace." },
  scheduled: { title: "Nothing scheduled", body: "Set a product to Scheduled on its page to publish it at a set time." },
  archived: { title: "No archived products", body: "Archived products are hidden from shoppers. You can restore them at any time." },
}

export function ProductsIndex() {
  const ready = useCatalogReady()
  const router = useRouter()
  const now = useNow(60_000)
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const setProductStatus = useStudio((s) => s.setProductStatus)
  const meta = useCatalog((s) => s.productMeta)
  const setProductMeta = useCatalog((s) => s.setProductMeta)
  const touchProducts = useCatalog((s) => s.touchProducts)
  const brand = brandById.get(brandId)!

  const [tab, setTab] = useState<Tab>("all")
  const [q, setQ] = useState("")
  const [category, setCategory] = useState<CategorySlug | "all">("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [archiveOpen, setArchiveOpen] = useState(false)

  const updatedAt = (p: Product) => meta[p.id]?.updatedAt ?? p.createdAt

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: products.length, draft: 0, published: 0, scheduled: 0, archived: 0 }
    for (const p of products) c[p.status] += 1
    return c
  }, [products])

  const categoryOptions = useMemo(() => {
    const slugs = [...new Set(products.map((p) => p.category))]
    return slugs.map((s) => ({ value: s, label: categoryBySlug.get(s)?.name ?? s })).sort((a, b) => a.label.localeCompare(b.label))
  }, [products])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return products
      .filter((p) => tab === "all" || p.status === tab)
      .filter((p) => category === "all" || p.category === category)
      .filter((p) => !term || [p.name, p.subcategory, ...p.tags, ...p.variants.map((v) => v.sku)].join(" ").toLowerCase().includes(term))
      .sort((a, b) => (meta[b.id]?.updatedAt ?? b.createdAt).localeCompare(meta[a.id]?.updatedAt ?? a.createdAt))
  }, [products, tab, category, q, meta])

  const chosen = filtered.filter((p) => selected.has(p.id))
  const allChosen = filtered.length > 0 && chosen.length === filtered.length
  const someChosen = chosen.length > 0 && !allChosen
  const filtering = q.trim() !== "" || category !== "all"

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(filtered.map((p) => p.id)) : new Set())
  }

  function changeTab(t: Tab) {
    setTab(t)
    setSelected(new Set())
  }

  function clearFilters() {
    setQ("")
    setCategory("all")
  }

  function publishChosen() {
    const targets = chosen.filter((p) => p.status !== "published")
    if (!targets.length) {
      toast("Already published", { description: chosen.length === 1 ? "That product is already live." : "Those products are already live." })
      return
    }
    for (const p of targets) {
      setProductStatus(p.id, "published")
      setProductMeta(p.id, { publishAt: null })
    }
    touchProducts(targets.map((p) => p.id))
    setSelected(new Set())
    toast.success(`Published ${plural(targets.length, "product")}`, { description: "Live on your storefront and in the marketplace." })
  }

  function archiveChosen() {
    const targets = chosen.filter((p) => p.status !== "archived")
    const previous = targets.map((p) => ({ id: p.id, status: p.status }))
    for (const p of targets) setProductStatus(p.id, "archived")
    touchProducts(targets.map((p) => p.id))
    setSelected(new Set())
    toast.success(`Archived ${plural(targets.length, "product")}`, {
      description: "Hidden from shoppers. Find them in the Archived tab.",
      action: {
        label: "Undo",
        onClick: () => {
          for (const p of previous) useStudio.getState().setProductStatus(p.id, p.status)
          toast(`Restored ${plural(previous.length, "product")}`)
        },
      },
    })
  }

  const archiveCount = chosen.filter((p) => p.status !== "archived").length

  const bulkBar = (
    <AnimatePresence initial={false}>
      {chosen.length > 0 ? (
        <motion.div
          key="bulk"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex items-center gap-2 border-b border-line-soft bg-purple/10 px-4 py-2.5 md:px-5"
          role="region"
          aria-label="Bulk actions"
        >
          <Button size="icon-sm" variant="ghost" className="-ml-2" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X />
          </Button>
          <span className="mr-auto text-sm text-ink tabular">{chosen.length} selected</span>
          <Button size="sm" variant="secondary" onClick={publishChosen}>
            <Send /> Publish
          </Button>
          <Button size="sm" variant="secondary" onClick={() => (archiveCount ? setArchiveOpen(true) : toast("Already archived"))}>
            <Archive /> Archive
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  let body: React.ReactNode
  if (!ready) {
    body = (
      // The shared skeleton brings its own card; -m-px lays its border over this one's.
      <div className="-m-px">
        <TableSkeleton rows={6} cols={6} />
      </div>
    )
  } else if (products.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        <EmptyState
          icon={Package}
          title="Add your first product"
          body="Products you add here appear on your storefront and in the marketplace once you publish them."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/studio/products/new"><Plus /> Add product</Link>
            </Button>
          }
        />
      </div>
    )
  } else if (filtered.length === 0) {
    body = (
      <div className="p-4 md:p-5">
        {filtering ? (
          <EmptyState icon={SearchX} title="No products match" body="Try another search term or category." action={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={Package} title={emptyTab[tab as Exclude<Tab, "all">].title} body={emptyTab[tab as Exclude<Tab, "all">].body} action={<Button size="sm" variant="secondary" onClick={() => changeTab("all")}>Show all products</Button>} />
        )}
      </div>
    )
  } else {
    body = (
      <>
        {/* Phones: a list of cards */}
        <ul className="divide-y divide-line-soft md:hidden">
          {filtered.map((p) => {
            const status = productStatusMeta[p.status]
            const at = meta[p.id]?.publishAt
            return (
              <li key={p.id} className="relative flex items-start gap-3 px-4 py-3">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={`Select ${p.name}`} className="relative z-10 mt-5" />
                <Link href={`/studio/products/${p.id}`} className="flex min-w-0 flex-1 items-start gap-3 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-violet focus-visible:after:ring-inset">
                  <Thumb image={p.images[0]} size={56} />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      <span className="text-xs text-ink tabular">{formatMoney(p.price, brand.currency)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                      <ProductStock available={totalAvailable(p)} />
                      <span className="text-ink-3">{plural(p.variants.length, "variant")}</span>
                    </span>
                    {p.status === "scheduled" && at ? <ScheduledAt at={at} now={now} /> : null}
                  </span>
                  <ChevronRight className="mt-5 size-4 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Tablet and desktop: the table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="w-10 py-2.5 pr-1 pl-4 font-normal md:pl-5">
                  <SelectAll checked={allChosen ? true : someChosen ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all products shown" />
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">Product</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Stock</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Price</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Variants</th>
                <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {filtered.map((p) => {
                const status = productStatusMeta[p.status]
                const at = meta[p.id]?.publishAt
                const on = selected.has(p.id)
                return (
                  <tr key={p.id} onClick={() => router.push(`/studio/products/${p.id}`)} className={cn("cursor-pointer transition-colors hover:bg-white/[0.02]", on && "bg-purple/[0.06]")}>
                    <td className="py-3 pr-1 pl-4 md:pl-5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={`Select ${p.name}`} />
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3">
                        <Thumb image={p.images[0]} />
                        <span className="grid min-w-0">
                          <Link href={`/studio/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-ink hover:text-violet">{p.name}</Link>
                          <span className="truncate text-xs text-ink-3">{categoryBySlug.get(p.category)?.name ?? p.category}, {p.subcategory}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="grid justify-items-start gap-1">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        {p.status === "scheduled" && at ? <ScheduledAt at={at} now={now} compact /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3"><ProductStock available={totalAvailable(p)} /></td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                      <span className="text-ink">{formatMoney(p.price, brand.currency)}</span>
                      {p.compareAt ? <span className="block text-xs text-ink-3 line-through">{formatMoney(p.compareAt, brand.currency)}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-2 tabular">{p.variants.length}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2 md:px-5">{now ? relativeDay(updatedAt(p), now) : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Products"
        description="Everything you sell, in every state. Select several products to publish or archive them together."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/products/new"><Plus /> Add product</Link>
          </Button>
        }
      />

      <div className="grid gap-4">
        <StatusTabs id="product-status" label="Product status" value={tab} onChange={changeTab} controls="product-list" tabs={tabOrder.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="h-11 sm:max-w-sm md:h-9">
            <InputGroupAddon><Search className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, tag or SKU" aria-label="Search products" />
            {q ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQ("")}><X /></InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <Select value={category} onValueChange={(v) => setCategory(v as CategorySlug | "all")}>
            <SelectTrigger aria-label="Category" className="w-full data-[size=default]:h-11 sm:w-52 md:data-[size=default]:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All categories</SelectItem>
              {categoryOptions.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ready && filtering ? <p className="self-center text-xs text-ink-3 sm:ml-auto tabular">{plural(filtered.length, "result")}</p> : null}
        </div>

        <section id="product-list" aria-label="Products" aria-busy={!ready} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          {ready && filtered.length > 0 ? (
            <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 md:hidden">
              <SelectAll checked={allChosen ? true : someChosen ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all products shown" />
              <span className="text-xs text-ink-3">Select all</span>
            </div>
          ) : null}
          {bulkBar}
          {body}
        </section>
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${plural(archiveCount, "product")}?`}
        body="Archived products are hidden from your storefront and the marketplace. Orders and stock stay as they are, and you can restore them from the Archived tab."
        confirmLabel={`Archive ${plural(archiveCount, "product")}`}
        onConfirm={archiveChosen}
      />
    </div>
  )
}

/**
 * When a scheduled product goes live. Nothing publishes on a timer until the backend exists,
 * so a time that has passed says so in acid instead of implying the product is live.
 */
function ScheduledAt({ at, now, compact }: { at: string; now: number | null; compact?: boolean }) {
  const due = now !== null && Date.parse(at) <= now
  if (due) return <span className={cn("whitespace-nowrap text-acid", compact ? "text-[11px]" : "text-xs")}>Time passed, not live yet</span>
  return <span className={cn("whitespace-nowrap text-ink-3", compact ? "text-[11px]" : "text-xs")}>{compact ? formatDateTime(at) : `Set for ${formatDateTime(at)}`}</span>
}
