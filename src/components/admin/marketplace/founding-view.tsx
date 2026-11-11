"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowSquareOutIcon, EyeIcon, LinkSimpleIcon, PlusIcon, SealIcon, TrashSimpleIcon } from "@phosphor-icons/react"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { AdminImg } from "@/components/admin/trust/shared"
import { PanelError } from "@/components/admin/ui/panel"
import { Button } from "@/components/ui/button"
import { useAsyncAction } from "@/hooks/use-async-action"
import type { FoundingBrandRow } from "@/lib/api/contracts/founding"
import { errorMessage } from "@/lib/api/errors"
import { foundingKeys, listFoundingBrands, openSetupSession, revokeClaimLink, updateFoundingBrand, type FoundingListDto } from "@/lib/api/founding"
import { useApi } from "@/lib/api/use-api"
import { formatNumber } from "@/lib/money"
import { afterIdentityChange } from "@/lib/session/identity"
import { Initials } from "./bits"
import { FoundingDetail, foundingStatusMeta } from "./founding-detail"
import { countryName, formatDate, formatDateTime } from "./format"
import { useSearchParam, writeParams } from "./url-state"

/**
 * Founding brands (owner only, brands.founding): the brands Yard creates and sets up itself before
 * each owner claims theirs. Server-paged, newest first, with "Load more". The open record (or the
 * create form, ?brand=new) lives in the URL, as the claim notification links to it.
 */
