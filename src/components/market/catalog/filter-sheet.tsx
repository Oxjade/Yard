"use client"

import { useMemo } from "react"
import { XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import { filterProducts, panelFilterCount, type CatalogState } from "./catalog-state"
import { FilterControls, type FilterPatch } from "./filter-controls"

/**
 * The phone filter sheet: a floating Liquid Glass panel that springs up from the bottom.
 * It edits a draft; "Show N results" applies it, closing discards it.
 */
export function FilterSheet({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onApply,
  onClear,
  currency,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CatalogState
  onDraftChange: (patch: FilterPatch) => void
  onApply: () => void
  onClear: () => void
  currency: CurrencyCode
}) {
  const count = useMemo(() => filterProducts(draft).length, [draft])
  const active = panelFilterCount(draft)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[6px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 bottom-2 z-50 mx-auto flex max-h-[min(88dvh,760px)] max-w-lg flex-col overflow-hidden rounded-2xl outline-none sm:bottom-3"
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                exit={{ y: "105%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
                <header className="flex items-center justify-between px-5 pt-3 pb-3">
                  <DialogPrimitive.Title className="flex items-baseline gap-2">
                    <span className="font-display text-display-sm">Filter and sort</span>
                    {active ? <span className="text-sm text-ink-2 tabular">{active} active</span> : null}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/8 hover:text-ink" aria-label="Close filters">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </header>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-6">
                  <FilterControls state={draft} onChange={onDraftChange} currency={currency} showSort />
                </div>

                <footer className="grid grid-cols-[auto_1fr] gap-2 border-t border-white/8 bg-black/20 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                  <Button variant="secondary" size="lg" onClick={onClear} disabled={active === 0}>
                    Clear all
                  </Button>
                  <Button variant="primary" size="lg" onClick={onApply} disabled={count === 0} className="tabular">
                    {count === 0 ? "No results" : `Show ${count} ${count === 1 ? "result" : "results"}`}
                  </Button>
                </footer>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
