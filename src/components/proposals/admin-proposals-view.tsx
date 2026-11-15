"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, SparkleIcon } from "@phosphor-icons/react"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { EmptyState } from "@/components/dashboard/empty-state"
import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { ActionBar, DetailSection, DetailSheet, Facts, LinkRow } from "@/components/admin/marketplace/detail-sheet"
import { formatDateTime } from "@/components/admin/marketplace/format"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { Segmented } from "@/components/admin/ui/segmented"
import { LoadError, ServerActivity, TrustGate, useAdminSession } from "@/components/admin/trust/shared"
import { Button } from "@/components/ui/button"
import type { ProposalStatus, ProposalSummaryDto } from "@/lib/api/contracts/proposals"
import { errorMessage } from "@/lib/api/errors"
import { getAdminProposal, listAdminProposals, withdrawAdminProposal } from "@/lib/api/proposals"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import { ProposalChangeList, ProposalStatusBadge, ProposalThumb, ProposedProduct } from "./proposal-parts"

/*
 * Admin › Products › Suggestions: what Yard suggested to brands (new products and changes), by
 * status. A row opens the detail panel: the product as it would look, before → after, and the
 * brand's answer. A waiting suggestion can be updated (replaces it) or withdrawn. catalog.propose.
 */

const SUGGESTIONS = "/admin/products/suggestions"
type Filter = ProposalStatus | "all"
const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
]
const isFilter = (v: string | null): v is Filter => FILTERS.some((f) => f.value === v)

export function AdminProposalsView() {
  const { can } = useAdminSession()
  return (
    <div className="@container grid gap-3">
      <AdminPageHead
        live
        title="Suggestions"
        description="Products and product changes Yard suggested to brands. Nothing goes live until the brand accepts."
        actions={
          can("catalog.propose") ? (
            <Button asChild size="sm" variant="primary" className="h-10 sm:h-9">
              <Link href={`${SUGGESTIONS}/new`}>
                <PlusIcon /> Add product for brand
              </Link>
            </Button>
          ) : undefined
        }
      />
      <TrustGate feature="Suggestions" anyOf={["catalog.propose"]}>
        <ProposalsWorkspace />
      </TrustGate>
    </div>
  )
}