export function FoundingPanel({ phone }: { phone: boolean }) {
  const router = useRouter()
  const q = useApi<FoundingListDto>(foundingKeys.list, () => listFoundingBrands(), { refreshInterval: 60_000 })
  const target = useSearchParam("brand")
  // Later pages, loaded on request, and rows changed here since the list was read.
  const [more, setMore] = useState<{ items: FoundingBrandRow[]; cursor: string | null | undefined }>({ items: [], cursor: undefined })
  // A patch holds only until the list is read again (`base` is the list it was made against), so a
  // later refresh (a claim, a payout account) always wins over a row changed here earlier.
  const [patched, setPatched] = useState<Record<string, { row: FoundingBrandRow; base: FoundingListDto | undefined }>>({})
  const nextCursor = more.cursor === undefined ? (q.data?.nextCursor ?? null) : more.cursor

  const rows = useMemo(() => {
    const seen = new Set<string>()
    const out: FoundingBrandRow[] = []
    for (const r of [...(q.data?.items ?? []), ...more.items]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const p = patched[r.id]
      out.push(p && p.base === q.data ? p.row : r)
    }
    // A brand created here that the first page doesn't show yet goes on top.
    for (const p of Object.values(patched)) if (!seen.has(p.row.id)) out.unshift(p.row)
    return out
  }, [q.data, more.items, patched])

  const loadMore = useAsyncAction(
    async () => {
      if (!nextCursor) return
      const r = await listFoundingBrands(nextCursor)
      setMore((m) => ({ items: [...m.items, ...r.items], cursor: r.nextCursor }))
    },
    { error: "More founding brands couldn't be loaded. Try again.", errorToast: false },
  )

  const saved = (b: FoundingBrandRow) => {
    setPatched((p) => ({ ...p, [b.id]: { row: b, base: q.data } }))
    // Later pages aren't refetched, so the change is written into them directly.
    setMore((m) => (m.items.some((r) => r.id === b.id) ? { ...m, items: m.items.map((r) => (r.id === b.id ? b : r)) } : m))
    void q.revalidate()
  }
  const open = (b: FoundingBrandRow) => writeParams({ brand: b.id })

  async function setup(b: FoundingBrandRow) {
    try {
      await openSetupSession(b.id)
      await afterIdentityChange("studio")
      router.push("/studio/products")
    } catch (cause) {
      toast.error(errorMessage(cause, "Yard setup couldn't be opened. Try again."))
    }
  }
  async function revoke(b: FoundingBrandRow) {
    try {
      await revokeClaimLink(b.id)
      toast.success(`Claim link for ${b.name} revoked`)
      saved({ ...b, claimLink: null, status: b.status === "link_sent" ? "setting_up" : b.status })
    } catch (cause) {
      toast.error(errorMessage(cause, "The claim link couldn't be revoked. Try again."))
    }
  }
  async function toggleBadge(b: FoundingBrandRow) {
    try {
      const r = await updateFoundingBrand(b.id, { foundingBadge: !b.foundingBadge })
      saved(r.brand)
      toast.success(r.brand.foundingBadge ? `Founding badge on for ${b.name}` : `Founding badge off for ${b.name}`)
    } catch (cause) {
      toast.error(errorMessage(cause, "The badge couldn't be changed. Try again."))
    }
  }

  const columns: Column<FoundingBrandRow>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (b) => b.name.toLowerCase(),
      cell: (b) => (
        <button type="button" onClick={() => open(b)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          {b.logo ? <AdminImg src={b.logo.src} alt="" className="size-8 shrink-0 rounded-md border border-white/10" /> : <Initials name={b.name} />}
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink group-hover:text-violet">{b.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">
              <span className="sm:hidden">{foundingStatusMeta[b.status].label}</span>
              <span className="hidden sm:inline">@{b.handle}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "place", header: "Based in", hideBelow: "md", sortValue: (b) => `${countryName(b.country)} ${b.city}`, cell: (b) => <span className="whitespace-nowrap text-ink-2">{b.city}, {countryName(b.country)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (b) => ["setting_up", "link_sent", "claimed", "live"].indexOf(b.status), cell: (b) => <StatusBadge tone={foundingStatusMeta[b.status].tone}>{foundingStatusMeta[b.status].label}</StatusBadge> },
    {
      key: "link",
      header: "Claim",
      hideBelow: "lg",
      cell: (b) =>
        b.claimStatus === "claimed" ? (
          <span className="whitespace-nowrap text-ink-2">{b.claimedAt ? `Claimed ${formatDate(b.claimedAt)}` : "Claimed"}</span>
        ) : b.claimLink ? (
          <span className="block max-w-[220px] truncate text-ink-2" title={`${b.claimLink.email}, ${b.claimLink.status === "expired" ? "expired" : "expires"} ${formatDateTime(b.claimLink.expiresAt)}`}>
            {b.claimLink.status === "expired" ? "Expired: " : ""}
            {b.claimLink.email}
          </span>
        ) : (
          <span className="text-ink-3">No link</span>
        ),
    },
    { key: "products", header: "Products", align: "right", hideBelow: "lg", sortValue: (b) => b.products.published, cell: (b) => <span className="text-ink tabular">{b.products.published}/{b.products.total}</span> },
    { key: "badge", header: "Badge", hideBelow: "md", cell: (b) => (b.foundingBadge ? <StatusBadge tone="neutral">On</StatusBadge> : <StatusBadge tone="muted">Off</StatusBadge>) },
  ]

  const rowActions: RowAction<FoundingBrandRow>[] = [
    { label: "Open", icon: EyeIcon, onSelect: open },
    { label: "Open in Studio as Yard setup", icon: ArrowSquareOutIcon, separatorBefore: true, hidden: (b) => b.claimStatus === "claimed", disabled: (b) => b.reviewStatus === "suspended" || b.reviewStatus === "restricted", disabledReason: (b) => (b.reviewStatus === "suspended" || b.reviewStatus === "restricted" ? `Yard has ${b.reviewStatus} this brand.` : undefined), onSelect: (b) => void setup(b) },
    { label: "Send or re-send claim link", icon: LinkSimpleIcon, hidden: (b) => b.claimStatus === "claimed", onSelect: open },
    { label: "Revoke claim link", icon: TrashSimpleIcon, destructive: true, hidden: (b) => !b.claimLink || b.claimLink.status !== "pending" || b.claimStatus === "claimed", onSelect: (b) => void revoke(b) },
    { label: "Turn the Founding badge on or off", icon: SealIcon, separatorBefore: true, onSelect: (b) => void toggleBadge(b) },
  ]

  const loading = q.isLoading && !q.data
  const reviewing = target && target !== "new" ? rows.find((r) => r.id === target) : undefined

  return (
    <div className="grid gap-3">
      {q.error && !q.data ? <PanelError message={errorMessage(q.error, "Couldn't load founding brands.")} onRetry={() => void q.revalidate()} /> : null}
      <DataTable
        label="Founding brands"
        rows={rows}
        columns={columns}
        getId={(b) => b.id}
        loading={loading}
        search={{ placeholder: "Search founding brands, handles or emails", text: (b) => [b.name, b.handle, b.city, countryName(b.country), b.claimLink?.email ?? "", foundingStatusMeta[b.status].label].join(" ") }}
        toolbar={
          <Button type="button" size="sm" variant="primary" className="h-10 shrink-0 sm:h-9" onClick={() => writeParams({ brand: "new" })}>
            <PlusIcon /> {phone ? "New" : "Create founding brand"}
          </Button>
        }
        rowActions={rowActions}
        empty={{ title: "No founding brands yet", body: "Create the first brands yourself, set them up in Studio, then send each owner a claim link.", action: <Button size="sm" variant="secondary" onClick={() => writeParams({ brand: "new" })}>Create founding brand</Button> }}
        initialPageSize={25}
        minWidth={300}
      />
      {q.data ? (
        <div className="grid justify-items-center gap-2">
          {nextCursor ? <p className="text-center text-[12px] text-ink-3">Showing {formatNumber(rows.length)} founding brands, newest first.</p> : null}
          {nextCursor ? (
            <Button size="sm" variant="secondary" className="h-10 sm:h-9" loading={loadMore.pending} onClick={() => void loadMore.run()}>
              Load more founding brands
            </Button>
          ) : null}
          {loadMore.error ? <p role="alert" className="text-center text-[12px] text-danger">{loadMore.error}</p> : null}
        </div>
      ) : null}

      <FoundingDetail
        target={target}
        row={reviewing}
        open={!!target}
        onOpenChange={(o) => {
          if (!o) writeParams({ brand: null })
        }}
        onSaved={saved}
        onCreated={(b) => {
          saved(b)
          void q.revalidate()
          writeParams({ brand: b.id })
        }}
      />
    </div>
  )
}
