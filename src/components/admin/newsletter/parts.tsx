"use client"

import { StatusBadge } from "@/components/dashboard/status-badge"
import type { NewsletterSummaryDto } from "@/lib/api/contracts/newsletter"
import { newsletterKindMeta, newsletterStatusMeta, type NewsletterKind, type NewsletterStatus } from "@/lib/newsletter"
import { cn } from "@/lib/utils"

/* Small pieces shared by Admin › Newsletter's list and composer. */

export const NEWSLETTER = "/admin/newsletter"
export const composeHref = (id: string) => `${NEWSLETTER}/compose?id=${encodeURIComponent(id)}`

export function CampaignStatus({ status }: { status: NewsletterStatus }) {
  const m = newsletterStatusMeta[status]
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
}

export function KindChip({ kind, className }: { kind: NewsletterKind; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-[3px] border px-1.5 text-[10px]", kind === "service" ? "border-violet/40 text-violet" : "border-white/10 text-ink-2", className)}>{newsletterKindMeta[kind].short}</span>
}

const fmt = (n: number) => n.toLocaleString("en-US")

/** "1,204 sent · 3 failed · 12 unsubscribed", or the right words before anything went out. */
export function statsLine(c: NewsletterSummaryDto): string {
  if (c.status === "draft") return "Not sent yet"
  if (c.status === "scheduled") return "Waiting for its time"
  const n = c.counts
  const parts = [`${fmt(n.sent)} sent`]
  if (n.stub) parts.push(`${fmt(n.stub)} not sent (no email provider)`)
  if (n.failed) parts.push(`${fmt(n.failed)} failed`)
  parts.push(`${fmt(n.unsubscribed)} unsubscribed`)
  if (c.status === "sending") parts.unshift(`${fmt(n.total - n.pending)} of ${fmt(n.total)} handed over`)
  return parts.join(" · ")
}

/** The date a row shows: when it went (or will go) out, else when it was last edited. */
export function campaignWhen(c: NewsletterSummaryDto): { label: string; at: string } {
  if (c.status === "scheduled" && c.scheduledFor) return { label: "Goes out", at: c.scheduledFor }
  if (c.status === "sending" && c.startedAt) return { label: "Started", at: c.startedAt }
  if ((c.status === "sent" || c.status === "cancelled") && (c.finishedAt ?? c.startedAt)) return { label: c.status === "sent" ? "Sent" : "Stopped", at: (c.finishedAt ?? c.startedAt)! }
  return { label: "Edited", at: c.updatedAt }
}

/** "Tue 18 Nov, 9:30 AM" in the admin's own time zone. */
export const localTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })

export const people = (n: number) => `${fmt(n)} ${n === 1 ? "person" : "people"}`
