"use client"

import { useCallback, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HandbagIcon, HouseSimpleIcon, MagnifyingGlassIcon, MapPinIcon, UserCircleIcon, type Icon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { useUnread } from "@/lib/realtime/unread"
import { useServerSession } from "@/lib/session/use-server-session"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import { bagCount } from "./bag-count"
import { BagPop, useLgUp } from "./bag-pop"
import { cartLabel } from "./market-header"
import { useSearchOverlay } from "./search-overlay"

type Tab = "home" | "explore" | "around" | "cart" | "me"

const starts = (pathname: string, bases: string[]) => bases.some((b) => pathname === b || pathname.startsWith(`${b}/`))

/** Which tab a route belongs to (§7.2 Matches). Explore covers every browse page, so its label stays true there. */
export function tabFor(pathname: string): Tab | null {
  if (pathname === "/" || starts(pathname, ["/welcome"])) return "home"
  if (starts(pathname, ["/around"])) return "around"
  if (starts(pathname, ["/bag", "/checkout"])) return "cart"
  if (starts(pathname, ["/you", "/following", "/wishlist", "/inbox", "/notifications", "/sign-in"])) return "me"
  if (starts(pathname, ["/shop", "/categories", "/brands", "/charts", "/drops", "/stories", "/collections", "/products"])) return "explore"
  return null
}

/**
 * The phone home bar (§7.2, after the owner's pin 5gWDq1nnC.jpg): a black capsule with Home and
 * Explore on the left, the raised Around pin in the centre, and Cart and Me on the right.
 *
 * - The active side tab is a purple pill with the filled icon and its label (below 380px the
 *   label goes to screen readers only and the pill closes to a filled disc). Inactive tabs are
 *   44px icons with screen-reader labels.
 * - Home and Me are links and carry `aria-current="page"` on their own page. Explore and Cart are
 *   buttons (they open the search overlay and the cart drawer): their active pill is visual only,
 *   and Explore says `aria-expanded` while the overlay is open. They never carry `aria-current`.
 * - The pin is a 56px ink disc raised above the bar with an obsidian ring and a faint grey band
 *   (the owner's grey ring, inverted for a black bar); on /around it turns purple.
 * - The two halves are equal grid columns, so the pin sits exactly in the middle at any width.
 * - Me shows a violet dot while the Inbox has unread conversations ("Me, 2 unread messages").
 */
export function MobileTabBar() {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const lgUp = useLgUp()
  const overlayOpen = useSearchOverlay((s) => s.open)
  const setOverlay = useSearchOverlay((s) => s.setOpen)
  const cartOpen = useCart((s) => s.isOpen)
  const openCart = useCart((s) => s.open)
  const count = useCart((s) => bagCount(s.lines))
  const pulse = useCart((s) => s.pulse)
  const signedIn = useServerSession((s) => !!s.shopper)
  const unread = useUnread("market")
  const capsule = useRef<HTMLDivElement>(null)
  const cartRef = useRef<HTMLButtonElement>(null)

  // One active tab: an open overlay or drawer wins over the page underneath.
  const active: Tab | null = overlayOpen ? "explore" : cartOpen ? "cart" : tabFor(pathname)
  const items = hydrated ? count : 0
  const meUnread = hydrated && signedIn && unread ? unread : 0

  // Where the "Added to cart" bubble's tail meets the Cart tab, from the capsule's right edge.
  const tailFrom = useCallback(() => {
    const box = capsule.current?.getBoundingClientRect()
    const tab = cartRef.current?.getBoundingClientRect()
    if (!box || !tab) return null
    return box.right - (tab.left + tab.width / 2) - 7
  }, [])

  return (
    // Above the search overlay's scrim (z-50) while it's open, so Explore shows its pressed state and a second tap closes it.
    <nav
      aria-label="Primary"
      className={cn("pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:hidden print:hidden", overlayOpen ? "z-[60]" : "z-40")}
    >
      <div
        ref={capsule}
        className="pointer-events-auto relative grid h-[58px] w-[min(calc(100vw-1.5rem),23rem)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-full border border-white/10 bg-obsidian px-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)]"
      >
        <ul className="flex min-w-0 items-center justify-end gap-0.5">
          <li>
            <TabLink href="/" label="Home" icon={HouseSimpleIcon} active={active === "home"} current={pathname === "/"} />
          </li>
          <li>
            <TabButton
              label="Explore"
              icon={MagnifyingGlassIcon}
              active={active === "explore"}
              onClick={() => setOverlay(!useSearchOverlay.getState().open)}
              aria-haspopup="dialog"
              aria-expanded={overlayOpen}
              data-search-toggle=""
            />
          </li>
        </ul>

        <div className="mx-1 flex justify-center">
          <Link
            href="/around"
            aria-label="Around — brands near you"
            aria-current={pathname === "/around" ? "page" : undefined}
            className={cn(
              "inline-flex size-14 -translate-y-3.5 items-center justify-center rounded-full shadow-[0_0_0_9px_rgba(245,245,245,0.10)] ring-4 ring-obsidian transition-[background-color,color,scale] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-violet active:scale-92 motion-reduce:transition-none motion-reduce:active:scale-100",
              active === "around" ? "bg-purple text-ink" : "bg-ink text-obsidian",
            )}
          >
            <MapPinIcon weight="fill" className="size-[26px]" aria-hidden />
          </Link>
        </div>

        <ul className="relative flex min-w-0 items-center justify-start gap-0.5">
          <li className="relative">
            <TabButton
              ref={cartRef}
              label="Cart"
              ariaLabel={cartLabel(items)}
              icon={HandbagIcon}
              active={active === "cart"}
              onClick={openCart}
              badge={
                items > 0 ? (
                  <motion.span
                    key={`count-${items}-${pulse}`}
                    initial={{ scale: 0.4 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 600, damping: 22 }}
                    aria-hidden
                    className="absolute top-0.5 right-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-acid px-1 text-[10px] font-semibold text-obsidian tabular"
                  >
                    {items > 99 ? "99+" : items}
                  </motion.span>
                ) : null
              }
            />
          </li>
          <li className="relative">
            <TabLink
              href="/you"
              label="Me"
              ariaLabel={meUnread ? `Me, ${meUnread} unread ${meUnread === 1 ? "message" : "messages"}` : "Me"}
              icon={UserCircleIcon}
              active={active === "me"}
              current={pathname === "/you"}
              badge={meUnread ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-violet ring-2 ring-obsidian" /> : null}
            />
          </li>
        </ul>

        {/* The one "Added to cart" bubble lives here on phones, under the header's Cart on desktop. */}
        {lgUp === false ? <BagPop placement="tabbar" tailFrom={tailFrom} /> : null}
      </div>
    </nav>
  )
}

const tabBase =
  "relative isolate inline-flex h-11 min-w-11 items-center justify-center rounded-full text-ink outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"

/** The active tab's purple pill: one layoutId, so it glides between tabs (still under reduced motion). */
function Pill() {
  return <motion.span layoutId="tab-pill" aria-hidden className="absolute inset-0 -z-10 rounded-full bg-purple" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
}

/** Icon plus label when active (the label is screen-reader-only below 380px); icon alone otherwise. */
function TabFace({ icon: I, label, active }: { icon: Icon; label: string; active: boolean }) {
  return (
    <>
      {active ? <Pill /> : null}
      <I className="size-[22px] shrink-0" weight={active ? "fill" : "regular"} aria-hidden />
      <span className={cn(active ? "ml-1 text-[13px] font-medium whitespace-nowrap max-[379px]:sr-only" : "sr-only")}>{label}</span>
    </>
  )
}

function TabLink({ href, label, ariaLabel, icon, active, current, badge }: { href: string; label: string; ariaLabel?: string; icon: Icon; active: boolean; current: boolean; badge?: React.ReactNode }) {
  return (
    <Link href={href} aria-label={ariaLabel} aria-current={current ? "page" : undefined} className={cn(tabBase, active ? "px-2.5 max-[379px]:px-0" : "text-ink/85 hover:text-ink")}>
      <TabFace icon={icon} label={label} active={active} />
      {badge}
    </Link>
  )
}

function TabButton({
  ref,
  label,
  ariaLabel,
  icon,
  active,
  onClick,
  badge,
  ...aria
}: {
  ref?: React.Ref<HTMLButtonElement>
  label: string
  ariaLabel?: string
  icon: Icon
  active: boolean
  onClick: () => void
  badge?: React.ReactNode
  "aria-haspopup"?: "dialog"
  "aria-expanded"?: boolean
  "data-search-toggle"?: string
}) {
  return (
    <button ref={ref} type="button" onClick={onClick} aria-label={ariaLabel} className={cn(tabBase, active ? "px-2.5 max-[379px]:px-0" : "text-ink/85 hover:text-ink")} {...aria}>
      <TabFace icon={icon} label={label} active={active} />
      {badge}
    </button>
  )
}
