"use client"

import { useRef } from "react"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight, ClockCounterClockwiseIcon as History } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { adminRoles, type AuditEntry } from "@/lib/data/admin"
import { cn } from "@/lib/utils"
import { formatDateTime } from "./format"

/**
 * The detail panel for an Admin queue item: header with identity and status, a scrolling
 * body of sections, and the allowed decisions pinned to the bottom.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  lead,
  badges,
  actions,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  lead?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        // Focus the panel itself rather than its first field, so opening a record never lands in the note box.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contentRef.current?.focus()
        }}
        className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px] focus:outline-none"
      >
        <SheetHeader className="gap-3 border-b border-line-soft p-4 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            {lead}
            <div className="min-w-0">
              <SheetTitle className="truncate text-[15px] text-ink">{title}</SheetTitle>
              {description ? <SheetDescription className="mt-0.5 truncate text-[12px] text-ink-2">{description}</SheetDescription> : null}
            </div>
          </div>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="grid gap-5 p-4">{children}</div>
        </div>
        {actions ? <div className="border-t border-line-soft bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{actions}</div> : null}
      </SheetContent>
    </Sheet>
  )
}

export function DetailSection({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft">
      {items.map((f) => (
        <div key={f.label} className="bg-card px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">{f.label}</dt>
          <dd className="mt-0.5 truncate text-[13px] text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Audit entries for one subject, newest first, with the actor, their role and the reason. */
export function ActivityList({ entries, extra, empty = "No decisions recorded yet." }: { entries: AuditEntry[]; extra?: { at: string; label: string; detail?: string }[]; empty?: string }) {
  const rows = [
    ...entries.map((e) => ({ id: e.id, at: e.at, label: e.action, who: `${e.actor}, ${adminRoles[e.role]?.name.toLowerCase() ?? e.role}`, detail: e.reason, approvedBy: e.approvedBy })),
    ...(extra ?? []).map((x, i) => ({ id: `x${i}`, at: x.at, label: x.label, who: undefined as string | undefined, detail: x.detail, approvedBy: undefined as string | undefined })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  if (!rows.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">
        <History className="size-3.5" aria-hidden /> {empty}
      </p>
    )
  }
  return (
    <ol className="divide-y divide-line-soft rounded-lg border border-line-soft bg-card">
      {rows.map((r) => (
        <li key={r.id} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-ink">{r.label}</p>
            <time dateTime={r.at} className="shrink-0 text-[11px] text-ink-3 tabular">{formatDateTime(r.at)}</time>
          </div>
          {r.who ? <p className="mt-0.5 text-[11px] text-ink-3">{r.who}{r.approvedBy ? `, approved by ${r.approvedBy}` : ""}</p> : null}
          {r.detail ? <p className="mt-1 text-[12px] text-ink-2">{r.detail}</p> : null}
        </li>
      ))}
    </ol>
  )
}

export type DecisionAction = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  variant: "primary" | "secondary" | "destructive"
  onSelect: () => void
}

const weight: Record<DecisionAction["variant"], number> = { destructive: 0, secondary: 1, primary: 2 }

/**
 * The decision row: allowed actions only, wrapping on phones. Every panel uses the same
 * order (destructive first, then secondary, the constructive action last), so it's
 * sorted here rather than written by each panel.
 */
export function ActionBar({ actions, note }: { actions: DecisionAction[]; note?: React.ReactNode }) {
  const ordered = actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => weight[x.a.variant] - weight[y.a.variant] || x.i - y.i)
    .map(({ a }) => a)
  return (
    <div className="grid gap-2">
      {note ? <p className="text-[11px] text-ink-3">{note}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        {ordered.map((a) => (
          <Button key={a.key} type="button" size="sm" variant={a.variant} onClick={a.onSelect}>
            <a.icon /> {a.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** A link from a detail panel to a related record or screen. Closes the panel on the way out. */
export function LinkRow({ href, label, hint, onNavigate }: { href: string; label: string; hint: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="group flex items-center justify-between gap-3 rounded-md border border-line-soft bg-card px-3 py-2 transition-colors hover:border-line hover:bg-elevated">
      <span className="min-w-0">
        <span className="block text-[13px] text-ink group-hover:text-violet">{label}</span>
        <span className="block truncate text-[11px] text-ink-3">{hint}</span>
      </span>
      <ArrowUpRight className="size-3.5 shrink-0 text-ink-3 group-hover:text-violet" aria-hidden />
    </Link>
  )
}
