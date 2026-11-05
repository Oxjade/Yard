"use client"

import { useId } from "react"
import { motion } from "motion/react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

export type QueueTab<T extends string> = {
  value: T
  label: string
  /** Shorter label for the phone layout. */
  short?: string
  count?: number
  /** Acid count chip: this queue needs a decision. */
  urgent?: boolean
  /** Visually separates this tab from the status tabs before it. */
  divider?: boolean
}

/**
 * Status tabs for an Admin queue. The selected tab carries the purple indicator, which
 * slides between tabs; counts sit beside each label.
 */
export function QueueTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  toolbar,
  children,
}: {
  tabs: QueueTab<T>[]
  value: T
  onValueChange: (v: T) => void
  label: string
  /** Search and filters, shown right of the tabs on desktop and under them on phones. */
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-line-soft md:flex-row md:items-center md:justify-between md:gap-4 md:pr-3">
        <TabsPrimitive.List aria-label={label} className="-mb-px grid min-w-0 auto-cols-fr grid-flow-col px-1 md:flex md:items-stretch md:overflow-x-auto md:px-2 md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const on = t.value === value
            return (
              <TabsPrimitive.Trigger
                key={t.value}
                value={t.value}
                className={cn(
                  // Phones: an even row of count-over-label cells, so every status is visible without scrolling.
                  "relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[11px] whitespace-nowrap transition-colors outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset",
                  "md:h-11 md:shrink-0 md:flex-row md:gap-1.5 md:px-2.5 md:py-0 md:text-[13px]",
                  on ? "text-ink" : "text-ink-2 hover:text-ink",
                  t.divider && "before:absolute before:top-1/2 before:left-0 before:h-6 before:w-px before:-translate-y-1/2 before:bg-line md:ml-2 md:before:-left-1 md:before:h-4",
                )}
              >
                <span className="max-w-full truncate">
                  {t.short ? (
                    <>
                      <span className="md:hidden">{t.short}</span>
                      <span className="hidden md:inline">{t.label}</span>
                    </>
                  ) : (
                    t.label
                  )}
                </span>
                {t.count !== undefined ? (
                  <span
                    className={cn(
                      "order-first text-[15px] leading-5 font-medium tabular md:order-none md:rounded-[4px] md:px-1.5 md:text-[10px] md:leading-4 md:font-semibold",
                      t.urgent && t.count > 0 ? "text-acid md:bg-acid md:text-obsidian" : on ? "text-ink md:bg-purple/20 md:text-violet" : "text-ink-2 md:bg-white/6 md:text-ink-3",
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
                {on ? <motion.span layoutId={`${id}-indicator`} className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-purple" aria-hidden /> : null}
              </TabsPrimitive.Trigger>
            )
          })}
        </TabsPrimitive.List>
        {toolbar ? <div className="flex flex-wrap items-center gap-2 px-3 pb-3 md:justify-end md:px-0 md:pb-0">{toolbar}</div> : null}
      </div>
      <TabsPrimitive.Content value={value} className="outline-none">
        {children}
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  )
}
