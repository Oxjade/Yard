"use client"

import { useEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { counter } from "@/lib/motion"

/**
 * A number that counts up from zero the first time it scrolls into view, then eases
 * between values when the period changes. Under reduced motion it shows the value at once.
 * Render it only once the value is known (behind a skeleton before hydration), so the
 * zero it starts from is the first frame of the count, never a loading state.
 * Screen readers get the final value, not the intermediate frames.
 */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -8% 0px" })
  const mv = useMotionValue(reduce ? value : 0)
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
