"use client"

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { useInView, useReducedMotion } from "motion/react"

/** Whether an element's box is on screen now (any visible pixel; a hidden element has no box). */
export function onScreen(el: Element | null) {
  const box = el?.getBoundingClientRect()
  return !!box && (box.width > 0 || box.height > 0) && box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth
}

/**
 * True once the element has been seen: at mount when it is already on screen (measured before
 * the first paint, so an entrance starts with the numbers beside it rather than a frame or
 * two later, when the visibility observer reports), otherwise when it scrolls into view.
 * Never goes back to false. Entrances started from it run on an entrance clock (clock.ts) or
 * a CSS transition released on the next frame (useEntrance), so they begin with the first
 * painted frame even when the page is still busy hydrating.
 */
export function useSeen(ref: RefObject<Element | null>, margin: `${number}px ${number}px ${number}% ${number}px` | "0px" = "0px") {
  const inView = useInView(ref, { once: true, margin })
  const [early, setEarly] = useState(false)
  useLayoutEffect(() => {
    if (onScreen(ref.current)) setEarly(true)
  }, [ref])
  return inView || early
}

/**
 * Releases a first-appearance entrance that CSS holds back (globals.css,
 * `[data-entrance="pending"]`): render `data-entrance="pending"` on the element that takes the
 * ref, and once it has been seen (and is `ready`) the attribute flips to "in" on the next
 * frame, after a style flush, so CSS transitions run from the held-back state. React renders
 * the same "pending" on every render and never rewrites it, so the flip survives re-renders,
 * and the server HTML and the hydrating render stay identical. The CSS holds nothing back
 * without JavaScript or under reduced motion, so those see the final state from the first paint.
 */
export function useEntrance<T extends HTMLElement | SVGElement>(ready = true) {
  const ref = useRef<T>(null)
  const reduce = useReducedMotion()
  const seen = useSeen(ref)
  useEffect(() => {
    const el = ref.current
    if (!el || !ready || el.dataset.entrance !== "pending") return
    if (reduce) {
      el.dataset.entrance = "in"
      return
    }
    if (!seen) return
    const id = requestAnimationFrame(() => {
      // Flush styles first, so the held-back state is the transition's starting point even
      // when it was rendered in this same frame (a grid whose counts just arrived).
      el.getBoundingClientRect()
      el.dataset.entrance = "in"
    })
    return () => cancelAnimationFrame(id)
  }, [ready, reduce, seen])
  return ref
}
