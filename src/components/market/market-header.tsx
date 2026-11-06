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
import { bagCount } from "./bag-count"
import { BagPop } from "./bag-pop"
import { SearchCapsule } from "./search-capsule"
import { useSearchOverlay } from "./search-overlay"
import { wordmarkType } from "./wordmark-type"

/** The name as the logo, linking home. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn(wordmarkType, "text-[17px] sm:text-lg", className)} aria-label={`${site.name} home`}>
      {site.name}
    </Link>
  )
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

/** A floating group's backdrop, shown once the page has scrolled (see MarketHeader). */
/** "Bag, 1 item", "Bag, 3 items": the bag button's accessible name. */
const bagLabel = (count: number) => `Bag, ${count} ${count === 1 ? "item" : "items"}`

function Backdrop({ shown }: { shown: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 rounded-full border border-white/10 bg-obsidian/85 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-opacity duration-200 ease-out-quint",
        shown ? "opacity-100" : "opacity-0",
      )}
    />
  )
}

/** A minimal floating icon button: no box, a quiet circle on hover, a soft shadow for legibility over imagery. */
export const floatIcon =
  "icon-float relative inline-flex size-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-violet"

/**
 * Floating navigation: no bar. The wordmark, links and actions float over the page; a
 * faint top fade (not a container) keeps them legible over photography, deepening once
 * the page scrolls.
 *
 * Once the page has scrolled, headings pass underneath, so each floating group gets its own
 * backdrop (the black of the phone tab bar, slightly translucent, blurred): the wordmark with
 * the links, the search capsule, and the icon buttons. Never one full-width bar. The
 * backdrops fade in behind the groups and their padding is always reserved (offset by a
 * negative margin), so nothing moves when they appear.
 */
export function MarketHeader() {
  const pathname = usePathname()
  const hydrated = useHydrated()
  // Only lines that resolve to a piece, as the drawer lists them.
  const count = useCart((s) => bagCount(s.lines))
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
        {/* The wordmark and links: the same positions as without the backdrop (padding offset by
            margin). Its pill overhangs the gutter by as much as the icon pill does on the right
            (8px on phones, 12px from md), so the pair sits evenly between the screen edges. */}
        <div className="pointer-events-auto relative isolate -mx-2 flex h-10 items-center gap-10 px-2 md:-mx-3 md:px-3 lg:mr-0 lg:pr-0">
          <Backdrop shown={scrolled} />
          <Wordmark className="text-float" />

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
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
                  {active ? <motion.span layoutId="nav-dot" className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-purple shadow-[0_0_0_2px_rgba(8,8,8,0.6)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="pointer-events-auto ml-auto flex items-center gap-3">
          {/* The capsule already has its own glass; scrolled, it turns as solid as the other groups. */}
          <SearchCapsule className={cn("hidden md:flex", scrolled && "border-white/10 bg-obsidian/85 hover:bg-obsidian/95")} />
          {/* Its pill hugs the buttons (4px each side) and ends as far from the right edge as the
              wordmark's pill starts from the left, so the buttons sit 4px (8px from md) past the
              gutter, which lines their glyphs up with it. */}
          <div className="relative isolate -ml-1 -mr-2 flex h-10 items-center gap-0.5 px-1 sm:gap-1 md:-mr-3">
            <Backdrop shown={scrolled} />
            <button type="button" onClick={() => openSearch(true)} aria-label="Search" className={cn(floatIcon, "md:hidden")}>
              <MagnifyingGlassIcon className="size-[21px]" />
            </button>
            <Link href="/wishlist" aria-label="Wishlist" className={cn(floatIcon, "hidden sm:inline-flex")}>
              <HeartIcon className="size-[21px]" />
            </Link>
            {hydrated && user ? <NotificationBell audience="customer" className={floatIcon} /> : null}
            <div className="relative">
              <button type="button" onClick={openBag} aria-label={bagLabel(hydrated ? count : 0)} className={floatIcon}>
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
              <Link href="/you" className="ml-1 hidden size-9 items-center justify-center rounded-full bg-purple text-[11px] font-semibold text-ink ring-2 ring-black/40 transition-transform duration-150 hover:scale-[1.04] active:scale-95 sm:inline-flex">
                <span aria-hidden>{user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</span>
                <span className="sr-only">Your World</span>
              </Link>
            ) : (
              <button type="button" onClick={() => requireAuth("account")} aria-label="Sign in" className={cn(floatIcon, "hidden sm:inline-flex")}>
                <UserIcon className="size-[21px]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
