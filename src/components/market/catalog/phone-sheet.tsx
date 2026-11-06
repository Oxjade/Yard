"use client"

import { useRef } from "react"
import { XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * The marketplace's phone bottom sheet (filters on the listing, sizes on the product page):
 * a floating Liquid Glass panel that springs up from the bottom. The handle is real: drag the
 * header down to dismiss (or tap outside, press Escape, or use the close button). Radix keeps
 * focus inside while it is open; useReturnFocus hands it back to the opener afterwards.
 *
 * Why not ui/sheet's SheetContent side="bottom": that one is an edge-to-edge panel animated by
 * CSS enter/exit classes, with its overlay and close button built in. This sheet has to follow
 * the finger (a motion drag with elastic and a velocity dismiss), spring with spring.drawer and
 * float inset as glass, none of which SheetContent can take without a rewrite. It sits on the
 * same Radix Dialog primitive, so focus trapping, Escape and outside press behave the same.
 */
export function PhoneSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  footerClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The title's contents (rendered inside Dialog.Title). */
  title: React.ReactNode
  description?: React.ReactNode
  closeLabel: string
  children: React.ReactNode
  footer: React.ReactNode
  footerClassName?: string
}) {
  const drag = useDragControls()
  const returnFocus = useReturnFocus()

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 96 || info.velocity.y > 600) onOpenChange(false)
  }

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
                transition={{ duration: duration.drawer, ease: ease.out }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount {...returnFocus} {...(description ? {} : { "aria-describedby": undefined })}>
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 bottom-2 z-50 mx-auto flex max-h-[min(88dvh,760px)] max-w-lg flex-col overflow-hidden rounded-2xl outline-none sm:bottom-3"
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                exit={{ y: "105%" }}
                transition={spring.drawer}
                drag="y"
                dragControls={drag}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={onDragEnd}
              >
                {/* Drag area: the handle and the title row (not the close button). */}
                <div
                  className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
                  onPointerDown={(e) => {
                    if ((e.target as Element).closest("button")) return
                    drag.start(e)
                  }}
                >
                  <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15" aria-hidden />
                  <header className="flex items-start justify-between gap-3 px-5 pt-3 pb-3">
                    <div className="min-w-0">
                      <DialogPrimitive.Title className="flex items-baseline gap-2 font-display text-display-sm">{title}</DialogPrimitive.Title>
                      {description ? <DialogPrimitive.Description className="mt-1 truncate text-sm text-ink-2">{description}</DialogPrimitive.Description> : null}
                    </div>
                    <DialogPrimitive.Close
                      className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-[background-color,color,transform,scale] duration-150 hover:bg-white/8 hover:text-ink active:scale-95"
                      aria-label={closeLabel}
                    >
                      <X className="size-5" />
                    </DialogPrimitive.Close>
                  </header>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-6">{children}</div>

                <footer className={cn("border-t border-white/8 bg-black/20 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]", footerClassName)}>{footer}</footer>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

/**
 * Radix's modal dialog sends focus back to its <Dialog.Trigger> on close. A dialog opened from a
 * controlled button (no Trigger) would drop focus on <body>, so this remembers whatever had focus
 * when it opened and restores it, if that element is still on the page.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current
      if (!el?.isConnected) return
      e.preventDefault()
      el.focus({ preventScroll: true })
    },
  }
}
