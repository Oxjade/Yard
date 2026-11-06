"use client"

import { useSyncExternalStore } from "react"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true })
  return () => window.removeEventListener("scroll", onChange)
}

/** Whether the page has scrolled away from the top (false on the server and at the top). */
export function useScrolled(threshold = 4) {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > threshold,
    () => false,
  )
}

/**
 * The top bar: transparent over the top of the page; once the page scrolls, a quiet backdrop
 * and a hairline fade in (opacity only, nothing moves). Its row sits 12px from the top, the
 * same inset as the floating panel, so the two headers line up. The row uses the same
 * container as <main> (centred, max 1400px, same padding), so on wide screens the search
 * shares the page's left edge and the bell its right edge; the backdrop stays full width.
 */
export function TopBar({ surface, menu, search, actions, padding }: { surface: "studio" | "admin"; menu: React.ReactNode; search: React.ReactNode; actions: React.ReactNode; padding: string }) {
  const scrolled = useScrolled()
  return (
    <header className="sticky top-0 z-20 pt-3">
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 backdrop-blur-xl transition-opacity duration-200", surface === "admin" ? "bg-[#080808]/85" : "bg-obsidian/80", scrolled ? "opacity-100" : "opacity-0")} />
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.07] transition-opacity duration-200", scrolled ? "opacity-100" : "opacity-0")} />
      <div className={cn("relative mx-auto flex h-16 w-full max-w-[1400px] items-center gap-2", padding)}>
        {menu}
        {search}
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  )
}

/** The search capsule that opens the command palette. */
export function SearchTrigger({ placeholder, onOpen }: { placeholder: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-keyshortcuts="/ Control+K Meta+K"
      className="group/search flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.025] pr-1.5 pl-3.5 text-left text-[13px] text-ink-3 transition-colors duration-150 hover:border-white/[0.14] hover:text-ink-2 sm:max-w-[400px]"
    >
      <MagnifyingGlassIcon aria-hidden className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="sm:hidden">Search</span>
        <span className="hidden sm:inline">{placeholder}</span>
      </span>
      <kbd aria-hidden className="hidden h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-2 font-sans text-[12px] leading-none text-ink-2 sm:inline-flex">
        /
      </kbd>
    </button>
  )
}
