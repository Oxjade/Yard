"use client"

import { useEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { counter } from "@/lib/motion"

/**
 * A number that counts up from zero the first time it scrolls into view, then eases
 * between values when the period changes. Under reduced motion it shows the value at once.
 * Render it only once the value is known (StatCard keeps a skeleton in its place until
 * `ready`), so the zero it starts from is the first frame of the count, never a loading state.
 * Screen readers get the final value, not the intermediate frames.
 *
 * Server HTML and the hydrating render both show the final value, whatever the motion
 * preference (the preference is only known in the browser, so branching on it there would
 * not match the server). Only a count mounted after hydration, with motion allowed, starts
 * from zero; one that arrived in the server HTML was already read, so it isn't counted again.
 */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion()
  const hydrated = useHydrated()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -8% 0px" })
  const mv = useMotionValue(hydrated && !reduce ? 0 : value)
  const text = useTransform(mv, (v) => format(v))

  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    if (!inView) return
    const controls = animate(mv, value, counter)
    return () => controls.stop()
  }, [value, inView, reduce, mv])

  // The invisible final value holds the width, so whatever sits beside the number never
  // slides while it counts.
  return (
    <span ref={ref} className={`relative inline-block whitespace-nowrap ${className ?? ""}`}>
      <span aria-hidden className="invisible">{format(value)}</span>
      <motion.span aria-hidden className="absolute inset-y-0 left-0">{text}</motion.span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
