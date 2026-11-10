"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowSquareOutIcon, ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { adminKeys, listAdminCatalogProducts, moderateProduct } from "@/lib/api/admin"
import type { AdminCatalogProductDto } from "@/lib/api/contracts/admin"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { categories } from "@/lib/data"
import { formatMoney } from "@/lib/money"
import { canAdmin, needsRole } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { Thumb } from "./bits"
import type { Decision } from "./decision"
import { Filters } from "./filters"
import { categoryName } from "./format"
import { listingStateMeta } from "./meta"
import { usePhone, useSearchParam, writeParams } from "./url-state"
import { NO_ADMIN_SESSION } from "./user-actions"

const plural = (n: number) => `${n} ${n === 1 ? "listing" : "listings"}`

/** Live catalogue rows for moderation, plus why this admin can't change them (if so). */
export function useAdminListings() {
  const admin = useServerSession((s) => s.admin)
  const loading = useServerSession((s) => s.status === "loading")
  const blocked = loading ? "Checking your admin session." : !admin ? NO_ADMIN_SESSION : canAdmin(admin.role, "content.moderate") ? null : needsRole("content.moderate")
  const q = useApi(blocked ? null : adminKeys.catalogProducts, listAdminCatalogProducts, { refreshInterval: 60_000 })
  return { ...q, blocked, authLoading: loading }
}

