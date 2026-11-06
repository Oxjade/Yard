"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { cn } from "@/lib/utils"

const items = [
  { href: "/you", label: "Overview", exact: true },
  { href: "/following", label: "Following", count: "following" },
  { href: "/wishlist", label: "Wishlist", count: "wishlist" },
  { href: "/you/orders", label: "Orders", count: "orders" },
  { href: "/you/settings", label: "Settings" },
] as const

type Fade = "none" | "start" | "end" | "both"

/** A 32px fade at each edge that has more tabs to scroll to, so the strip reads as scrollable. */
const fadeMask: Record<Exclude<Fade, "none">, string> = {
  start: "linear-gradient(to right, transparent, #000 32px)",
  end: "linear-gradient(to right, #000 calc(100% - 32px), transparent)",
  both: "linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent)",
}

/**
 * The sub-navigation of Your World. The underline travels between tabs with a shared layoutId.
 * On phones the strip scrolls sideways: it opens with the current tab in view, and an edge
 * fades while there are more tabs beyond it.
 */
export function YouNav({ className }: { className?: string }) {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const following = useSaved((s) => s.following.length)
  const wishlist = useSaved((s) => s.wishlist.length)
  const orders = useOrders((s) => s.groups.length)
  const counts = { following, wishlist, orders }
  const navRef = useRef<HTMLElement>(null)
  const [fade, setFade] = useState<Fade>("none")

  // Bring the current tab into view (horizontally only, so the page itself never jumps), then
  // keep the edge fades in step with the strip's scroll position and width.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]')
    if (active) {
      // Clear of the 32px edge fade.
      const gutter = 40
      const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
      const right = left + active.offsetWidth
      if (left - gutter < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - gutter)
      else if (right + gutter > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right + gutter - nav.clientWidth
    }
    const update = () => {
      const max = nav.scrollWidth - nav.clientWidth
      const start = nav.scrollLeft > 1
      const end = nav.scrollLeft < max - 1
      setFade(start && end ? "both" : start ? "start" : end ? "end" : "none")
    }
    update()
    nav.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(nav)
    return () => {
      nav.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [pathname, hydrated])

  return (
    <nav
      ref={navRef}
      aria-label="Your World"
      className={cn("rail -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}
      style={fade === "none" ? undefined : { maskImage: fadeMask[fade], WebkitMaskImage: fadeMask[fade] }}
    >
      <ul className="flex min-w-max items-center gap-1 border-b border-line-soft">
        {items.map((item) => {
          const active = "exact" in item ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
          const count = "count" in item && hydrated ? counts[item.count] : null
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-11 items-center gap-2 px-3 text-sm transition-colors", active ? "text-ink" : "text-ink-2 hover:text-ink")}
              >
                {item.label}
                {count ? <span className="tabular text-xs text-ink-3">{count}</span> : null}
                {active ? <motion.span layoutId="you-nav-underline" className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-purple" /> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
