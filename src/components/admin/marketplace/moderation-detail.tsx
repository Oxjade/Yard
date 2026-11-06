"use client"

import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { useNow } from "@/hooks/use-now"
import { brandById, productById } from "@/lib/data"
import type { ModerationItem } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { amountIn } from "../finance/format"
import { Thumb } from "./bits"
import { ActionBar, ActivityList, DetailSection, DetailSheet, EmptyLine, Facts, insetClass } from "./detail-sheet"
import { categoryName, formatDateTime, relDays } from "./format"
import { brandStatusMeta, moderationReasonMeta, moderationStatusMeta } from "./meta"
import { modActions, modAllowed, type ModActionKey } from "./moderation-actions"
import { useLast } from "./use-last"

export function ModerationDetail({ id, open, onOpenChange, onDecide }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDecide: (key: ModActionKey, m: ModerationItem) => void }) {
  // Relative days count from the same today as every other Control Center page.
  const now = useNow(60_000)
  const shown = useLast(id)
  const item = useAdmin((s) => s.moderation.find((m) => m.id === shown))
  const all = useAdmin((s) => s.moderation)
  const applications = useAdmin((s) => s.applications)
  const audit = useAdmin((s) => s.audit)

  if (!item) return null

  const product = item.productId ? productById.get(item.productId) : undefined
  const brand = product ? brandById.get(product.brandId) : undefined
  const application = applications.find((a) => a.brandName === item.brandName)
  const otherCases = all.filter((m) => m.brandName === item.brandName && m.id !== item.id)
  const entries = audit.filter((e) => (e.subjectId ? e.subjectId === item.id : e.target === item.title || e.target.startsWith(`${item.title} (`)))
  const reason = moderationReasonMeta[item.reason]
  const status = moderationStatusMeta[item.status]

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={item.title}
      description={item.brandName}
      badges={
        <>
          <StatusBadge tone={reason.tone}>{reason.label}</StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </>
      }
      actions={
        <ActionBar
          note={item.status === "removed" ? "Removed listings stay down unless the case is reopened. A reason is required." : "Every decision needs a reason and is recorded in the audit log."}
          actions={modAllowed[item.status].map((key) => ({ key, label: modActions[key].label, icon: modActions[key].icon, variant: modActions[key].button, onSelect: () => onDecide(key, item) }))}
        />
      }
    >
      <DetailSection title="Listing">
        {product && brand ? (
          <div className={cn("flex gap-3 p-3", insetClass)}>
            <Thumb src={product.images[0]?.src} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-[13px] font-medium text-ink">{product.name}</p>
              <p className="truncate text-[11px] text-ink-3">{brand.name}, {categoryName(product.category).toLowerCase()}</p>
              <p className="mt-1.5 text-[13px] text-ink tabular">{amountIn(product.price, product.currency)}</p>
              <Link href={`/products/${product.slug}`} className="mt-auto inline-flex min-h-8 items-center gap-1 pt-2 text-[12px] text-violet hover:underline">
                View listing <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <EmptyLine>This listing isn&apos;t in the public catalogue (it&apos;s a draft or already hidden), so there&apos;s no preview to open.</EmptyLine>
        )}
      </DetailSection>

      <DetailSection title="Evidence">
        <Facts
          items={[
            { label: "Reported by", value: item.reportedBy },
            { label: "Reported", value: <time dateTime={item.reportedAt} title={formatDateTime(item.reportedAt)}>{relDays(item.reportedAt, now)}</time> },
          ]}
        />
        <blockquote className="rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">{item.detail}</blockquote>
      </DetailSection>

      <DetailSection title="Brand">
        <Link href={application ? `/admin/brands?review=${application.id}` : "/admin/brands"} className={cn("group flex min-h-12 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:border-white/[0.13] hover:bg-white/[0.03]", insetClass)}>
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-ink group-hover:text-violet">{item.brandName}</span>
            <span className="block text-[11px] text-ink-3">{otherCases.length ? `${otherCases.length} other ${otherCases.length === 1 ? "case" : "cases"} on this brand` : "No other cases on this brand"}</span>
          </span>
          {application ? <StatusBadge tone={brandStatusMeta[application.status].tone}>{brandStatusMeta[application.status].label}</StatusBadge> : null}
        </Link>
      </DetailSection>

      <DetailSection title="Activity">
        <ActivityList entries={entries} extra={[{ at: item.reportedAt, label: "Report received", detail: item.reportedBy }]} />
      </DetailSection>
    </DetailSheet>
  )
}
