"use client"

import { useEffect, useId, useRef } from "react"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { RevealItem } from "@/components/admin/ui/motion"
import { cn } from "@/lib/utils"

/**
 * The title block of a Control Center index page, in the Overview's type: the sample-data
 * marker, an expanded heading, one line on what the page is for, and an optional quiet note
 * (what a decision here does and doesn't do in this build). No panel around it, so the
 * headline figures below are the first surface.
 */
export function AdminPageHead({ title, description, note, actions, className }: { title: string; description: string; note?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  // Unique per page: a route kept for back and forward stays in the document, hidden.
  const id = useId()
  return (
    <RevealItem as="section" aria-labelledby={id} className={cn("flex flex-col gap-4 px-1 pt-1 pb-2 @2xl:flex-row @2xl:items-end @2xl:justify-between", className)}>
      <div className="min-w-0">
        <SampleDataNote />
        <h1 id={id} className="font-label mt-4 text-[clamp(1.5rem,2.6vw,2rem)] leading-tight text-ink">{title}</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">{description}</p>
        {note ? <div className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-3">{note}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </RevealItem>
  )
}

/**
 * The rail a Segmented sits in at the top of a panel: scrolls sideways on phones rather than
 * wrapping, and keeps the selected option (`value`) in view when it changes or is linked to.
 */
export function PanelRail({ children, className, value }: { children: React.ReactNode; className?: string; value?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = ref.current
    const on = rail?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!rail || !on || rail.scrollWidth <= rail.clientWidth) return
    const left = on.offsetLeft - 16
    const right = on.offsetLeft + on.offsetWidth + 16 - rail.clientWidth
    if (rail.scrollLeft > left) rail.scrollTo({ left, behavior: "smooth" })
    else if (rail.scrollLeft < right) rail.scrollTo({ left: right, behavior: "smooth" })
  }, [value])
  return (
    <div ref={ref} className={cn("rail shrink-0 overflow-x-auto px-4 pb-3 md:px-5", className)}>
      {children}
    </div>
  )
}

/**
 * The headline figures. Four across on wide screens, two by two on tablets; on phones a row
 * you swipe through (each card snaps into place), so the table below is one glance away
 * rather than four screens of cards down.
 */
export function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 @lg:mx-0 @lg:grid @lg:grid-cols-2 @lg:overflow-visible @lg:px-0 @5xl:grid-cols-4 [&>*]:w-[80%] [&>*]:shrink-0 [&>*]:snap-start @lg:[&>*]:w-auto"
    >
      {children}
    </section>
  )
}
