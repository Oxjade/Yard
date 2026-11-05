"use client"

import { useId } from "react"
import { motion } from "motion/react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

export type SectionTab<T extends string> = {
  value: T
  label: string
  /** Shorter label for phones. */
  short?: string
  count?: number
  /** Acid count chip: something here needs a decision. */
  urgent?: boolean
}

/**
 * Section tabs for a platform screen. The selected tab carries the purple underline, which
 * slides between tabs; the panel content cross-fades on change.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  toolbar,
  children,
}: {
  tabs: SectionTab<T>[]
  value: T
  onValueChange: (v: T) => void
  label: string
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
                  "relative flex h-11 min-w-0 items-center justify-center gap-1.5 px-1.5 text-[12px] whitespace-nowrap transition-colors outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset md:shrink-0 md:px-2.5 md:text-[13px]",
                  on ? "text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                <span className="truncate">
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
                      "rounded-[4px] px-1 text-[10px] leading-4 font-semibold tabular md:px-1.5",
                      t.urgent && t.count > 0 ? "bg-acid text-obsidian" : on ? "bg-purple/20 text-violet" : "bg-white/6 text-ink-3",
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
                {on ? <motion.span layoutId={`${id}-indicator`} className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-purple md:inset-x-2" aria-hidden /> : null}
              </TabsPrimitive.Trigger>
            )
          })}
        </TabsPrimitive.List>
        {toolbar ? <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:flex-nowrap md:justify-end md:px-0 md:pb-0">{toolbar}</div> : null}
      </div>
      <TabsPrimitive.Content value={value} className="outline-none" asChild>
        <motion.div key={value} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
          {children}
        </motion.div>
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  )
}
