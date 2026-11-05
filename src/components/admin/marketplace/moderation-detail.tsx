"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight, GavelIcon as Gavel, ArrowCounterClockwiseIcon as RotateCcw, TrashIcon as Trash2, XCircleIcon as XCircle } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { brandById, productById } from "@/lib/data"
import type { ModerationItem } from "@/lib/data/admin"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { Thumb } from "./data-table"
import { ActionBar, ActivityList, DetailSection, DetailSheet, Facts } from "./detail-sheet"
import { categoryName, formatDateTime, relDays } from "./format"
import { brandStatusMeta, moderationReasonMeta, moderationStatusMeta } from "./meta"
import { ReasonDialog, type ReasonAction } from "./reason-dialog"

type Status = ModerationItem["status"]
type ModActionKey = "remove" | "dismiss" | "escalate" | "reopen"

const removePresets: Record<ModerationItem["reason"], string[]> = {
  counterfeit: ["Logo match confirmed on review", "Rights-holder notice verified", "Seller couldn't show proof of authenticity"],
  ip_complaint: ["Valid IP notice, no counter-notice", "Design copied from a protected work", "Legal advised removal"],
  prohibited: ["Category not allowed on the marketplace", "Can't ship legally to most markets", "Missing required certification"],
  misleading: ["Materials described incorrectly", "Photos don't show the product sold", "Price or origin misrepresented"],
  auto_flag: ["Safety rule confirmed on review", "No certificate supplied", "Restricted ingredient or part"],
}

const actionDefs: Record<ModActionKey, { label: string; to: Status; icon: React.ComponentType<{ className?: string }>; button: "secondary" | "destructive"; dialog: (m: ModerationItem) => ReasonAction; toast: (m: ModerationItem) => [string, string] }> = {
  remove: {
    label: "Remove listing",
    to: "removed",
    icon: Trash2,
    button: "destructive",
    dialog: (m) => ({
      title: `Remove “${m.title}”?`,
      body: "The listing is hidden everywhere and can't be bought. Bags holding it are cleared and the brand is told the reason. If it was removed in error, reopen the case from the Removed tab.",
      confirmLabel: "Remove listing",
      tone: "destructive",
      presets: removePresets[m.reason],
    }),
    toast: (m) => ["Listing removed", `${m.title} is hidden from the marketplace.`],
  },
  dismiss: {
    label: "Dismiss",
    to: "dismissed",
    icon: XCircle,
    button: "secondary",
    dialog: (m) => ({
      title: `Dismiss the report on “${m.title}”?`,
      body: "Closes the case with no action. The listing stays up and the reporter is told the outcome.",
      confirmLabel: "Dismiss case",
      tone: "primary",
      presets: ["Listing is accurate as written", "Seller supplied proof", "Duplicate of an earlier report"],
    }),
    toast: (m) => ["Case dismissed", `${m.title} stays live.`],
  },
  escalate: {
    label: "Escalate to legal",
    to: "escalated",
    icon: Gavel,
    button: "secondary",
    dialog: (m) => ({
      title: `Escalate “${m.title}” to legal?`,
      body: "Sends the case and its evidence to legal review. The listing stays up until legal decides, unless you remove it.",
      confirmLabel: "Escalate case",
      tone: "primary",
      presets: ["Formal IP notice needs legal review", "Possible trademark dispute", "Regulatory question on the category"],
    }),
    toast: () => ["Escalated to legal", "Legal review usually takes 2 business days."],
  },
  reopen: {
    label: "Reopen case",
    to: "open",
    icon: RotateCcw,
    button: "secondary",
    dialog: (m) =>
      m.status === "removed"
        ? {
            title: `Reopen the case on “${m.title}”?`,
            body: "Moves the case back to the open queue and the listing can be bought again while it's reviewed. Use this when a listing was removed in error.",
            confirmLabel: "Reopen case",
            tone: "primary",
            presets: ["Removed in error", "Brand showed proof of authenticity", "Rights holder withdrew the notice"],
            warning: m.reason === "counterfeit" || m.reason === "ip_complaint" ? "This listing was removed for a counterfeit or IP report. Check the evidence before it goes back on sale." : undefined,
          }
        : {
            title: `Reopen the case on “${m.title}”?`,
            body: "Moves the case back to the open queue for another review.",
            confirmLabel: "Reopen case",
            tone: "primary",
            presets: ["New evidence from the reporter", "Dismissed in error", "Repeat report from another customer"],
          },
    toast: (m) => ["Case reopened", m.status === "removed" ? `${m.title} is back in the open queue and on sale again.` : `${m.title} is back in the open queue.`],
  },
}