function ProposalsWorkspace() {
  const statusParam = useSearchParam("status")
  const status: Filter = isFilter(statusParam) ? statusParam : "pending"
  const brandId = useSearchParam("brand") ?? undefined
  const open = useSearchParam("proposal")
  const [term, setTerm] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = window.setTimeout(() => setQ(term.trim()), 250)
    return () => window.clearTimeout(t)
  }, [term])
  const list = useApi(`admin.proposals.list:${status}:${brandId ?? ""}:${q}`, () => listAdminProposals({ status, brandId, q }))
  const revalidate = list.revalidate
  const soon = useRef<number | undefined>(undefined)
  const refresh = useCallback(() => {
    window.clearTimeout(soon.current)
    soon.current = window.setTimeout(() => void revalidate(), 250)
  }, [revalidate])
  useEffect(() => () => window.clearTimeout(soon.current), [])
  useRealtimeEvent("proposal.updated", () => {
    refresh()
    revalidatePrefix("admin.proposals.one")
  })
  const items = list.data?.items ?? []
  const counts = list.data?.counts
  const brandName = brandId ? items[0]?.brand.name : undefined

  return (
    <>
      <div className="grid gap-3 rounded-[20px] border border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
        <div className="rail overflow-x-auto">
          <Segmented
            label="Suggestion status"
            size="sm"
            value={status}
            onChange={(v) => writeParams({ status: v === "pending" ? null : v, proposal: null })}
            loading={!counts}
            options={FILTERS.map((f) => ({ ...f, count: f.value === "pending" ? counts?.pending : undefined, countTone: "attention" as const }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search suggestions</span>
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Product or brand" className="h-10 w-full rounded-md border border-line-soft bg-card pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-white/15" />
          </label>
          {brandId ? (
            <Button size="sm" variant="secondary" className="h-10" onClick={() => writeParams({ brand: null })}>
              {brandName ? `${brandName} only` : "One brand"} ✕
            </Button>
          ) : null}
        </div>
        {list.isLoading && !list.data ? (
          <ListSkeleton rows={5} />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={() => void list.revalidate()} what="suggestions" />
        ) : !items.length ? (
          <EmptyState icon={SparkleIcon} title={q ? `Nothing matches “${q}”` : status === "pending" ? "No suggestions waiting" : "No suggestions here"} body="Add a product for a brand, or suggest changes from a listing in Products." />
        ) : (
          <ul className="grid gap-0.5" aria-label="Suggestions">
            {items.map((p) => (
              <li key={p.id}>
                <Row p={p} selected={p.id === open} />
              </li>
            ))}
          </ul>
        )}
        {list.data?.nextOffset != null ? <p className="px-2 text-xs text-ink-3">Showing the first {items.length}. Narrow with search or a filter.</p> : null}
      </div>
      <ProposalDetail id={open} onChanged={refresh} />
    </>
  )
}

function Row({ p, selected }: { p: ProposalSummaryDto; selected: boolean }) {
  return (
    <button type="button" onClick={() => writeParams({ proposal: p.id })} aria-current={selected ? "true" : undefined} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:bg-white/[0.05] focus-visible:outline-none", selected ? "bg-purple/15" : "hover:bg-white/[0.04]")}>
      <ProposalThumb src={p.cover} size={36} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-ink">{p.title}</span>
          <span className="inline-flex h-5 shrink-0 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] text-ink-2">{p.kind === "new" ? "New product" : "Changes"}</span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
          {p.brand.name}
          {p.kind === "edit" && p.fields.length ? `, ${p.fields.length} ${p.fields.length === 1 ? "field" : "fields"}` : ""}
          {p.createdBy ? `, by ${p.createdBy.name}` : ""}
        </span>
      </span>
      <span className="hidden shrink-0 text-[11px] text-ink-3 sm:block">{relativeTime(p.updatedAt)}</span>
      <ProposalStatusBadge status={p.status} />
    </button>
  )
}

function ProposalDetail({ id, onChanged }: { id: string | null; onChanged: () => void }) {
  const router = useRouter()
  const q = useApi(id ? `admin.proposals.one:${id}` : null, () => getAdminProposal(id!), { keepPrevious: false })
  const current = q.data?.proposal && q.data.proposal.id === id ? q.data.proposal : null
  // Keeps the record while the panel animates closed.
  const p = useLast(current)
  const { can } = useAdminSession()
  const [busy, setBusy] = useState(false)
  const close = () => writeParams({ proposal: null })

  const withdraw = async () => {
    if (!p) return
    setBusy(true)
    try {
      const r = await withdrawAdminProposal(p.id)
      q.mutate(() => r)
      onChanged()
      toast("Suggestion withdrawn", { description: `${p.brand.name} no longer sees it.` })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailSheet
      open={!!id}
      onOpenChange={(o) => !o && close()}
      title={p?.title ?? (q.error ? "Suggestion" : "Loading…")}
      description={p ? `${p.kind === "new" ? "New product" : "Changes"} for ${p.brand.name}` : undefined}
      lead={p ? <ProposalThumb src={p.cover} size={40} /> : null}
      badges={p ? <ProposalStatusBadge status={p.status} /> : null}
      actions={
        p && p.status === "pending" && can("catalog.propose") ? (
          <ActionBar
            note="The brand sees the latest version. Updating replaces it; withdrawing removes it."
            actions={[
              { key: "withdraw", label: busy ? "Withdrawing…" : "Withdraw", icon: ArrowCounterClockwiseIcon, variant: "destructive", onSelect: () => void withdraw() },
              { key: "update", label: "Update", icon: PencilSimpleIcon, variant: "secondary", onSelect: () => router.push(`${SUGGESTIONS}/new?revise=${encodeURIComponent(p.id)}`) },
            ]}
          />
        ) : null
      }
    >
      {q.error && !p ? (
        <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this suggestion" />
      ) : !p || (id && !current && q.isLoading) ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <Facts
            items={[
              { label: "Brand", value: p.brand.name },
              { label: "Status", value: p.status === "pending" ? "Waiting for the brand" : p.status === "accepted" ? `Accepted ${p.decidedAt ? formatDateTime(p.decidedAt) : ""}` : p.status === "declined" ? "Declined" : p.status === "withdrawn" ? "Withdrawn" : "Replaced by an update" },
              { label: "Suggested by", value: p.createdBy?.name ?? "Yard" },
              { label: "Sent", value: formatDateTime(p.createdAt) },
              ...(p.decidedBy ? [{ label: "Answered by", value: p.decidedBy.name }] : []),
            ]}
          />
          {p.note ? (
            <DetailSection title="Note to the brand">
              <p className="text-[13px] whitespace-pre-line text-ink-2">{p.note}</p>
            </DetailSection>
          ) : null}
          {p.status === "declined" ? (
            <DetailSection title="Why they declined">
              <p className="text-[13px] text-ink-2">{p.declineReason || "No reason given."}</p>
            </DetailSection>
          ) : null}
          {p.conflicts.length ? (
            <p role="status" className="rounded-[10px] border border-acid/40 bg-acid/[0.05] px-3 py-2.5 text-[12px] text-ink-2">
              The brand changed {p.conflicts.length === 1 ? "a field" : `${p.conflicts.length} fields`} after this was sent. They see both values when they review.
            </p>
          ) : null}
          {p.kind === "edit" ? (
            <DetailSection title="Changes">
              <ProposalChangeList detail={p} />
            </DetailSection>
          ) : null}
          <DetailSection title={p.status === "accepted" ? "As accepted" : "As it would look"}>
            <ProposedProduct detail={p} />
          </DetailSection>
          <DetailSection title="Links">
            <ul className="grid gap-1.5">
              {p.productId ? (
                <li>
                  <LinkRow href={`/admin/products?tab=listings&q=${encodeURIComponent(p.title)}#moderation-queue`} label="Listing in Products" hint={p.title} />
                </li>
              ) : null}
              <li>
                <LinkRow href={`${SUGGESTIONS}?brand=${encodeURIComponent(p.brand.id)}&status=all`} label={`All suggestions for ${p.brand.name}`} hint={`@${p.brand.handle}`} />
              </li>
            </ul>
          </DetailSection>
          <DetailSection title="Activity">
            <ServerActivity subjectIds={[p.id, ...(p.supersedesId ? [p.supersedesId] : [])]} empty="No activity recorded yet." />
          </DetailSection>
        </>
      )}
    </DetailSheet>
  )
}
