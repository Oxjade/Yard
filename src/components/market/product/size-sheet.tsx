"use client"

import { XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"

/**
 * The phone size sheet, opened from the floating add-to-bag bar. Built like the market's
 * other phone sheet (catalog/filter-sheet.tsx): a floating Liquid Glass panel that springs
 * up from the bottom, with a handle, a display title, the choices and a footer action.
 */
export function SizeSheet({
  open,
  onOpenChange,
  title,
  titleId,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Id on the visible title text, so the size radio group inside can be labelled by it. */
  titleId: string
  description: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
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
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 bottom-2 z-50 mx-auto flex max-h-[min(88dvh,760px)] max-w-lg flex-col overflow-hidden rounded-2xl outline-none sm:bottom-3"
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                exit={{ y: "105%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
                <header className="flex items-start justify-between gap-3 px-5 pt-3 pb-3">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="font-display text-display-sm">
                      <span id={titleId}>{title}</span>
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-1 truncate text-sm text-ink-2">{description}</DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/8 hover:text-ink" aria-label="Close size selection">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </header>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>

                <footer className="grid gap-3 border-t border-white/8 bg-black/20 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{footer}</footer>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
