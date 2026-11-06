"use client"

import { useEffect, useState } from "react"
import { CaretDownIcon, InfoIcon } from "@phosphor-icons/react"
import { Accordion as AccordionPrimitive } from "radix-ui"

const INTRO_KEY = "nocturne-charts-intro"

/**
 * "How Charts work" (§6.3): open by itself on the viewer's first visit (remembered per viewer in
 * localStorage, every access wrapped, so blocked storage only means it starts closed), closed after.
 */
export function HowChartsWork() {
  const [value, setValue] = useState<string>("")
  useEffect(() => {
    let seen = true
    try {
      seen = window.localStorage.getItem(INTRO_KEY) !== null
      if (!seen) window.localStorage.setItem(INTRO_KEY, JSON.stringify({ v: 1, seenAt: new Date().toISOString() }))
    } catch {
      seen = true
    }
    // First visit only: open it once storage says this viewer hasn't seen it (client-only state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setValue("how")
  }, [])

  return (
    <AccordionPrimitive.Root type="single" collapsible value={value} onValueChange={setValue} className="rounded-lg border border-line-soft bg-surface/60">
      <AccordionPrimitive.Item value="how">
        <AccordionPrimitive.Header>
          <AccordionPrimitive.Trigger className="group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-4 text-left text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet">
            <InfoIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
            <span className="flex-1 font-medium">How Charts work</span>
            <CaretDownIcon className="size-4 shrink-0 text-ink-2 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="grid gap-x-10 gap-y-4 border-t border-line-soft px-4 pt-4 pb-5 text-sm leading-relaxed text-ink-2 md:grid-cols-2">
            <Point title="What counts">Follows, saves, product and storefront views, drop reminders, messages and post opens, plus orders. Follower growth, views and saves carry most of the weight, and an account adds at most one follow per brand however often it taps.</Point>
            <Point title="Sales are capped">Orders and sales make up at most a quarter of a brand&apos;s score, so no chart is ranked by sales alone.</Point>
            <Point title="Newer brands get a lift">Brands under 30,000 followers that joined in the last 18 months get a small boost on Top brands, Trending and City charts.</Point>
            <Point title="Unusual activity is left out">Bursts from new accounts, one network or coordinated follows are excluded. A brand under review is held off the charts until Yard decides.</Point>
            <Point title="Sponsored is separate">Paid placements appear in their own labelled strip. They never change a chart position.</Point>
            <Point title="In this build">
              Rankings include sample activity, and order signals aren&apos;t connected yet: there is no payment provider, so orders come from the sample activity only.
            </Point>
          </div>
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  )
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-ink">{title}</p>
      <p>{children}</p>
    </div>
  )
}
