"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * The panel's scrolling section list. When the list is taller than the panel (short desktop
 * windows, phones), its clipped edge fades out (a mask, not a colour) so it reads as
 * scrollable, and the current section is scrolled into view on every route change.
 */
export function NavScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const top = el.scrollTop > 1
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
      const fade = top && bottom ? "both" : top ? "top" : bottom ? "bottom" : ""
      if (el.dataset.fade !== fade) el.dataset.fade = fade
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [])

  // Keep the current section visible. Only this list scrolls, never the page.
  useEffect(() => {
    const el = ref.current
    const item = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !item) return
    const box = el.getBoundingClientRect()
    const r = item.getBoundingClientRect()
    const margin = 24
    if (r.top < box.top + margin) el.scrollTop += r.top - box.top - margin
    else if (r.bottom > box.bottom - margin) el.scrollTop += r.bottom - box.bottom + margin
  }, [pathname])

  return (
    <div ref={ref} className="shell-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[13px] pt-2 pb-2 sidebar-shorter:py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-h-full flex-col">{children}</div>
    </div>
  )
}
