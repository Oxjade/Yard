"use client"

import { useEffect } from "react"
import { create } from "zustand"
import { useCart } from "@/lib/stores/cart"
import { useSearchOverlay } from "./search-overlay"

/**
 * Phone chrome that gets out of the way (below md): the floating header and the home bar slide
 * off screen while the page scrolls down and come back on any scroll up. They always show at the
 * very top and near the bottom of the page, while the search overlay or the cart drawer is open,
 * while a sheet or dialog holds the scroll, while a field has focus (the keyboard is up), when
 * focus moves into them, and when something is added to the cart (its bubble sits on the bar).
 * Under reduced motion they never hide. From md up nothing changes.
 *
 * One store, so the header and the bar always move together. `hidden` starts false on the server
 * and the client alike, so the first paint matches. While hidden, `data-chrome-hidden` on <html>
 * lowers `--tabbar-clear` (globals.css), so the floating action bars that sit on the home bar
 * (product, cart, filters) follow it down instead of hanging over the page.
 */
export const useChromeAutohide = create<{ hidden: boolean; show: () => void }>((set) => ({ hidden: false, show: () => set({ hidden: false }) }))

/** Scrolled past this, a scroll down can hide the chrome. */
const START = 40
/** How far the page must move in one direction before the chrome changes, so a jittery thumb doesn't flicker it. */
const DELTA = 8
/** Within this of the page's end the chrome shows, so the footer's last links are never under a moving bar. */
const END = 80

const editing = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)

/** Drives the store. Mounted once, by the floating header (`enabled` is false where it is the solid bar). */
export function useChromeAutohideDriver(enabled: boolean) {
  const overlayOpen = useSearchOverlay((s) => s.open)
  const cartOpen = useCart((s) => s.isOpen)
  const pulse = useCart((s) => s.pulse)

  // Anything the shopper opened or added brings the chrome back.
  useEffect(() => {
    if (overlayOpen || cartOpen || pulse) useChromeAutohide.getState().show()
  }, [overlayOpen, cartOpen, pulse])

  useEffect(() => {
    if (!enabled) return
    const phone = window.matchMedia("(max-width: 47.99rem)")
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const root = document.documentElement
    let last = window.scrollY
    let frame = 0

    const set = (hidden: boolean) => {
      if (useChromeAutohide.getState().hidden !== hidden) useChromeAutohide.setState({ hidden })
    }
    // The attribute follows the store, so a `show()` from anywhere lowers the bars' clearance too.
    const unsubscribe = useChromeAutohide.subscribe((s) => root.toggleAttribute("data-chrome-hidden", s.hidden))

    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      // Clamped: iOS rubber-banding reports past either end.
      const y = Math.min(Math.max(window.scrollY, 0), Math.max(max, 0))
      if (!phone.matches || reduced.matches || useSearchOverlay.getState().open || useCart.getState().isOpen) {
        set(false)
        last = y
        return
      }
      // While a sheet holds the page or the keyboard is up, the scroll they cause says nothing.
      if (document.body.hasAttribute("data-scroll-locked") || editing(document.activeElement)) {
        last = y
        return
      }
      if (y <= START || y >= max - END) {
        set(false)
        last = y
        return
      }
      const moved = y - last
      if (Math.abs(moved) < DELTA) return
      set(moved > 0)
      last = y
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const onChange = () => update()

    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    phone.addEventListener("change", onChange)
    reduced.addEventListener("change", onChange)
    return () => {
      window.removeEventListener("scroll", onScroll)
      phone.removeEventListener("change", onChange)
      reduced.removeEventListener("change", onChange)
      if (frame) cancelAnimationFrame(frame)
      set(false)
      unsubscribe()
      root.removeAttribute("data-chrome-hidden")
    }
  }, [enabled])
}
