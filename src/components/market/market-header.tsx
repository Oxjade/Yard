"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HeartIcon, MagnifyingGlassIcon, ShoppingBagOpenIcon, UserIcon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { marketNav, site } from "@/config/site"
import { useHydrated } from "@/hooks/use-hydrated"
import { useCart } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { NotificationBell } from "@/components/feedback/notification-bell"
import { BagPop } from "./bag-pop"
import { SearchCapsule } from "./search-capsule"
import { useSearchOverlay } from "./search-overlay"

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("font-wide chrome-text text-[15px] leading-none tracking-[0.14em] sm:text-base", className)} aria-label={`${site.name} home`}>
      {site.name}
    </Link>
  )
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

/** A minimal floating icon button: no box, a quiet circle on hover, a soft shadow for legibility over imagery. */
export const floatIcon =
  "icon-float relative inline-flex size-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-violet"

/**
 * Floating navigation: no bar. The wordmark, links and actions float over the page; a
 * faint top fade (not a container) keeps them legible over photography, deepening once
 * the page scrolls.
 */
export function MarketHeader() {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const count = useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0))
  const pulse = useCart((s) => s.pulse)
  const openBag = useCart((s) => s.open)
  const user = useSession((s) => s.user)
  const requireAuth = useSession((s) => s.requireAuth)
  const openSearch = useSearchOverlay((s) => s.setOpen)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40">
      {/* Legibility fade — sits behind the floating items, never boxes them */}
      <div aria-hidden className={cn("absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-obsidian/80 via-obsidian/35 to-transparent transition-opacity duration-300", scrolled ? "opacity-100" : "opacity-60")} />

      <div className="relative mx-auto flex h-[4.5rem] max-w-page items-center gap-6 px-4 md:px-8">
        <Wordmark className="text-float pointer-events-auto" />

        <nav aria-label="Main" className="pointer-events-auto ml-4 hidden items-center gap-1 lg:flex">
          {marketNav.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("text-float relative rounded-full px-3 py-2 text-[13.5px] transition-colors duration-150", active ? "text-ink" : "text-ink/70 hover:text-ink")}
              >
                {item.label}
                {active ? <motion.span layoutId="nav-dot" className="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-purple shadow-[0_0_0_2px_rgba(8,8,8,0.6)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
              </Link>
            )
          })}
        </nav>

        <div className="pointer-events-auto ml-auto flex items-center gap-0.5 sm:gap-1">
          <SearchCapsule className="mr-2 hidden md:flex" />
          <button type="button" onClick={() => openSearch(true)} aria-label="Search" className={cn(floatIcon, "md:hidden")}>
            <MagnifyingGlassIcon className="size-[21px]" />
          </button>
          <Link href="/wishlist" aria-label="Wishlist" className={cn(floatIcon, "hidden sm:inline-flex")}>
            <HeartIcon className="size-[21px]" />
          </Link>
          {hydrated && user ? <NotificationBell audience="customer" className={floatIcon} /> : null}
          <div className="relative">
            <button type="button" onClick={openBag} aria-label={`Bag, ${hydrated ? count : 0} items`} className={floatIcon}>
              <motion.span key={`pulse-${pulse}`} initial={pulse ? { scale: 1.22, rotate: -10 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 16 }} className="inline-flex">
                <ShoppingBagOpenIcon className="size-[21px]" />
              </motion.span>
              {hydrated && count > 0 ? (
                <motion.span
                  key={`count-${count}`}
                  initial={{ scale: 0.4 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 600, damping: 22 }}
                  className="absolute top-1 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-acid px-1 text-[10px] font-semibold text-obsidian tabular"
                >
                  {count}
                </motion.span>
              ) : null}
            </button>
            <BagPop />
          </div>
          {hydrated && user ? (
            <Link href="/you" aria-label="Your World" className="ml-1 hidden size-9 items-center justify-center rounded-full bg-purple text-[11px] font-semibold text-ink ring-2 ring-black/40 transition-transform duration-150 hover:scale-[1.04] active:scale-95 sm:inline-flex">
              {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </Link>
          ) : (
            <button type="button" onClick={() => requireAuth("account")} aria-label="Sign in" className={cn(floatIcon, "hidden sm:inline-flex")}>
              <UserIcon className="size-[21px]" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
