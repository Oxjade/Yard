"use client"

import Link from "next/link"
import { ArrowUpRightIcon } from "@phosphor-icons/react"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { Bone } from "@/components/feedback/skeletons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ShellAccount, ShellStatus } from "./types"
import { useRailTip } from "./use-rail-tip"

/**
 * The bottom status card: one real figure and the action it leads to. On the collapsed rail
 * it becomes a single icon tile (with a dot when there is something to do) and a tooltip.
 * The figure counts up once, the first time the shell shows it (`Figure`).
 */
export function StatusCard({
  status,
  tooltip,
  collapsed = false,
  compact = false,
  onNavigate,
}: {
  status: ShellStatus
  tooltip: boolean
  collapsed?: boolean
  compact?: boolean
  onNavigate?: () => void
}) {
  const [tipOpen, onTip] = useRailTip(collapsed)
  const Icon = status.icon
  const loading = status.value === null
  // Until the figure loads, the arrow stays neutral: its tone depends on data not yet read.
  const arrowTone = loading ? "bg-white/[0.06] text-ink-2" : status.attention ? "bg-acid text-obsidian" : "bg-purple text-ink"

  // The phone drawer: one row (icon, figure, arrow), so every section fits above it on a phone.
  if (compact) {
    return (
      <Link href={status.href} onClick={onNavigate} className={cn("group/status flex", compactRow, "hover:border-white/[0.12]")}>
        <CompactBody status={status} arrowTone={arrowTone} />
      </Link>
    )
  }

  const card = (
    <Link href={status.href} onClick={onNavigate} className="group/status relative block rounded-2xl">
      {/* Expanded: the full card, or on the shortest windows the drawer's one-row layout. */}
      <span className="block sidebar-collapsed:hidden">
        <span className="flex flex-col rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors duration-150 group-hover/status:border-white/[0.12] sidebar-shorter:hidden">
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 pt-0.5 text-[11px] leading-none text-ink-3">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{status.label}</span>
            </span>
            <span
              aria-hidden
              className={cn(
                "-mt-0.5 -mr-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-transform duration-150 group-hover/status:-translate-y-px group-hover/status:translate-x-px",
                arrowTone,
              )}
            >
              <ArrowUpRightIcon weight="bold" className="size-3.5" />
            </span>
          </span>
          <span className="mt-1 flex h-7 items-end">
            {loading ? (
              <Bone className="h-5 w-28" />
            ) : status.quiet ? (
              <span className="truncate text-[15px] leading-7 font-medium text-ink-2">{status.value}</span>
            ) : (
              <span className="font-metric truncate text-[26px] text-ink">
                <Figure status={status} />
              </span>
            )}
          </span>
          {/* On short windows the action line is visually dropped (still read, and the arrow stays). */}
          {loading ? (
            <span aria-hidden className="skeleton mt-1.5 block h-3 w-20 rounded-md sidebar-short:hidden" />
          ) : (
            <span className="mt-1.5 text-[12px] leading-none text-ink-2 transition-colors duration-150 group-hover/status:text-ink sidebar-short:sr-only">{status.action}</span>
          )}
        </span>
        <span className={cn("hidden sidebar-shorter:flex", compactRow, "group-hover/status:border-white/[0.12]")}>
          <CompactBody status={status} arrowTone={arrowTone} />
        </span>
      </span>
      <span className="relative hidden size-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-ink-2 transition-colors duration-150 group-hover/status:border-white/[0.14] group-hover/status:text-ink sidebar-collapsed:inline-flex">
        <Icon aria-hidden className="size-5" />
        {status.dot && !loading ? <span aria-hidden className={cn("absolute top-2 right-2 size-[7px] rounded-full ring-2 ring-[#0e0e0e]", status.attention ? "bg-acid" : "bg-violet")} /> : null}
        <span className="sr-only">{loading ? status.label : status.summary}</span>
      </span>
    </Link>
  )

  if (!tooltip) return card
  return (
    <Tooltip open={tipOpen} onOpenChange={onTip} disableHoverableContent>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={22}>
        {loading ? status.label : status.summary}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The status figure. A number, or text holding one ("₦1,582,700", "21"), counts up from zero
 * the first time any of the card's layouts shows it on this page load (the rail, the short
 * window row and the phone drawer share one `once` key), and after that changes instantly: a
 * balance that changes after a payout request must never look like money moving.
 */
function Figure({ status }: { status: ShellStatus }) {
  const { value } = status
  if (typeof value !== "string" && typeof value !== "number") return <>{value}</>
  return <CountUp text={String(value)} updates="instant" once={`shell-status:${status.href}`} />
}

const compactRow = "items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-2.5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors duration-150"

/** The one-row status layout: icon, label over figure, arrow. Laid out by `compactRow`. */
function CompactBody({ status, arrowTone }: { status: ShellStatus; arrowTone: string }) {
  const Icon = status.icon
  const loading = status.value === null
  return (
    <>
      <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-ink-2">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-none text-ink-3">{status.label}</span>
        <span className="mt-1.5 flex h-5 items-center">
          {loading ? (
            <Bone className="h-4 w-24" />
          ) : status.quiet ? (
            <span className="truncate text-[14px] leading-none font-medium text-ink-2">{status.value}</span>
          ) : (
            <span className="font-metric truncate text-[20px] leading-none text-ink">
              <Figure status={status} />
            </span>
          )}
        </span>
      </span>
      {loading ? null : <span className="sr-only">{status.action}</span>}
      <span
        aria-hidden
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 group-hover/status:-translate-y-px group-hover/status:translate-x-px",
          arrowTone,
        )}
      >
        <ArrowUpRightIcon weight="bold" className="size-3.5" />
      </span>
    </>
  )
}

/** The account row at the very bottom of the panel: initials, name and one muted line. */
export function AccountRow({ account }: { account: ShellAccount }) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-3 pl-1.5">
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-elevated text-[11px] font-semibold text-ink-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      >
        {account.initials}
      </span>
      <span className="min-w-0 flex-1 transition-opacity duration-150 sidebar-collapsed:opacity-0">
        <span className="block truncate text-[13px] leading-tight text-ink">{account.name}</span>
        <span className="mt-1 block truncate text-[11px] leading-none text-ink-3">{account.caption}</span>
      </span>
    </div>
  )
}
