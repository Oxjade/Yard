"use client"

import { useMemo } from "react"
import { EyeIcon, EyeSlashIcon, RocketLaunchIcon, TrashIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { errorMessage } from "@/lib/api/errors"
import type { AdminBrandRowDto, AdminBrandStatusFilter } from "@/lib/api/contracts/admin-brands"
import { ADMIN_BRAND_STATUS_FILTERS } from "@/lib/api/contracts/admin-brands"
import type { BrandApplication } from "@/lib/data/admin"
import { Initials } from "./bits"
import { applicationLabel, applicationState, brandFilterOptions, brandRowToApplication, matchesBrandFilter, openTargetFor } from "./all-brands"
import { allowedBrandActions, brandActions, type BrandActionKey } from "./brand-actions"
import { Filters } from "./filters"
import { categoryName, countryName, formatDate } from "./format"
import { brandStatusMeta } from "./meta"
import { useSearchParam, writeParams } from "./url-state"

const ACTION_ORDER: BrandActionKey[] = ["approve", "reject", "verify", "restrict", "suspend", "reinstate"]
const isFilter = (v: string | null): v is AdminBrandStatusFilter => !!v && (ADMIN_BRAND_STATUS_FILTERS as readonly string[]).includes(v)

/**
 * Admin › Brands › All brands: every brand in the brands table (GET /api/admin/brands), so a brand
 * with a draft, rejected or no application, a closed brand and a founding brand can all be found,
 * opened and deleted. The row menu is the queue's: open, the decisions the brand's status allows,
 * and Delete brand (owner admins).
 */
export function AllBrandsPanel({
  brands,
  loading,
  error,
  onRetry,
  queue,
  phone,
  canDelete,
  blockFor,
  onDecide,
  onDelete,
  onStorefront,
}: {
  brands: AdminBrandRowDto[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  /** The review queue's applications: a brand listed there opens (and is decided) as that application. */
  queue: BrandApplication[]
  phone: boolean
  canDelete: boolean
  blockFor: (a: BrandApplication) => string | undefined
  onDecide: (key: BrandActionKey, a: BrandApplication) => void
  onDelete: (row: AdminBrandRowDto) => void
  /** Publish / Unpublish storefront (storefront-dialog.tsx), for any brand that isn't closed. */
  onStorefront?: (row: AdminBrandRowDto, action: "publish" | "unpublish") => void
}) {
  const param = useSearchParam("status")
  const filter: AdminBrandStatusFilter = isFilter(param) ? param : "all"
  const setFilter = (v: string) => writeParams({ status: v === "all" ? null : v })

  const rows = useMemo(() => (brands ?? []).filter((b) => matchesBrandFilter(b, filter)), [brands, filter])
  /** The record a row opens and is decided as: its queue application when listed, else the brand itself. */
  const recordFor = (b: AdminBrandRowDto) => queue.find((a) => a.brandId === b.id) ?? brandRowToApplication(b)
  const open = (b: AdminBrandRowDto) => writeParams({ review: openTargetFor(b, queue) })

  const columns: Column<AdminBrandRowDto>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (b) => b.name.toLowerCase(),
      cell: (b) => (
        <button type="button" onClick={() => open(b)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <Initials name={b.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink group-hover:text-violet">{b.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">@{b.handle}</span>
          </span>
        </button>
      ),
    },
    { key: "country", header: "Country", hideBelow: "md", sortValue: (b) => countryName(b.country), cell: (b) => <span className="whitespace-nowrap text-ink-2">{countryName(b.country)}</span> },
    { key: "category", header: "Category", hideBelow: "lg", cell: (b) => <span className="whitespace-nowrap text-ink-2">{b.category ? categoryName(b.category) : "—"}</span> },
    {
      key: "status",
      header: "Status",
      sortValue: (b) => (b.closedAt ? "z" : b.reviewStatus),
      cell: (b) => (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-1">
            {b.closedAt ? <StatusBadge tone="danger">Closed</StatusBadge> : <StatusBadge tone={brandStatusMeta[b.reviewStatus].tone}>{brandStatusMeta[b.reviewStatus].label}</StatusBadge>}
            {b.founding ? <StatusBadge tone="info">Founding</StatusBadge> : null}
            {b.storefront?.unpublished && !b.closedAt ? <StatusBadge tone="attention">Unpublished</StatusBadge> : null}
            {b.storefront?.claimedNotLive ? <StatusBadge tone="attention">Claimed, not live yet</StatusBadge> : null}
          </span>
          <span className="text-[11.5px] whitespace-nowrap text-ink-3">{applicationLabel[applicationState(b)]}</span>
        </span>
      ),
    },
    { key: "since", header: "Since", hideBelow: "md", sortValue: (b) => b.since ?? "", cell: (b) => (b.since ? <time dateTime={b.since} className="whitespace-nowrap text-ink-2">{formatDate(b.since)}</time> : <span className="text-ink-3">—</span>) },
    { key: "products", header: "Products", align: "right", hideBelow: "sm", sortValue: (b) => b.products, cell: (b) => <span className="text-ink tabular">{b.products}</span> },
  ]

  const rowActions: RowAction<AdminBrandRowDto>[] = [
    { label: "Open brand", icon: EyeIcon, onSelect: open },
    ...ACTION_ORDER.map((key, i) => ({
      label: brandActions[key].label,
      icon: brandActions[key].icon,
      destructive: brandActions[key].destructive,
      separatorBefore: i === 0,
      hidden: (b: AdminBrandRowDto) => !allowedBrandActions(recordFor(b)).includes(key),
      disabled: (b: AdminBrandRowDto) => !!blockFor(recordFor(b)),
      disabledReason: (b: AdminBrandRowDto) => blockFor(recordFor(b)),
      onSelect: (b: AdminBrandRowDto) => onDecide(key, recordFor(b)),
    })),
    ...(onStorefront
      ? [
          { label: "Make live", icon: RocketLaunchIcon, separatorBefore: true, hidden: (b: AdminBrandRowDto) => !b.storefront?.claimedNotLive, onSelect: (b: AdminBrandRowDto) => onStorefront(b, "publish") },
          { label: "Publish storefront", icon: RocketLaunchIcon, separatorBefore: true, hidden: (b: AdminBrandRowDto) => !!b.closedAt || !!b.storefront?.live || !!b.storefront?.claimedNotLive, onSelect: (b: AdminBrandRowDto) => onStorefront(b, "publish") },
          { label: "Unpublish storefront", icon: EyeSlashIcon, hidden: (b: AdminBrandRowDto) => !!b.closedAt || !b.storefront?.live, onSelect: (b: AdminBrandRowDto) => onStorefront(b, "unpublish") },
        ]
      : []),
    { label: "Delete brand", icon: TrashIcon, destructive: true, separatorBefore: true, hidden: (b) => !canDelete || !!b.closedAt, onSelect: onDelete },
  ]

  return (
    <DataTable
      label="All brands"
      rows={rows}
      columns={columns}
      getId={(b) => b.id}
      loading={loading}
      error={error ? errorMessage(error) : null}
      onRetry={onRetry}
      search={{ placeholder: "Search brands, handles or countries", text: (b) => [b.name, b.handle, b.city, b.country, countryName(b.country), b.category ? categoryName(b.category) : ""].join(" ") }}
      toolbar={
        <Filters
          noun="brands"
          results={rows.length}
          onClear={() => writeParams({ status: null })}
          filters={[{ key: "status", label: "Status", value: filter, onChange: setFilter, all: { value: "all", label: "All statuses" }, options: brandFilterOptions, width: "w-[184px]" }]}
        />
      }
      rowActions={rowActions}
      empty={
        filter !== "all"
          ? { title: "No brands match", body: "Try another status.", action: <Button size="sm" variant="secondary" onClick={() => writeParams({ status: null })}>Show every status</Button> }
          : { title: "No brands yet", body: "Every brand on Yard is listed here, whatever its application says." }
      }
      initialPageSize={25}
      pageSizes={phone ? [10, 25] : [10, 25, 50]}
      minWidth={300}
    />
  )
}
