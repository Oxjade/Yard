"use client"

import { SampleDataNote } from "@/components/dashboard/page-header"
import { longDate, today } from "@/components/dashboard/insight/derive"
import { RevealItem } from "@/components/admin/ui/motion"
import { cn } from "@/lib/utils"

/**
 * The head of a platform screen (advertising, health, security, notifications), written like
 * the Overview's command strip: the sample-data mark and the day the figures count to, the
 * title, what the screen is for, and one live line on what needs a person right now.
 */
export function PlatformHead({
  title,
  description,
  status,
  attention = false,
  ready = true,
  actions,
}: {
  title: string
  description: string
  /** One sentence on the state of things; a same-size skeleton holds its place until `ready`. */
  status?: React.ReactNode
  /** The status needs a person (acid dot) rather than reporting all clear (violet dot). */
  attention?: boolean
  ready?: boolean
  actions?: React.ReactNode
}) {
  return (
    <RevealItem as="section" aria-labelledby="platform-title" className="admin-panel admin-panel-glow overflow-hidden rounded-[20px]">
      <div className="relative flex flex-col gap-5 p-5 md:p-6 @3xl:flex-row @3xl:items-end @3xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <SampleDataNote />
            <span className="text-[12px] text-ink-3 tabular">{longDate(today)}</span>
          </div>
          <h1 id="platform-title" className="font-label mt-4 text-[clamp(1.5rem,2.6vw,2rem)] leading-tight text-ink">{title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">{description}</p>
          {status !== undefined ? (
            <p className="mt-3 flex min-h-5 items-start gap-2 text-[13px] text-ink">
              {ready ? (
                <>
                  <span aria-hidden className={cn("mt-[7px] inline-flex size-1.5 shrink-0 rounded-full", attention ? "bg-acid" : "bg-violet")} />
                  <span className="min-w-0">{status}</span>
                </>
              ) : (
                <span aria-hidden className="skeleton inline-block h-3.5 w-72 max-w-full rounded align-middle" />
              )}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </RevealItem>
  )
}
