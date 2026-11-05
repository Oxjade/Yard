"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Heart, Search, ShoppingBag, User } from "lucide-react"
import { motion } from "motion/react"
import { marketNav, site } from "@/config/site"
import { useHydrated } from "@/hooks/use-hydrated"
import { useCart } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { useSearchOverlay } from "./search-overlay"
import { NotificationBell } from "@/components/feedback/notification-bell"

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

/** Floating Liquid Glass navigation. Sits over the hero, gains a little opacity once scrolled. */
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
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-2 pt-2 sm:px-4 sm:pt-3">
      <div
        className={cn(
          "glass pointer-events-auto mx-auto flex h-14 max-w-page items-center gap-4 rounded-2xl pr-2 pl-4 transition-[background-color,box-shadow] duration-300 sm:pl-5",
          scrolled && "bg-[var(--glass-bg-strong)]",
        )}
      >
        <Wordmark />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
          {marketNav.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative rounded-md px-3 py-2 text-sm transition-colors", active ? "text-ink" : "text-ink-2 hover:text-ink")}
              >
                {item.label}
                {active ? <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-purple" /> : null}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => openSearch(true)}
            className="hidden h-10 items-center gap-2 rounded-xl border border-white/8 bg-black/20 pr-2 pl-3 text-sm text-ink-3 transition hover:border-white/15 hover:text-ink-2 md:inline-flex md:w-56 xl:w-72"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 font-sans text-[10px] text-ink-3">⌘K</kbd>
          </button>
          <button type="button" onClick={() => openSearch(true)} aria-label="Search" className="inline-flex size-10 items-center justify-center rounded-xl text-ink-2 hover:bg-white/6 hover:text-ink md:hidden">
            <Search className="size-[19px]" />
          </button>
          <Link href="/wishlist" aria-label="Wishlist" className="hidden size-10 items-center justify-center rounded-xl text-ink-2 transition-colors duration-150 hover:bg-white/6 hover:text-ink sm:inline-flex">
            <Heart className="size-[19px]" />
          </Link>
          {hydrated && user ? <NotificationBell audience="customer" /> : null}
          <button type="button" onClick={openBag} aria-label={`Bag, ${hydrated ? count : 0} items`} className="relative inline-flex size-10 items-center justify-center rounded-xl text-ink-2 hover:bg-white/6 hover:text-ink">
            <motion.span key={`pulse-${pulse}`} initial={pulse ? { scale: 1.25, rotate: -8 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
              <ShoppingBag className="size-[19px]" />
            </motion.span>
            {hydrated && count > 0 ? (
              <motion.span
                key={`count-${count}`}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-acid px-1 text-[10px] font-semibold text-obsidian tabular"
              >
                {count}
              </motion.span>
            ) : null}
          </button>
          {hydrated && user ? (
            <Link href="/you" aria-label="Your World" className="ml-1 hidden size-9 items-center justify-center rounded-full bg-purple text-xs font-semibold text-ink sm:inline-flex">
              {user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => requireAuth("account")}
              className="ml-1 hidden h-10 items-center gap-2 rounded-xl px-3 text-sm text-ink-2 hover:bg-white/6 hover:text-ink sm:inline-flex"
            >
              <User className="size-[18px]" />
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
