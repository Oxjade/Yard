"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight, ClockCounterClockwiseIcon as History } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { adminRoles, type AuditEntry } from "@/lib/data/admin"
import { cn } from "@/lib/utils"
import { currentOpener, focusBack } from "./focus"
import { formatDateTime } from "./format"

/*
 * The detail panel for a Control Center record, in the control-room look. It is portalled
 * outside the admin surface, so hairlines are written as literal colours here rather than
 * the --admin-hairline variables.
 */

const hairline = "border-white/[0.07]"
/** An inset block inside the sheet: one step up from the sheet's surface. */
export const insetClass = "rounded-[10px] border border-white/[0.07] bg-white/[0.018]"

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
  // Whatever opened the record (a name button, a row menu's trigger, a card link), and the
  // page it was opened on. Captured before the sheet takes focus.
  const opener = useRef<HTMLElement | null>(null)
  const openedOn = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    opener.current = currentOpener()
    openedOn.current = window.location.pathname
  }, [open])
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
        // Back to the control that opened it, else the view's selected tab or heading. When a
        // link in the sheet went to another page, that page owns focus.
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (window.location.pathname !== openedOn.current) return
          focusBack(opener.current)
        }}
        className={cn("gap-0 bg-[#0c0c0c] p-0 shadow-[0_0_0_1px_rgba(255,255,255,0.04),-24px_0_64px_-24px_rgba(0,0,0,0.9)] focus:outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-[500px]", hairline)}
      >
        <SheetHeader className={cn("relative gap-3 border-b bg-[radial-gradient(420px_200px_at_0%_0%,rgba(109,25,217,0.14),transparent_70%)] p-5 pr-14", hairline)}>
          <div className="flex min-w-0 items-center gap-3">
            {lead}
            <div className="min-w-0">
              <SheetTitle className="font-label truncate text-[17px] leading-tight text-ink">{title}</SheetTitle>
              {description ? <SheetDescription className="mt-1 truncate text-[12px] text-ink-2">{description}</SheetDescription> : null}
            </div>
          </div>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="grid gap-6 p-5">{children}</div>
        </div>
        {actions ? <div className={cn("border-t bg-[#0c0c0c] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]", hairline)}>{actions}</div> : null}
      </SheetContent>
    </Sheet>
  )
}

export function DetailSection({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-label text-[13px] text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-white/[0.07] bg-white/[0.07]">
      {items.map((f) => (
        <div key={f.label} className="bg-[#0f0f0f] px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">{f.label}</dt>
          <dd className="mt-1 truncate text-[13px] text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A quiet placeholder line inside a section ("No reports against this account"). */
export function EmptyLine({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <p className="flex items-center gap-2 rounded-[10px] border border-dashed border-white/10 px-3 py-3 text-[12px] text-ink-3">
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </p>
  )
}

/** Audit entries for one subject, newest first, with the actor, their role and the reason. */
export function ActivityList({ entries, extra, empty = "No decisions recorded yet." }: { entries: AuditEntry[]; extra?: { at: string; label: string; detail?: string }[]; empty?: string }) {
  const rows = [
    ...entries.map((e) => ({ id: e.id, at: e.at, label: e.action, who: `${e.actor}, ${adminRoles[e.role]?.name.toLowerCase() ?? e.role}`, detail: e.reason, approvedBy: e.approvedBy })),
    ...(extra ?? []).map((x, i) => ({ id: `x${i}`, at: x.at, label: x.label, who: undefined as string | undefined, detail: x.detail, approvedBy: undefined as string | undefined })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  if (!rows.length) return <EmptyLine icon={History}>{empty}</EmptyLine>
  return (
    <ol className={cn("divide-y divide-white/[0.07]", insetClass)}>
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
 * sorted here rather than written by each panel. One acid button at most.
 */
export function ActionBar({ actions, note }: { actions: DecisionAction[]; note?: React.ReactNode }) {
  const ordered = actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => weight[x.a.variant] - weight[y.a.variant] || x.i - y.i)
    .map(({ a }) => a)
  return (
    <div className="grid gap-2.5">
      {note ? <p className="text-[11.5px] leading-snug text-ink-3">{note}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        {ordered.map((a) => (
          <Button key={a.key} type="button" size="sm" className="h-10 sm:h-9" variant={a.variant} onClick={a.onSelect}>
            <a.icon /> {a.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A link from a detail panel to a related record or screen. The panel isn't closed first: the
 * page it's on keeps its record in the URL, so Back returns to the record you came from.
 */
export function LinkRow({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link href={href} className={cn("group flex min-h-11 items-center justify-between gap-3 px-3 py-2 transition-colors duration-150 hover:border-white/[0.13] hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet", insetClass)}>
      <span className="min-w-0">
        <span className="block text-[13px] text-ink group-hover:text-violet">{label}</span>
        <span className="block truncate text-[11px] text-ink-3">{hint}</span>
      </span>
      <ArrowUpRight className="size-3.5 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-violet" aria-hidden />
    </Link>
  )
}
