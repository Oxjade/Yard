"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { MagnifyingGlassMinusIcon as SearchX, ShieldWarningIcon as ShieldAlert, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { brandById, categories, products } from "@/lib/data"
import type { Product } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { DataTable, Pagination, SearchField, Thumb, type Column } from "./data-table"
import { categoryName } from "./format"
import { listingStateMeta } from "./meta"
import { ReasonDialog, type ReasonAction } from "./reason-dialog"

export const RESTRICT_ACTION = "Restricted listing"
export const LIFT_ACTION = "Lifted listing restriction"
const PAGE = 20

export const listingTarget = (p: Product) => `${p.name} (${brandById.get(p.brandId)?.name ?? p.brandId})`

/**
 * Listing restrictions are admin moderation, kept apart from the product's own lifecycle
 * status. In this phase they're derived from the audit log; the latest entry wins.
 */
export function useRestrictedListings() {
  const audit = useAdmin((s) => s.audit)
  return useMemo(() => {
    const state = new Map<string, boolean>()
    for (let i = audit.length - 1; i >= 0; i--) {
      const e = audit[i]
      if (e.action === RESTRICT_ACTION) state.set(e.target, true)
      else if (e.action === LIFT_ACTION) state.set(e.target, false)
    }
    return new Set([...state].filter(([, on]) => on).map(([t]) => t))
  }, [audit])
}

export function ListingsTable() {
  const log = useAdmin((s) => s.log)
  const moderation = useAdmin((s) => s.moderation)
  const restricted = useRestrictedListings()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [page, setPage] = useState(0)
  const [target, setTarget] = useState<{ product: Product; lift: boolean } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const q = query.trim().toLowerCase()

  const removed = useMemo(() => new Set(moderation.filter((m) => m.status === "removed" && m.productId).map((m) => m.productId!)), [moderation])

  const rows = useMemo(
    () =>
      products
        .filter((p) => (category === "all" || p.category === category) && (!q || `${p.name} ${brandById.get(p.brandId)?.name ?? ""} ${p.subcategory}`.toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name)),
    [category, q],
  )
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pageCount - 1)
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE)

  function ask(product: Product, lift: boolean) {
    setTarget({ product, lift })
    setDialogOpen(true)
  }

  async function confirm(reason: string) {
    if (!target) return
    const { product, lift } = target
    log(lift ? LIFT_ACTION : RESTRICT_ACTION, listingTarget(product), reason)
    toast(lift ? "Restriction lifted" : "Listing restricted", {
      description: lift ? `${product.name} shows in discovery and search again.` : `${product.name} is hidden from discovery and search.`,
    })
  }

  const action: ReasonAction | null = target
    ? target.lift
      ? {
          title: `Lift the restriction on ${target.product.name}?`,
          body: "The listing shows in discovery, search and the brand's storefront again.",
          confirmLabel: "Lift restriction",
          tone: "primary",
          presets: ["Brand corrected the listing", "Review found no breach", "Restricted in error"],
        }
      : {
          title: `Restrict ${target.product.name}?`,
          body: "The listing is hidden from discovery, search and the storefront and can't be bought. The brand keeps it in Studio and is told the reason.",
          confirmLabel: "Restrict listing",
          tone: "destructive",
          presets: ["Misleading description or photos", "Not allowed in key shipping countries", "Image rights unclear"],
        }
    : null

  function stateBadge(p: Product) {
    const state = removed.has(p.id) ? listingStateMeta.removed : restricted.has(listingTarget(p)) ? listingStateMeta.restricted : null
    if (state) return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
    const meta = productStatusMeta[p.status]
    return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
  }

  function actionButton(p: Product) {
    if (removed.has(p.id)) return <span className="text-[11px] text-ink-3">Closed by moderation</span>
    const isRestricted = restricted.has(listingTarget(p))
    return (
      <Button type="button" size="xs" variant="secondary" onClick={() => ask(p, isRestricted)} aria-label={`${isRestricted ? "Lift restriction on" : "Restrict"} ${p.name}`}>
        {isRestricted ? <ShieldCheck /> : <ShieldAlert />}
        {isRestricted ? "Lift" : "Restrict"}
      </Button>
    )
  }

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Thumb src={p.images[0]?.src} />
          <span className="min-w-0">
            <Link href={`/products/${p.slug}`} className="block truncate font-medium text-ink hover:text-violet">{p.name}</Link>
            <span className="block truncate text-[11px] text-ink-3">{p.subcategory}</span>
          </span>
        </span>
      ),
    },
    { key: "brand", header: "Brand", cell: (p) => <span className="whitespace-nowrap text-ink-2">{brandById.get(p.brandId)?.name}</span> },
    { key: "category", header: "Category", cell: (p) => <span className="whitespace-nowrap text-ink-2">{categoryName(p.category)}</span> },
    { key: "price", header: "Price", align: "right", cell: (p) => <span className="whitespace-nowrap text-ink">{formatMoney(p.price, p.currency)}</span> },
    { key: "status", header: "Status", cell: stateBadge },
    { key: "action", header: "Action", align: "right", cell: actionButton },
  ]

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-line-soft px-4 py-3 md:flex-row md:items-center md:justify-between">
        <p className="text-[11px] text-ink-3 tabular" aria-live="polite">
          {rows.length === products.length ? `${products.length} listings` : `${rows.length} of ${products.length} listings`}
          {restricted.size ? `, ${restricted.size} restricted` : ""}
        </p>
        <div className="flex items-center gap-2">
          <SearchField
            value={query}
            onChange={(v) => {
              setQuery(v)
              setPage(0)
            }}
            label="Search listings"
            placeholder="Product or brand"
            className="min-w-0 flex-1 md:flex-none"
          />
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v)
              setPage(0)
            }}
          >
            <SelectTrigger aria-label="Filter by category" className="h-8 w-[136px] shrink-0 rounded-md md:w-[156px] border-line bg-surface text-[13px] dark:bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visible.length ? (
        <>
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(p) => p.id}
            caption="All listings"
            minWidth={880}
            mobileRow={(p) => ({
              lead: <Thumb src={p.images[0]?.src} />,
              title: (
                <Link href={`/products/${p.slug}`} className="hover:text-violet">{p.name}</Link>
              ),
              meta: `${brandById.get(p.brandId)?.name}, ${formatMoney(p.price, p.currency)}`,
              // Published is the norm; on phones only a moderation state earns a badge.
              trail: (
                <>
                  {removed.has(p.id) || restricted.has(listingTarget(p)) ? stateBadge(p) : null}
                  {actionButton(p)}
                </>
              ),
            })}
          />
          <Pagination page={current} pageSize={PAGE} total={rows.length} onPage={setPage} noun="listings" />
        </>
      ) : (
        <EmptyState
          icon={SearchX}
          className="m-4"
          title="No listings match"
          body={q ? `Nothing matches “${query.trim()}”${category !== "all" ? ` in ${categoryName(category).toLowerCase()}` : ""}.` : "No listings in this category yet."}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuery("")
                setCategory("all")
                setPage(0)
              }}
            >
              Show all listings
            </Button>
          }
        />
      )}

      <ReasonDialog action={action} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={confirm} />
    </>
  )
}
