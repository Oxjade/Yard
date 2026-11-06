"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { useSearchOverlay } from "./search-overlay"

const suggestions = ["kente coats", "silver chains", "numbered sneakers", "risograph prints", "matte stoneware", "night fragrance", "leather bags", "Lagos streetwear"]

/**
 * The search capsule: a floating pill whose placeholder rolls through real catalogue
 * searches. Rolling pauses on hover/focus and stops entirely for reduced motion.
 * Opens the full search overlay (⌘K).
 */
export function SearchCapsule({ className, compact = false }: { className?: string; compact?: boolean }) {
  const open = useSearchOverlay((s) => s.setOpen)
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduce || paused) return
    const id = window.setInterval(() => setI((x) => (x + 1) % suggestions.length), 2600)
    return () => window.clearInterval(id)
  }, [reduce, paused])

  return (
    <button
      type="button"
      onClick={() => open(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-label="Search brands and products"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "group pointer-events-auto relative flex h-10 items-center gap-2.5 rounded-full border border-white/12 bg-black/45 pr-2 pl-3.5 text-left text-[13px] text-ink-2 backdrop-blur-xl transition-[border-color,background-color,width] duration-200 ease-out-quint hover:border-white/25 hover:bg-black/60",
        compact ? "w-10 justify-center px-0" : "w-60 xl:w-72",
        className,
      )}
    >
      <MagnifyingGlassIcon className="size-[17px] shrink-0 text-ink" weight="regular" />
      {!compact ? (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap">
            <span className="text-ink-3">Search</span>
            <span className="relative block h-5 flex-1 overflow-hidden" aria-hidden>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={i}
                  className="absolute inset-0 truncate text-ink-2"
                  initial={{ y: "100%", opacity: 0 }}
                  animate={{ y: "0%", opacity: 1 }}
                  exit={{ y: "-100%", opacity: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.8 }}
                >
                  “{suggestions[i]}”
                </motion.span>
              </AnimatePresence>
            </span>
          </span>
          {/* A visual hint; the shortcut itself is announced through aria-keyshortcuts, so the
              visible label ("Search") stays the start of the button's name. */}
          <kbd aria-hidden className="hidden shrink-0 rounded-full border border-white/12 px-2 py-0.5 font-sans text-[10px] text-ink-3 lg:inline">⌘K</kbd>
        </>
      ) : null}
    </button>
  )
}
