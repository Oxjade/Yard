"use client"

import { useEffect, useId, useRef } from "react"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { RevealItem } from "@/components/admin/ui/motion"
import { cn } from "@/lib/utils"

/**
 * The title block of a Control Center index page, in the Overview's type: the sample-data
 * marker (left out on `live` pages that read the server), an expanded heading, one line on what the page is for, and an optional quiet note
 * (what a decision here does and doesn't do in this build). No panel around it, so the
 * headline figures below are the first surface.
 */
export function AdminPageHead({ title, description, note, actions, className, live = false }: { title: string; description: string; note?: React.ReactNode; actions?: React.ReactNode; className?: string; /** The page reads the server, not sample data: no sample marker. */ live?: boolean }) {
  // Unique per page: a route kept for back and forward stays in the document, hidden.
  const id = useId()
  return (
    <RevealItem as="section" aria-labelledby={id} className={cn("flex flex-col gap-4 px-1 pt-1 pb-2 @2xl:flex-row @2xl:items-end @2xl:justify-between", className)}>
      <div className="min-w-0">
        {live ? null : <SampleDataNote />}
        <h1 id={id} className={cn("font-label text-[clamp(1.5rem,2.6vw,2rem)] leading-tight text-ink", !live && "mt-4")}>{title}</h1>
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
 * The headline figures. Four across on wide screens, two by two below that. On phones the
 * cards turn compact (tighter padding and label, no icon, a smaller numeral, no hint line), so
 * all four figures fit in one glance above the table instead of a row you swipe through. The styles
 * reach into StatCard's parts (its article, numeral row and hint), so every index page gets
 * the same compact card without a prop on each one.
 */
export function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-2 @lg:gap-3 @5xl:grid-cols-4",
        "@max-lg:[&_article]:p-3 @max-lg:[&_article>div:first-child]:gap-2 @max-lg:[&_article_h3]:text-[10.5px] @max-lg:[&_article_h3]:tracking-[0.06em] @max-lg:[&_article_h3>svg]:hidden",
        "@max-lg:[&_article>div:nth-child(2)]:mt-3 @max-lg:[&_article>div:nth-child(2)]:min-h-8 @max-lg:[&_article>p]:hidden",
        "@max-lg:[&_article_.font-metric]:text-[1.625rem] @max-lg:[&_article>div:nth-child(2)>span[aria-hidden]]:h-7 @max-lg:[&_article>div:nth-child(2)>span[aria-hidden]]:w-20",
      )}
    >
      {children}
    </section>
  )
}