/** Every listing in the live catalogue, including hidden ones, so Trust and Safety can restrict any product. */
export function ListingsTable({ ask, loading }: { ask: (d: Decision) => void | Promise<boolean>; loading: boolean }) {
  const router = useRouter()
  const phone = usePhone()
  const q = useAdminListings()
  const products = q.data?.products
  // The category filter lives in the URL (?category=…) like the tab, so a reload keeps it.
  const linkedCategory = useSearchParam("category")
  const category = linkedCategory && categories.some((c) => c.slug === linkedCategory) ? linkedCategory : "all"
  const setCategory = (v: string) => writeParams({ category: v === "all" ? null : v })

  const rows = useMemo(() => (products ?? []).filter((p) => category === "all" || p.category === category).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title)), [products, category])
  const isRestricted = (p: AdminCatalogProductDto) => p.moderationStatus === "hidden"
  /** Whether restricting (lift false) or lifting (lift true) can change this listing. */
  const can = (lift: boolean) => (p: AdminCatalogProductDto) => isRestricted(p) === lift

  function decide(lift: boolean, list: AdminCatalogProductDto[]) {
    const items = list.filter(can(lift))
    if (!items.length) return false
    const one = items.length === 1 ? items[0] : null
    const skipped = list.length - items.length
    return ask({
      title: lift ? (one ? `Lift the restriction on ${one.title}?` : `Lift the restriction on ${plural(items.length)}?`) : one ? `Restrict ${one.title}?` : `Restrict ${plural(items.length)}?`,
      description: [
        lift ? "Lifted listings can show in discovery, search and the brand's storefront again." : "Restricted listings are held back from discovery, search and the storefront and can't be bought. The brand keeps them in Studio.",
        skipped ? `${plural(skipped)} selected ${skipped === 1 ? "is" : "are"} already ${lift ? "unrestricted" : "restricted"} and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: lift ? (one ? "Lift restriction" : `Lift ${plural(items.length)}`) : one ? "Restrict listing" : `Restrict ${plural(items.length)}`,
      destructive: !lift,
      run: async (reason) => {
        let done = 0
        let failure: unknown = null
        for (const p of items) {
          try {
            await moderateProduct(p.id, { hidden: !lift, reason })
            done++
          } catch (e) {
            failure = e
            break
          }
        }
        revalidatePrefix("admin:")
        if (failure && !done) throw failure
        if (failure) toast.error(`${plural(done)} ${lift ? "lifted" : "restricted"}; the rest didn't go through`, { description: errorMessage(failure) })
        else
          toast.success(lift ? (one ? "Restriction lifted" : `${plural(items.length)} lifted`) : one ? "Listing restricted" : `${plural(items.length)} restricted`, {
            description: one ? `${one.title}. Recorded in the audit log.` : "Recorded in the audit log with your reason.",
          })
      },
    })
  }

  function stateBadge(p: AdminCatalogProductDto) {
    if (isRestricted(p)) return <StatusBadge tone={listingStateMeta.restricted.tone}>{listingStateMeta.restricted.label}</StatusBadge>
    const meta = productStatusMeta[p.status] ?? { label: p.status, tone: "muted" as const }
    return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
  }

  const columns: Column<AdminCatalogProductDto>[] = [
    {
      key: "product",
      header: "Product",
      sortValue: (p) => p.title.toLowerCase(),
      cell: (p) => {
        const viewable = p.status === "published" && !isRestricted(p)
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <Thumb src={p.imageSrc ?? undefined} />
            <span className="min-w-0">
              {viewable ? (
                <Link href={`/products/${p.slug}`} className="relative block max-w-[36vw] font-medium text-ink before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-violet sm:max-w-[220px] sm:before:-inset-y-1">
                  <span className="block truncate">{p.title}</span>
                </Link>
              ) : (
                <span className="block max-w-[36vw] truncate font-medium text-ink sm:max-w-[220px]">{p.title}</span>
              )}
              <span className="block max-w-[36vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">
                <span className="sm:hidden">{isRestricted(p) ? "Restricted, " : ""}{formatMoney(p.priceMinor, p.currency)}, </span>
                <span className="md:hidden">{p.brandName}</span>
                <span className="hidden md:inline">{p.subcategory ?? categoryName(p.category)}</span>
              </span>
            </span>
          </span>
        )
      },
    },
    { key: "brand", header: "Brand", hideBelow: "md", sortValue: (p) => p.brandName, cell: (p) => <span className="whitespace-nowrap text-ink-2">{p.brandName}</span> },
    { key: "category", header: "Category", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap text-ink-2">{categoryName(p.category)}</span> },
    { key: "price", header: "Price", align: "right", hideBelow: "sm", sortValue: (p) => p.priceMinor, cell: (p) => <span className="whitespace-nowrap text-ink tabular">{formatMoney(p.priceMinor, p.currency)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (p) => (isRestricted(p) ? 0 : 1), cell: stateBadge },
  ]

  const rowActions: RowAction<AdminCatalogProductDto>[] = [
    { label: "View listing", icon: ArrowSquareOutIcon, hidden: (p) => p.status !== "published" || isRestricted(p), onSelect: (p) => router.push(`/products/${p.slug}`) },
    {
      label: "Restrict listing",
      icon: ShieldWarningIcon,
      destructive: true,
      separatorBefore: true,
      disabled: (p) => !!q.blocked || !can(false)(p),
      disabledReason: (p) => q.blocked ?? (isRestricted(p) ? "Already restricted." : "This listing can't be restricted."),
      onSelect: (p) => decide(false, [p]),
    },
    {
      label: "Lift restriction",
      icon: ShieldCheckIcon,
      disabled: (p) => !!q.blocked || !can(true)(p),
      disabledReason: (p) => q.blocked ?? (isRestricted(p) ? "This listing can't be lifted." : "It isn't restricted."),
      onSelect: (p) => decide(true, [p]),
    },
  ]
  const bulkActions: BulkAction<AdminCatalogProductDto>[] = [
    {
      label: "Restrict",
      destructive: true,
      appliesTo: (p) => !q.blocked && can(false)(p),
      disabledReason: q.blocked ?? "The selected listings are already restricted.",
      onSelect: (list) => decide(false, list),
    },
    {
      label: "Lift restriction",
      appliesTo: (p) => !q.blocked && can(true)(p),
      disabledReason: q.blocked ?? "None of the selected listings is restricted.",
      onSelect: (list) => decide(true, list),
    },
  ]

  return (
    <DataTable
      label="All listings"
      rows={rows}
      columns={columns}
      getId={(p) => p.id}
      loading={loading || q.authLoading || q.isLoading}
      error={q.authLoading ? null : (q.blocked ?? (q.error ? errorMessage(q.error) : null))}
      onRetry={q.error ? () => void q.revalidate() : undefined}
      search={{ placeholder: "Search products or brands", text: (p) => `${p.title} ${p.brandName} ${p.subcategory ?? ""}` }}
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
