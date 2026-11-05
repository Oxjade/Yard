"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { SectionTabs, type SectionTab } from "../platform/section-tabs"

export type FinanceTab<T extends string> = SectionTab<T>

/**
 * Finance's sections, on the shared SectionTabs (same triggers, count chips and sliding
 * indicator as Security and Advertising). Two deliberate differences, both because Finance
 * has seven sections and most of them hold more than one panel (the flagged-transactions
 * note above the ledger, provider summaries above reconciliation, the request form beside
 * the adjustments list, the chart above the commission report):
 *
 * - The tab row sits on the page, not as the top row of one panel, so those panels aren't
 *   nested inside another card. The panels start a page gap (gap-5) below it.
 * - SectionTabs' phone layout is an even grid, which fits three or four tabs; seven would be
 *   about 50px each. On phones the row runs edge to edge and scrolls instead, keeping the
 *   selected tab in view.
 */
export function FinanceTabs<T extends string>({ tabs, value, onValueChange, children }: { tabs: FinanceTab<T>[]; value: T; onValueChange: (v: T) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>(':scope > div > div > [role="tablist"]')
    const el = list?.querySelector<HTMLElement>('[data-state="active"]')
    if (!list || !el || list.scrollWidth <= list.clientWidth) return
    const left = el.offsetLeft - 16
    const right = el.offsetLeft + el.offsetWidth + 16 - list.clientWidth
    if (list.scrollLeft > left) list.scrollTo({ left, behavior: "smooth" })
    else if (list.scrollLeft < right) list.scrollTo({ left: right, behavior: "smooth" })
  }, [value])

  return (
    <div
      ref={ref}
      className={cn(
        "min-w-0",
        // Phones: bleed to the screen edges and scroll, rather than SectionTabs' even grid.
        "max-md:-mx-4",
        // Scoped with child combinators to this row only (root > bar > list), never to tabs inside a section.
        "max-md:[&>div>div>[role=tablist]]:flex max-md:[&>div>div>[role=tablist]]:overflow-x-auto max-md:[&>div>div>[role=tablist]]:px-2 max-md:[&>div>div>[role=tablist]]:[scrollbar-width:none] max-md:[&>div>div>[role=tablist]::-webkit-scrollbar]:hidden",
        "max-md:[&>div>div>[role=tablist]>[role=tab]]:shrink-0 max-md:[&>div>div>[role=tablist]>[role=tab]]:px-2.5 max-md:[&>div>div>[role=tablist]>[role=tab]]:text-[13px]",
        // From tablet up: the row lines up with the page's left edge, as the panels below it do.
        "md:[&>div>div>[role=tablist]]:px-0",
      )}
    >
      <SectionTabs label="Finance sections" tabs={tabs} value={value} onValueChange={onValueChange}>
        <div className="min-w-0 pt-5 max-md:px-4">{children}</div>
      </SectionTabs>
    </div>
  )
}
