"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowSquareOutIcon, MagnifyingGlassIcon, ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { useAsyncAction } from "@/hooks/use-async-action"
import { adminKeys, listAdminCatalogProducts, moderateProduct, type AdminCatalogProductsFilter } from "@/lib/api/admin"
import type { AdminCatalogProductDto } from "@/lib/api/contracts/admin"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { categories } from "@/lib/data"
import { formatMoney, formatNumber } from "@/lib/money"
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

/**
 * The first page of live catalogue rows for moderation (server-filtered), plus why this admin
 * can't change them (if so). `data.total` and `data.hidden` count the whole catalogue.
 */
export function useAdminListings(filter: AdminCatalogProductsFilter = {}) {
  const admin = useServerSession((s) => s.admin)
  const loading = useServerSession((s) => s.status === "loading")
  const blocked = loading ? "Checking your admin session." : !admin ? NO_ADMIN_SESSION : canAdmin(admin.role, "content.moderate") ? null : needsRole("content.moderate")
  const key = adminKeys.catalogProducts(filter)
  const q = useApi(blocked ? null : key, () => listAdminCatalogProducts(filter), { refreshInterval: 60_000 })
  return { ...q, key, blocked, authLoading: loading }
}

/** The search once it has stopped changing for `ms`, so typing doesn't fire a request per key. */
function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

const STATES = [
  { value: "restricted", label: "Restricted" },
  { value: "live", label: "Not restricted" },
]

/** Every listing in the live catalogue, including hidden ones, so Trust and Safety can restrict any product. */
export function ListingsTable({ ask, loading }: { ask: (d: Decision) => void | Promise<boolean>; loading: boolean }) {
  const router = useRouter()
  const phone = usePhone()
  // The filters live in the URL (?category=…&state=…) like the tab, so a reload keeps them. The
  // server filters and pages, so a listing outside the newest page can still be found and lifted.
  const linkedCategory = useSearchParam("category")
  const category = linkedCategory && categories.some((c) => c.slug === linkedCategory) ? linkedCategory : "all"
  const setCategory = (v: string) => writeParams({ category: v === "all" ? null : v })
  const linkedState = useSearchParam("state")
  const state = STATES.some((o) => o.value === linkedState) ? linkedState! : "all"
  const setState = (v: string) => writeParams({ state: v === "all" ? null : v })
  const [search, setSearch] = useState("")
  const term = useDebounced(search.trim(), 300)
  const filter: AdminCatalogProductsFilter = { q: term || undefined, moderation: state === "restricted" ? "hidden" : state === "live" ? "ok" : undefined, category: category === "all" ? undefined : category }
  const q = useAdminListings(filter)

  // Further pages, loaded on request for this filter (undefined cursor = continue from the first page).
  const [more, setMore] = useState<{ key: string; items: AdminCatalogProductDto[]; cursor: string | null | undefined }>({ key: "", items: [], cursor: undefined })
  const moreHere = more.key === q.key ? more : { key: q.key, items: [] as AdminCatalogProductDto[], cursor: undefined }
  const nextCursor = moreHere.cursor === undefined ? (q.data?.nextCursor ?? null) : moreHere.cursor
  const loadMore = useAsyncAction(
    async () => {
      if (!nextCursor) return
      const r = await listAdminCatalogProducts({ ...filter, cursor: nextCursor })
      setMore({ key: q.key, items: [...moreHere.items, ...r.products], cursor: r.nextCursor })
    },
    { error: "Couldn't load more listings. Try again." },
  )

  const rows = useMemo(() => {
    const seen = new Set<string>()
    return [...(q.data?.products ?? []), ...moreHere.items].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  }, [q.data, moreHere.items])
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
            const r = await moderateProduct(p.id, { hidden: !lift, reason })
            // Rows from later pages aren't refetched by the revalidation below, so they take the new state here.
            setMore((m) => ({ ...m, items: m.items.map((x) => (x.id === r.productId ? { ...x, moderationStatus: r.moderationStatus } : x)) }))
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
    <DataTable
      label="All listings"
      rows={rows}
      columns={columns}
      getId={(p) => p.id}
      loading={loading || q.authLoading || q.isLoading}
      error={q.authLoading ? null : (q.blocked ?? (q.error ? errorMessage(q.error) : null))}
      onRetry={q.error ? () => void q.revalidate() : undefined}
      toolbar={
        <>
          {/* Searched on the server, so it covers the whole catalogue, not only the rows loaded. */}
          <label className="relative min-w-56 flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products or brands"
              aria-label="Search products or brands"
              className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-ink-2/40 focus:border-violet focus:ring-2 focus:ring-violet/25"
            />
          </label>
          <Filters
            noun="listings"
            results={q.data?.matching ?? rows.length}
            onClear={() => writeParams({ category: null, state: null })}
            filters={[
              { key: "state", label: "Status", value: state, onChange: setState, all: { value: "all", label: "All statuses" }, options: STATES, width: "w-[160px]" },
              { key: "category", label: "Category", value: category, onChange: setCategory, all: { value: "all", label: "All categories" }, options: categories.map((c) => ({ value: c.slug, label: c.name })), width: "w-[176px]" },
            ]}
          />
        </>
      }
      rowActions={rowActions}
      bulkActions={phone ? undefined : bulkActions}
      empty={
        term || state !== "all" || category !== "all"
          ? {
              title: "No listings match",
              body: "Try another search, status or category.",
              action: (
                <Button size="sm" variant="secondary" onClick={() => {
                    setSearch("")
                    writeParams({ category: null, state: null })
                  }}>
                  Clear search and filters
                </Button>
              ),
            }
          : { title: "No listings yet", body: "Products appear here once brands create them in Studio." }
      }
      initialPageSize={25}
      minWidth={300}
    />
    {q.data && !q.error ? (
      <div className="grid justify-items-center gap-2">
        {nextCursor ? <p className="text-center text-[12px] text-ink-3">Showing {formatNumber(rows.length)} of {formatNumber(q.data.matching)} {q.data.matching === 1 ? "listing" : "listings"}, newest edit first.</p> : null}
        {nextCursor ? (
          <Button size="sm" variant="secondary" className="h-10 sm:h-9" loading={loadMore.pending} onClick={() => void loadMore.run()}>
            Load more listings
          </Button>
        ) : null}
        {loadMore.error ? <p role="alert" className="text-center text-[12px] text-danger">{loadMore.error}</p> : null}
      </div>
    ) : null}
    </div>
  )
}
