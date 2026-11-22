"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CaretLeftIcon as CaretLeft } from "@phosphor-icons/react"
import { AreaSearch } from "@/components/around/area-search"
import { NotificationBell } from "@/components/feedback/notification-bell"
import { InboxHeaderButton } from "@/components/inbox/entry"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { MarketHeader, Wordmark } from "./market-header"

/**
 * How the marketplace chrome behaves on a route (§7.2 chrome modes):
 * - `float`: the floating header (no bar; each group gets a backdrop once the page scrolls);
 * - `solid`: a full-width bar, for pages whose content runs edge to edge under it (the map);
 * - `focused`: checkout's own header, with nothing that pulls the shopper away mid-task;
 * - `map`: the phone map header on /around — transparent, glass controls only.
 * `tabbar` and `footer` say whether the phone home bar and the footer render.
 */
export type ChromeMode = { header: "float" | "solid" | "focused" | "map"; tabbar: boolean; footer: boolean }

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`)

export function chromeFor(pathname: string, isPhone: boolean): ChromeMode {
  // Checkout itself only: the confirmation after it gets the full chrome back, so the shopper can move on.
  if (pathname === "/checkout") return { header: "focused", tabbar: false, footer: false }
  if (under(pathname, "/around")) return { header: isPhone ? "map" : "solid", tabbar: true, footer: false }
  // On phones an open thread covers the home bar (the Inbox renders it as a full-screen layer).
  if (under(pathname, "/inbox")) return { header: "float", tabbar: true, footer: false }
  return { header: "float", tabbar: true, footer: true }
}

/** Kept for callers that only ask whether the route is checkout's focused one. */
export function useFocusedRoute() {
  return chromeFor(usePathname(), false).header === "focused"
}

/**
 * The marketplace header for the current route. /around splits by breakpoint in CSS (the solid
 * bar from lg, the map header below it), so the first paint is right before hydration too.
 */
export function HeaderChrome() {
  const pathname = usePathname()
  const desk = chromeFor(pathname, false)
  const phone = chromeFor(pathname, true)
  if (desk.header === "focused") return <CheckoutHeader />
  if (phone.header === "map") {
    return (
      <>
        <MarketHeader solid className="max-lg:hidden" />
        <MapHeader className="lg:hidden" />
      </>
    )
  }
  return <MarketHeader />
}

/** Renders the footer where the route keeps one (not on checkout, the map or the Inbox). */
export function FooterChrome({ children }: { children: React.ReactNode }) {
  return chromeFor(usePathname(), false).footer ? children : null
}

/** Renders the phone home bar everywhere but checkout. */
export function TabbarChrome({ children }: { children: React.ReactNode }) {
  return chromeFor(usePathname(), true).tabbar ? children : null
}

/**
 * The phone map header on /around (§6.4, §7.2): no bar, so the map keeps the screen. The wordmark
 * sits in a glass pill on the left; on the right, the area search (a 40px glass circle that
 * expands into a field over this row: A's AreaSearch) and, signed in, Inbox and notifications as
 * glass circles. There is no product search here and no second search pill under it: Explore in
 * the home bar is the way to search the catalogue.
 */
export function MapHeader({ className }: { className?: string }) {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const circle = "glass size-10 rounded-full"
  return (
    <header className={cn("pointer-events-none fixed inset-x-0 top-0 z-40 print:hidden", className)}>
      <div className="flex h-[4.5rem] items-center gap-2 px-4">
        {/* The whole 40px pill is the link, so a tap on its edge goes home too. */}
        <Wordmark className="glass pointer-events-auto inline-flex h-10 items-center rounded-full px-4" />
        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <AreaSearch variant="circle" placement="header" />
          <InboxHeaderButton className={circle} />
          {hydrated && user ? <NotificationBell audience="customer" className={cn("icon-float relative inline-flex items-center justify-center text-ink", circle)} /> : null}
        </div>
      </div>
    </header>
  )
}

/**
 * Checkout's header: the wordmark, a way back to the cart and the step the shopper is on.
 * No security or payment claim: no payment provider is connected in this build. Same
 * height as the marketplace header, so page spacing doesn't change.
 */
export function CheckoutHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line-soft bg-obsidian/90 backdrop-blur-xl print:hidden">
      <div className="mx-auto flex h-[4.5rem] max-w-page items-center gap-4 px-4 md:px-8">
        <Link href="/bag" className="inline-flex h-10 items-center gap-1.5 rounded-full pr-3 pl-2 text-sm text-ink-2 transition-colors hover:bg-white/5 hover:text-ink">
          <CaretLeft className="size-4" aria-hidden /> Cart
        </Link>
        <Wordmark className="mx-auto" />
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-3">Checkout</p>
      </div>
    </header>
  )
}
