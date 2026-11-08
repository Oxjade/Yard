import { cn } from "@/lib/utils"

type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"

const tones: Record<Tone, string> = {
  neutral: "border-white/12 text-ink",
  info: "border-purple bg-purple/20 text-ink",
  // Needs action: a bright ink edge and a ringed dot. Not acid, which belongs to a page's one primary action.
  attention: "border-ink/70 text-ink",
  success: "border-white/12 bg-white/5 text-ink",
  danger: "border-danger/40 text-danger",
  muted: "border-white/10 text-ink-3",
}

const dots: Record<Tone, string> = {
  neutral: "bg-ink",
  info: "bg-violet",
  attention: "bg-ink ring-2 ring-ink/25",
  success: "bg-ink",
  danger: "bg-danger",
  muted: "bg-ink-3",
}

/** Status pill used in every Studio and Admin table. A bright ink edge = needs action; purple = in progress. */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-[5px] border px-2 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>
      <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden />
      {children}
    </span>
  )
}

export const orderStatusMeta: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: "Awaiting payment", tone: "muted" },
  paid: { label: "To fulfil", tone: "attention" },
  processing: { label: "Processing", tone: "info" },
  shipped: { label: "Shipped", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
  refund_requested: { label: "Refund requested", tone: "attention" },
  refunded: { label: "Refunded", tone: "muted" },
}

export const productStatusMeta: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  published: { label: "Published", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  archived: { label: "Archived", tone: "muted" },
}

export const campaignStatusMeta: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  in_review: { label: "In review", tone: "attention" },
  scheduled: { label: "Scheduled", tone: "info" },
  active: { label: "Active", tone: "info" },
  paused: { label: "Paused", tone: "muted" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
}
