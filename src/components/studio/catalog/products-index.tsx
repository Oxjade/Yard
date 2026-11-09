"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArchiveIcon as Archive, ArrowCounterClockwiseIcon as Restore, CopyIcon as Copy, PackageIcon as Package, PaperPlaneTiltIcon as Send, PencilSimpleIcon as Pencil, PlusIcon as Plus, TrashIcon as Trash } from "@phosphor-icons/react"
import { toast } from "sonner"
import { DataTable, bulkBarControl, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNow } from "@/hooks/use-now"
import { ApiError, api } from "@/lib/api/client"
import type { StudioProductResponse, StudioProductStatusAction } from "@/lib/api/contracts/catalog"
import { useApi } from "@/lib/api/use-api"
import { products as seedProducts } from "@/lib/data"
import { categoryBySlug } from "@/lib/data/catalog"
import type { CategorySlug, Product, ProductStatus } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { PhoneSort } from "@/components/studio/business/shared"
import { ConfirmDialog, selectedTabFor } from "./fields"
import { duplicateProductBody, fromStudioProduct, loadStudioProductDtos } from "./live"
import { productsCopy } from "./page-copy"
import { CatalogueNote, ProductStock, Thumb } from "./parts"
import { uniqueSlug } from "./product-form-model"
import { StatusTabs } from "./status-tabs"
import { productUpdatedAt, restoreProductStatuses, setProductStatuses, useCatalogReady } from "./store"
import { formatDateTime, plural, productIdFor, relativeDay, totalAvailable } from "./utils"

type Tab = "all" | ProductStatus
type Sort = "updated" | "name" | "stock" | "price"

/** The phone sort menu: the same orders the desktop column headers give. */
const sortOptions: { value: Sort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name, A to Z" },
  { value: "stock", label: "Lowest stock first" },
  { value: "price", label: "Highest price first" },
]

const tabOrder: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "scheduled", label: "Scheduled" },
  { value: "archived", label: "Archived" },
]

const emptyTab: Record<Tab, { title: string; body: string }> = {
  all: { title: "No products yet", body: "Add a product to start your catalogue." },
  draft: { title: "No drafts", body: "Products you save as a draft wait here until you publish them." },
  published: { title: "Nothing published yet", body: "Publish a draft to mark it ready for your storefront." },
  scheduled: { title: "Nothing scheduled", body: "Set a product to Scheduled on its page to pick a go-live time." },
  archived: { title: "No archived products", body: "Products you archive wait here, with their orders and stock history. You can restore them at any time." },
}

/** The last value that wasn't null: a closing dialog keeps its words while it fades out. */
function useLastNonNull<T>(value: T | null) {
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  return value ?? last
}

/** Sort order for the Status column: what needs attention first. */
const statusRank: Record<ProductStatus, number> = { draft: 0, scheduled: 1, published: 2, archived: 3 }

/**
 * A draft copy of a product: same details, photos and options, new SKUs (suffixed -COPY) and
 * no stock, so nothing is double counted. Collections carry over.
 */