/** Only the transitions the case's current status allows. ActionBar puts them in the shared order. */
const allowed: Record<Status, ModActionKey[]> = {
  open: ["remove", "escalate", "dismiss"],
  escalated: ["remove", "dismiss"],
  dismissed: ["reopen"],
  removed: ["reopen"],
}

export function ModerationDetail({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const item = useAdmin((s) => s.moderation.find((m) => m.id === id))
  const all = useAdmin((s) => s.moderation)
  const applications = useAdmin((s) => s.applications)
  const audit = useAdmin((s) => s.audit)
  const setStatus = useAdmin((s) => s.setModerationStatus)
  // The dialog's copy is fixed when it opens, so it doesn't change under the admin as the decision lands.
  const [pending, setPending] = useState<{ key: ModActionKey; action: ReasonAction; toast: [string, string] } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!item) return null

  const product = item.productId ? productById.get(item.productId) : undefined
  const brand = product ? brandById.get(product.brandId) : undefined
  const application = applications.find((a) => a.brandName === item.brandName)
  const otherCases = all.filter((m) => m.brandName === item.brandName && m.id !== item.id)
  const entries = audit.filter((e) => e.target === item.title || e.target.startsWith(`${item.title} (`))
  const reason = moderationReasonMeta[item.reason]
  const status = moderationStatusMeta[item.status]

  function run(m: ModerationItem, key: ModActionKey) {
    setPending({ key, action: actionDefs[key].dialog(m), toast: actionDefs[key].toast(m) })
    setDialogOpen(true)
  }

  async function confirm(r: string) {
    if (!pending || !item) return
    const [title, description] = pending.toast
    setStatus(item.id, actionDefs[pending.key].to, r)
    toast(title, { description })
  }

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
          note={item.status === "removed" ? "Removed listings stay down unless the case is reopened. A reason is required." : "Every decision needs a reason. The brand is told the outcome."}
          actions={allowed[item.status].map((key) => ({ key, label: actionDefs[key].label, icon: actionDefs[key].icon, variant: actionDefs[key].button, onSelect: () => run(item, key) }))}
        />
      }
    >
      <DetailSection title="Listing">
        {product && brand ? (
          <div className="flex gap-3 rounded-lg border border-line-soft bg-card p-3">
            <Thumb src={product.images[0]?.src} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-[13px] font-medium text-ink">{product.name}</p>
              <p className="truncate text-[11px] text-ink-3">{brand.name}, {categoryName(product.category).toLowerCase()}</p>
              <p className="mt-1.5 text-[13px] text-ink tabular">{formatMoney(product.price, product.currency)}</p>
              <Link href={`/products/${product.slug}`} onClick={() => onOpenChange(false)} className="mt-auto inline-flex items-center gap-1 pt-2 text-[12px] text-violet hover:underline">
                View listing <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">
            This listing isn&apos;t in the public catalogue (it&apos;s a draft or already hidden), so there&apos;s no preview to open.
          </p>
        )}
      </DetailSection>

      <DetailSection title="Evidence">
        <Facts
          items={[
            { label: "Reported by", value: item.reportedBy },
            { label: "Reported", value: <time dateTime={item.reportedAt} title={formatDateTime(item.reportedAt)}>{relDays(item.reportedAt)}</time> },
          ]}
        />
        <blockquote className="rounded-lg border-l-2 border-violet/60 bg-card px-3 py-2.5 text-[13px] text-ink-2">{item.detail}</blockquote>
      </DetailSection>

      <DetailSection title="Brand">
        <Link href={application ? `/admin/brands?review=${application.id}` : "/admin/brands"} onClick={() => onOpenChange(false)} className="group flex items-center justify-between gap-3 rounded-lg border border-line-soft bg-card px-3 py-2.5 transition-colors hover:border-line hover:bg-elevated">
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

      <ReasonDialog action={pending?.action ?? null} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={confirm} />
    </DetailSheet>
  )
}
