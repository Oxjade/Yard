"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CaretLeftIcon as CaretLeft } from "@phosphor-icons/react"
import { Wordmark } from "./market-header"

/** Routes that drop the marketplace navigation so nothing pulls the shopper away mid-task. */
const FOCUSED = ["/checkout"]

export function useFocusedRoute() {
  const pathname = usePathname()
  return FOCUSED.includes(pathname)
}

/** Renders the marketplace chrome (header, tab bar, footer) everywhere except focused routes. */
export function MarketChrome({ children, focused = null }: { children: React.ReactNode; focused?: React.ReactNode }) {
  return useFocusedRoute() ? focused : children
}

/**
 * Checkout's header: the wordmark, a way back to the bag and the step the shopper is on.
 * No security or payment claim: no payment provider is connected in this build. Same
 * height as the marketplace header, so page spacing doesn't change.
 */
export function CheckoutHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line-soft bg-obsidian/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.5rem] max-w-page items-center gap-4 px-4 md:px-8">
        <Link href="/bag" className="inline-flex h-10 items-center gap-1.5 rounded-full pr-3 pl-2 text-sm text-ink-2 transition-colors hover:bg-white/5 hover:text-ink">
          <CaretLeft className="size-4" aria-hidden /> Bag
        </Link>
        <Wordmark className="mx-auto" />
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-3">Checkout</p>
      </div>
    </header>
  )
}