function duplicate(p: Product) {
  const store = useStudio.getState()
  const taken = new Set([...seedProducts, ...store.products].flatMap((x) => [x.slug, x.id]))
  // "Hoodie" → "Hoodie copy", then "Hoodie copy 2": copying a copy doesn't stack suffixes.
  const base = p.name.replace(/ copy( \d+)?$/, "").slice(0, 70)
  const names = new Set(store.products.map((x) => x.name.toLowerCase()))
  let name = `${base} copy`
  for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} copy ${n}`
  const slug = uniqueSlug(name, taken)
  const id = productIdFor(slug)
  const skus = new Set(store.products.flatMap((x) => x.variants.map((v) => v.sku.toUpperCase())))
  const variants = p.variants.map((v, i) => {
    const base = `${v.sku}-COPY`.slice(0, 36)
    let sku = base
    for (let n = 2; skus.has(sku.toUpperCase()); n++) sku = `${base}${n}`
    skus.add(sku.toUpperCase())
    return { id: `${id}_v${i}`, sku, options: v.options, stock: 0, reserved: 0 }
  })
  const at = new Date().toISOString()
  const copy: Product = {
    ...p,
    id,
    slug,
    name,
    variants,
    status: "draft",
    createdAt: at,
    updatedAt: at,
    publishAt: undefined,
    badges: ["new"],
    dropId: undefined,
    collectionIds: [...p.collectionIds],
    stats: { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
  }
  store.upsertProduct(copy)
  return copy
}

export function ProductsIndex() {
  const localReady = useCatalogReady()
  const member = useServerSession((state) => state.brand)
  const liveBrand = member && !member.demo ? member.brand.id : null
  const live = !!liveBrand
  const liveProducts = useApi(liveBrand ? `studio.catalog:${liveBrand}` : null, loadStudioProductDtos, { revalidateOnFocus: true, keepPrevious: false })
  const ready = live ? !liveProducts.isLoading : localReady
  const router = useRouter()
  const now = useNow(60_000)
  const localProducts = useStudio((s) => s.products)
  const products = useMemo(() => (live ? (liveProducts.data ?? []).map(fromStudioProduct) : localProducts), [live, liveProducts.data, localProducts])
  const liveDtos = useMemo(() => new Map((liveProducts.data ?? []).map((product) => [product.id, product])), [liveProducts.data])
  const orders = useStudio((s) => s.orders)

  const [tab, setTab] = useState<Tab>("all")
  const [category, setCategory] = useState<CategorySlug | "all">("all")
  const [sort, setSort] = useState<Sort>("updated")
  const [archiving, setArchiving] = useState<Product[] | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)

  const ordered = useMemo(() => new Set(orders.flatMap((o) => o.lines.map((l) => l.productId))), [orders])
  const loadError = live && liveProducts.error ? (liveProducts.error instanceof ApiError ? liveProducts.error.message : "Couldn't load this brand's catalogue.") : null

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: products.length, draft: 0, published: 0, scheduled: 0, archived: 0 }
    for (const p of products) c[p.status] += 1
    return c
  }, [products])

  const categoryOptions = useMemo(() => {
    const slugs = [...new Set(products.map((p) => p.category))]
    return slugs.map((s) => ({ value: s, label: categoryBySlug.get(s)?.name ?? s })).sort((a, b) => a.label.localeCompare(b.label))
  }, [products])

  // Rows arrive sorted by the phone sort menu (recently updated first by default); the column headers re-sort on wider screens.
  const rows = useMemo(
    () =>
      products
        .filter((p) => (tab === "all" || p.status === tab) && (category === "all" || p.category === category))
        .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "stock" ? totalAvailable(a) - totalAvailable(b) : sort === "price" ? b.price - a.price : productUpdatedAt(b).localeCompare(productUpdatedAt(a)))),
    [products, tab, category, sort],
  )

  /* ---------- actions ---------- */

  async function runLiveStatus(list: Product[], action: StudioProductStatusAction) {
    const targets = list.flatMap((product) => {
      const dto = liveDtos.get(product.id)
      return dto ? [{ product, dto }] : []
    })
    if (!targets.length) return { changed: 0, errors: ["That product isn't in this brand's catalogue anymore."] }
    const results = await Promise.allSettled(
      targets.map(({ dto }) =>
        api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(dto.id)}/status`, {
          method: "POST",
          body: { action, expectedVersion: dto.version },
        }),
      ),
    )
    await liveProducts.revalidate()
    const errors = results.flatMap((result, index) =>
      result.status === "rejected" ? [`${targets[index].product.name}: ${result.reason instanceof ApiError ? result.reason.message : "couldn't update."}`] : [],
    )
    return { changed: results.length - errors.length, errors }
  }

  function reportStatus(action: "publish" | "archive" | "restore", result: { changed: number; errors: string[] }) {
    const done = action === "publish" ? "Published" : action === "archive" ? "Archived" : "Restored"
    if (result.changed) toast.success(`${done} ${plural(result.changed, "product")}`)
    if (result.errors.length) toast.error(`Couldn't ${action} ${plural(result.errors.length, "product")}`, { description: result.errors.slice(0, 3).join(" ") })
  }

  // Row menus disable these for rows they don't apply to, and the bulk bar passes only the
  // rows each one applies to, so there is always something to change.
  async function publish(list: Product[]) {
    const targets = list.filter((p) => p.status !== "published")
    if (!targets.length) return
    if (live) {
      reportStatus("publish", await runLiveStatus(targets, "publish"))
      return
    }
    const previous = setProductStatuses(targets.map((p) => p.id), "published")
    toast.success(`Published ${plural(previous.length, "product")}`, {
      action: { label: "Undo", onClick: () => restoreProductStatuses(previous) },
    })
  }

  /** Settles the bulk Archive that opened the dialog: true once confirmed, false when cancelled (the selection stays). */
  const archiveAnswer = useRef<((confirmed: boolean) => void) | null>(null)
  function answerArchive(confirmed: boolean) {
    archiveAnswer.current?.(confirmed)
    archiveAnswer.current = null
  }

  function askArchive(list: Product[]) {
    const targets = list.filter((p) => p.status !== "archived")
    if (!targets.length) return false
    answerArchive(false)
    setArchiving(targets)
    return new Promise<boolean>((resolve) => {
      archiveAnswer.current = resolve
    })
  }

  async function archive(list: Product[]) {
    if (live) {
      const targets = list.filter((p) => p.status !== "archived")
      if (!targets.length) return
      reportStatus("archive", await runLiveStatus(targets, "archive"))
      return
    }
    const previous = setProductStatuses(list.map((p) => p.id), "archived")
    toast.success(`Archived ${plural(previous.length, "product")}`, {
      description: previous.length === 1 ? "Find it in the Archived tab." : "Find them in the Archived tab.",
      action: { label: "Undo", onClick: () => restoreProductStatuses(previous) },
    })
  }

  async function restore(list: Product[]) {
    if (live) {
      const targets = list.filter((p) => p.status === "archived")
      if (!targets.length) return
      reportStatus("restore", await runLiveStatus(targets, "restore"))
      return
    }
    const previous = setProductStatuses(list.filter((p) => p.status === "archived").map((p) => p.id), "draft")
    if (!previous.length) return
    toast.success(`Restored ${plural(previous.length, "product")} as ${previous.length === 1 ? "a draft" : "drafts"}`, {
      action: { label: "Undo", onClick: () => restoreProductStatuses(previous) },
    })
  }

  async function copy(p: Product) {
    if (live) {
      const dto = liveDtos.get(p.id)
      if (!dto) {
        toast.error("This product isn't in the catalogue anymore.")
        return
      }
      try {
        const titles = new Set(products.map((product) => product.name.toLowerCase()))
        const skus = new Set(products.flatMap((product) => product.variants.map((variant) => variant.sku.toUpperCase())))
        const result = await api<StudioProductResponse>("/api/studio/catalog/products", { body: duplicateProductBody(dto, titles, skus) })
        await liveProducts.revalidate()
        toast.success("Copy saved as a draft", {
          description: `${result.product.title}. Photos and options are copied; stock starts at 0.`,
          action: { label: "Open", onClick: () => router.push(`/studio/products/${result.product.id}`) },
        })
      } catch (cause) {
        toast.error("Couldn't duplicate this product", { description: cause instanceof ApiError ? cause.message : "Try again in a moment." })
      }
      return
    }
    const made = duplicate(p)
    toast.success("Copy saved as a draft", {
      description: `${made.name}. Photos and options are copied; stock starts at 0.`,
      action: { label: "Open", onClick: () => router.push(`/studio/products/${made.id}`) },
    })
  }

  function remove(p: Product) {
    if (live) {
      void archive([p])
      return
    }
    if (ordered.has(p.id)) {
      void archive([p])
      return
    }
    if (!useStudio.getState().removeProduct(p.id)) {
      toast.error("This product couldn't be deleted", { description: "It has orders now, so it was kept. Archive it instead to set it aside." })
      return
    }
    toast.success("Product deleted", { description: `${p.name} was removed from your catalogue.` })
  }

  /* ---------- table ---------- */

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      sortValue: (p) => p.name.toLowerCase(),
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb image={p.images[0]} />
          <span className="grid min-w-0 gap-0.5">
            <Link href={`/studio/products/${p.id}`} className="line-clamp-2 rounded-sm font-medium break-words text-ink outline-none hover:text-violet focus-visible:ring-2 focus-visible:ring-violet sm:line-clamp-1">
              {p.name}
            </Link>
            <span className="truncate text-xs text-ink-3 max-sm:hidden">
              {categoryBySlug.get(p.category)?.name ?? p.category}, {p.subcategory}
            </span>
            {/* Phones: status, price and stock ride under the name, since their columns are hidden. */}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2 sm:hidden">
              <span className="text-ink tabular">{formatMoney(p.price, p.currency)}</span>
              <ProductStock available={totalAvailable(p)} />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
              <StatusBadge tone={productStatusMeta[p.status].tone}>{productStatusMeta[p.status].label}</StatusBadge>
              {p.status === "scheduled" && p.publishAt ? <ScheduledAt at={p.publishAt} now={now} /> : null}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      sortValue: (p) => statusRank[p.status],
      cell: (p) => {
        const meta = productStatusMeta[p.status]
        return (
          <span className="grid justify-items-start gap-1">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {p.status === "scheduled" && p.publishAt ? <ScheduledAt at={p.publishAt} now={now} /> : null}
          </span>
        )
      },
    },
    {
      key: "stock",
      header: "Stock",
      hideBelow: "sm",
      sortValue: (p) => totalAvailable(p),
      cell: (p) => (
        <span className="grid gap-0.5">
          <ProductStock available={totalAvailable(p)} />
          <span className="text-xs text-ink-3">{plural(p.variants.length, "variant")}</span>
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      hideBelow: "sm",
      sortValue: (p) => p.price,
      cell: (p) => (
        <span className="whitespace-nowrap">
          <span className="text-ink">{formatMoney(p.price, p.currency)}</span>
          {p.compareAt ? <span className="block text-xs text-ink-3 line-through">{formatMoney(p.compareAt, p.currency)}</span> : null}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "md",
      sortValue: (p) => productUpdatedAt(p),
      cell: (p) => <span className="whitespace-nowrap text-ink-2">{now ? relativeDay(productUpdatedAt(p), now) : null}</span>,
    },
  ]

  // An archived product offers Restore in place of Archive, in every tab.
  const rowActions: RowAction<Product>[] = [
    { label: "Edit", icon: Pencil, onSelect: (p) => router.push(`/studio/products/${p.id}`) },
    { label: "Duplicate", icon: Copy, onSelect: (p) => void copy(p) },
    { label: "Publish", icon: Send, onSelect: (p) => void publish([p]), hidden: () => tab === "archived", disabled: (p) => p.status === "published", disabledReason: () => "Already published.", separatorBefore: true },
    { label: "Restore as draft", icon: Restore, onSelect: (p) => void restore([p]), hidden: (p) => p.status !== "archived" },
    { label: "Archive", icon: Archive, onSelect: (p) => void askArchive([p]), hidden: (p) => p.status === "archived" },
    { label: "Delete", icon: Trash, onSelect: setDeleting, destructive: true, hidden: () => live, separatorBefore: true },
  ]

  const notPublished = (p: Product) => p.status !== "published"
  const bulkPublish: BulkAction<Product> = { label: "Publish", onSelect: publish, appliesTo: notPublished, disabledReason: "The selected products are already published." }
  const bulkActions: BulkAction<Product>[] =
    tab === "archived"
      ? [{ label: "Restore as drafts", onSelect: restore, appliesTo: (p) => p.status === "archived", disabledReason: "None of the selected products is archived." }, bulkPublish]
      : [bulkPublish, { label: "Archive", onSelect: askArchive, appliesTo: (p) => p.status !== "archived", disabledReason: "The selected products are already archived." }]

  const empty =
    category !== "all"
      ? {
          title: `No ${tab === "all" ? "" : `${productStatusMeta[tab].label.toLowerCase()} `}products in ${categoryBySlug.get(category)?.name ?? "this category"}`,
          body: "Try another category, or show every category.",
          action: <Button size="sm" variant="secondary" onClick={() => setCategory("all")}>Show all categories</Button>,
        }
      : {
          ...emptyTab[tab],
          action: <Button size="sm" variant="secondary" onClick={() => setTab("all")}>Show all products</Button>,
        }

  const shownArchiving = useLastNonNull(archiving)
  const shownDeleting = useLastNonNull(deleting)
  const deletingHasOrders = !!shownDeleting && ordered.has(shownDeleting.id)
  const archiveCount = shownArchiving?.length ?? 0
  /** When the row that opened a dialog has left the list, focus lands on the selected tab. */
  const toTab = selectedTabFor("product-list")
  /**
   * After a confirmed bulk Archive, focus lands where the table puts it after a bulk Publish: on
   * the selection bar while rows the search hid stay selected, otherwise on select-all.
   */
  const toSelectAll = () => bulkBarControl(document.getElementById("product-list")) ?? document.querySelector<HTMLElement>("#product-list [data-select-all]:not([disabled])") ?? toTab()

  return (
    <div className="grid gap-6">
      <PageHeader
        title={productsCopy.title}
        description={productsCopy.description}
        actions={
          <Button asChild variant="primary" size="sm" className="h-10 md:h-8">
            <Link href="/studio/products/new"><Plus /> Add product</Link>
          </Button>
        }
      >
        <CatalogueNote className="mt-3">{live ? "Changes here are saved to this brand's live catalogue and reach shoppers straight away." : undefined}</CatalogueNote>
      </PageHeader>

      {loadError ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-danger">{loadError}</p>
          <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => void liveProducts.revalidate()}>Try again</Button>
        </div>
      ) : ready && products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Add your first product"
          body="Add photos, a price and the sizes you stock. It stays a draft until you publish it."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/studio/products/new"><Plus /> Add product</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          <StatusTabs id="product-status" label="Product status" value={tab} onChange={setTab} controls="product-list" tabs={tabOrder.map((t) => ({ ...t, count: ready ? counts[t.value] : undefined }))} />
          <section id="product-list" aria-label="Products" aria-busy={!ready}>
            <DataTable
              label="Products"
              rows={ready ? rows : []}
              columns={columns}
              getId={(p) => p.id}
              loading={!ready}
              search={{ placeholder: "Search by name, tag or SKU", text: (p) => [p.name, p.subcategory, ...p.tags, ...p.variants.map((v) => v.sku)].join(" ") }}
              toolbar={
                <div className="flex w-full gap-2 sm:w-auto">
                  <Select value={category} onValueChange={(v) => setCategory(v as CategorySlug | "all")}>
                    <SelectTrigger aria-label="Category" className={cn("min-w-0 flex-1 sm:w-48 sm:flex-none", "data-[size=default]:h-9")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">All categories</SelectItem>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <PhoneSort value={sort} onChange={setSort} options={sortOptions} className="shrink-0" />
                </div>
              }
              rowActions={rowActions}
              bulkActions={bulkActions}
              empty={empty}
              minWidth={340}
            />
          </section>
        </div>
      )}

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => {
          if (o) return
          answerArchive(false)
          setArchiving(null)
        }}
        title={archiveCount === 1 ? `Archive ${shownArchiving![0].name}?` : `Archive ${plural(archiveCount, "product")}?`}
        body={`${archiveCount === 1 ? "It moves" : "They move"} to the Archived tab and out of your inventory list. Orders and stock history stay, and you can restore ${archiveCount === 1 ? "it" : "them"} at any time.`}
        confirmLabel={archiveCount === 1 ? "Archive product" : `Archive ${plural(archiveCount, "product")}`}
        onConfirm={() => {
          if (archiving) void archive(archiving)
          answerArchive(true)
        }}
        returnFocus={toSelectAll}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone={deletingHasOrders ? "secondary" : "destructive"}
        title={deletingHasOrders ? "This product has orders" : `Delete ${shownDeleting?.name ?? "product"}?`}
        body={
          deletingHasOrders
            ? "Products that have been ordered can't be deleted, so order records stay complete. Archive it instead: it moves to the Archived tab and its history stays."
            : "It's removed from your Studio catalogue, collections and inventory for good. This can't be undone."
        }
        confirmLabel={deletingHasOrders ? "Archive instead" : "Delete product"}
        onConfirm={() => deleting && remove(deleting)}
        returnFocus={toTab}
      />
    </div>
  )
}

/**
 * When a scheduled product goes live. Nothing publishes on a timer until the backend exists,
 * so a time that has passed says so in acid instead of implying the product is live.
 */
function ScheduledAt({ at, now }: { at: string; now: number | null }) {
  const due = now !== null && Date.parse(at) <= now
  if (due) return <span className="text-[11px] whitespace-nowrap text-acid">Time passed, not published</span>
  return <span className="text-[11px] whitespace-nowrap text-ink-3 tabular">{formatDateTime(at)}</span>
}
