"use client"

import { useRef } from "react"
import { XIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { focusBack } from "../marketplace/focus"

/*
 * Orders and Finance helpers. Tables are the shared DataTable (src/components/dashboard/data-table)
 * inside the Control Center's Panel; URL-linked state comes from ../marketplace/url-state so every
 * index page reads and writes its view the same way.
 */

export { useSearchParam, writeParams, InPageLinks, useAdminReady, usePhone } from "../marketplace/url-state"

/**
 * The record another screen linked to (`?focus=rf_…`), pinned above its table with its own
 * decisions, so it's found without hunting through pages. Dismissing it clears the link.
 */
export function FocusCallout({ title, meta, badge, actions, onDismiss, className }: { title: React.ReactNode; meta?: React.ReactNode; badge?: React.ReactNode; actions?: React.ReactNode; onDismiss: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // The callout leaves with its dismiss button, so focus moves to the table it sits above:
  // its search box, else the panel's heading.
  function dismiss() {
    // The tab's panel outlives the callout (and a tab that remounts on dismiss).
    const host = ref.current?.closest<HTMLElement>('[role="tabpanel"]') ?? ref.current?.parentElement
    onDismiss()
    requestAnimationFrame(() => focusBack(null, () => host?.querySelector<HTMLElement>('input[type="search"]') ?? host?.querySelector<HTMLElement>("h2")))
  }
  return (
    <div ref={ref} role="region" aria-label="Linked record" className={cn("admin-inset flex flex-col gap-3 border-violet/40 bg-purple/[0.07] p-3 sm:flex-row sm:items-center", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-violet">Linked record</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink">
          {title}
          {badge}
        </p>
        {meta ? <p className="mt-0.5 text-[12px] text-ink-2">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        <button type="button" onClick={dismiss} aria-label="Dismiss the linked record" className="inline-flex size-10 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/[0.05] hover:text-ink sm:size-8">
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** A record reference link in a table's primary cell, with a 40px-tall hit area on phones that doesn't move the line below. */
export const refLinkClass = "relative inline-block font-medium whitespace-nowrap text-ink tabular before:absolute before:-inset-x-1 before:-inset-y-[11px] before:content-[''] hover:text-violet focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-violet sm:before:-inset-y-1.5"

/** A CSV download, built in the browser from rows already on screen. Nothing is sent anywhere. */
export function downloadCsv(filename: string, head: string[], lines: (string | number)[][], comment?: string) {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const body = [...(comment ? [`# ${comment}`] : []), head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\n")
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
