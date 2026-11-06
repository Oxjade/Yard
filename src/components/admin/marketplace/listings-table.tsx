"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowSquareOutIcon, ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { brandById, categories, products } from "@/lib/data"
import type { Product } from "@/lib/data/types"
import { useAdmin } from "@/lib/stores/admin"
import { amountIn } from "../finance/format"
import { Thumb } from "./bits"
import type { Decision } from "./decision"
import { Filters } from "./filters"
import { categoryName } from "./format"
import { listingStateMeta } from "./meta"
import { audienceLine, isStudioBrand, notifyListingDecision } from "./notify"
import { usePhone, useSearchParam, writeParams } from "./url-state"

export const RESTRICT_ACTION = "Restricted listing"
export const LIFT_ACTION = "Lifted listing restriction"

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

const plural = (n: number) => `${n} ${n === 1 ? "listing" : "listings"}`

/** Every listing on the marketplace, so Trust and Safety can restrict one without waiting for a report. */
export function ListingsTable({ ask, loading }: { ask: (d: Decision) => void; loading: boolean }) {
  const router = useRouter()
  const phone = usePhone()
  const moderation = useAdmin((s) => s.moderation)
  const restricted = useRestrictedListings()
  // The category filter lives in the URL (?category=…) like the tab, so a reload keeps it.
  const linkedCategory = useSearchParam("category")
  const category = linkedCategory && categories.some((c) => c.slug === linkedCategory) ? linkedCategory : "all"
  const setCategory = (v: string) => writeParams({ category: v === "all" ? null : v })

  const removed = useMemo(() => new Set(moderation.filter((m) => m.status === "removed" && m.productId).map((m) => m.productId!)), [moderation])
  const rows = useMemo(() => products.filter((p) => category === "all" || p.category === category).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name)), [category])
  const isRestricted = (p: Product) => restricted.has(listingTarget(p))

  function decide(lift: boolean, list: Product[]) {
    const items = list.filter((p) => !removed.has(p.id) && isRestricted(p) === lift)
    if (!items.length) {
      const n = list.length
      toast.info(
        lift
          ? n === 1 ? "The selected listing isn't restricted, so no restriction was lifted." : `None of the ${n} selected listings is restricted, so no restriction was lifted.`
          : n === 1 ? "The selected listing is already restricted or removed, so nothing was restricted." : `All ${n} selected listings are already restricted or removed, so nothing was restricted.`,
      )
      return
    }
    const one = items.length === 1 ? items[0] : null
    const skipped = list.length - items.length
    // The Studio brand's merchant is the one reader outside the Control Center in this build.
    const studio = items.map((p) => brandById.get(p.brandId)).find((b) => b && isStudioBrand(b))
    ask({
      title: lift ? (one ? `Lift the restriction on ${one.name}?` : `Lift the restriction on ${plural(items.length)}?`) : one ? `Restrict ${one.name}?` : `Restrict ${plural(items.length)}?`,
      description: [
        lift ? "Lifted listings can show in discovery, search and the brand's storefront again." : "Restricted listings are held back from discovery, search and the storefront and can't be bought. The brand keeps them in Studio.",
        studio ? audienceLine(studio.name, "in Studio") : null,
        skipped ? `${plural(skipped)} selected ${skipped === 1 ? "is" : "are"} already ${lift ? "unrestricted" : "restricted"} or removed and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: lift ? (one ? "Lift restriction" : `Lift ${plural(items.length)}`) : one ? "Restrict listing" : `Restrict ${plural(items.length)}`,
      destructive: !lift,
      run: (reason) => {
        const log = useAdmin.getState().log
        for (const p of items) {
          log(lift ? LIFT_ACTION : RESTRICT_ACTION, listingTarget(p), reason)
          notifyListingDecision({ id: p.brandId, name: brandById.get(p.brandId)?.name ?? "" }, p.name, lift ? "lifted" : "restricted", reason)
        }
        toast.success(lift ? (one ? "Restriction lifted" : `${plural(items.length)} lifted`) : one ? "Listing restricted" : `${plural(items.length)} restricted`, { description: one ? `${one.name}. Recorded in the audit log.` : "Recorded in the audit log with your reason." })
      },
    })
  }

  function stateBadge(p: Product) {
    const state = removed.has(p.id) ? listingStateMeta.removed : isRestricted(p) ? listingStateMeta.restricted : null
    if (state) return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
    const meta = productStatusMeta[p.status]
    return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
  }

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      sortValue: (p) => p.name.toLowerCase(),
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Thumb src={p.images[0]?.src} />
          <span className="min-w-0">
            {/* The hit area reaches 40px tall on phones without moving the line below. */}
            <Link href={`/products/${p.slug}`} className="relative block max-w-[36vw] font-medium text-ink before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-violet sm:max-w-[220px] sm:before:-inset-y-1">
              <span className="block truncate">{p.name}</span>
            </Link>
            <span className="block max-w-[36vw] sm:max-w-[220px] truncate text-[11.5px] text-ink-3">
              <span className="sm:hidden">{removed.has(p.id) ? "Removed, " : isRestricted(p) ? "Restricted, " : ""}{amountIn(p.price, p.currency)}, </span>
              <span className="md:hidden">{brandById.get(p.brandId)?.name}</span>
              <span className="hidden md:inline">{p.subcategory}</span>
            </span>
          </span>
        </span>
      ),
    },
    { key: "brand", header: "Brand", hideBelow: "md", sortValue: (p) => brandById.get(p.brandId)?.name ?? "", cell: (p) => <span className="whitespace-nowrap text-ink-2">{brandById.get(p.brandId)?.name}</span> },
    { key: "category", header: "Category", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap text-ink-2">{categoryName(p.category)}</span> },
    { key: "price", header: "Price", align: "right", hideBelow: "sm", sortValue: (p) => p.price, cell: (p) => <span className="whitespace-nowrap text-ink tabular">{amountIn(p.price, p.currency)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (p) => (removed.has(p.id) ? 0 : isRestricted(p) ? 1 : 2), cell: stateBadge },
  ]

  const rowActions: RowAction<Product>[] = [
    { label: "View listing", icon: ArrowSquareOutIcon, onSelect: (p) => router.push(`/products/${p.slug}`) },
    { label: "Restrict listing", icon: ShieldWarningIcon, destructive: true, separatorBefore: true, disabled: (p) => removed.has(p.id) || isRestricted(p), onSelect: (p) => decide(false, [p]) },
    { label: "Lift restriction", icon: ShieldCheckIcon, disabled: (p) => removed.has(p.id) || !isRestricted(p), onSelect: (p) => decide(true, [p]) },
  ]
  const bulkActions: BulkAction<Product>[] = [
    { label: "Restrict", destructive: true, onSelect: (list) => decide(false, list) },
    { label: "Lift restriction", onSelect: (list) => decide(true, list) },
  ]

  return (
    <DataTable
      label="All listings"
      rows={rows}
      columns={columns}
      getId={(p) => p.id}
      loading={loading}
      search={{ placeholder: "Search products or brands", text: (p) => `${p.name} ${brandById.get(p.brandId)?.name ?? ""} ${p.subcategory}` }}
      toolbar={
        <Filters
          noun="listings"
          results={rows.length}
          onClear={() => setCategory("all")}
          filters={[{ key: "category", label: "Category", value: category, onChange: setCategory, all: { value: "all", label: "All categories" }, options: categories.map((c) => ({ value: c.slug, label: c.name })), width: "w-[176px]" }]}
        />
      }
      rowActions={rowActions}
      bulkActions={phone ? undefined : bulkActions}
      empty={{ title: "No listings in this category", body: "Choose another category, or show them all." }}
      initialPageSize={25}
      minWidth={300}
    />
  )
}
