"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"

const roll = {
  enter: (dir: number) => ({ y: `${70 * dir}%`, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: `${-70 * dir}%`, opacity: 0 }),
}

/**
 * A figure that rolls to its new value: up when it grows, down when it shrinks (quantities,
 * cart counts, subtotals). `value` orders the change; `children` is what shows (a formatted
 * price, say), defaulting to the value itself. The first render never animates, and the
 * container keeps the new figure's width, so nothing beside it jumps. Transform and opacity
 * only; under reduced motion MotionConfig drops the roll and keeps a plain crossfade.
 *
 * Visual only: announce changes with your own live region (the roll would be read twice).
 */
export function RollNumber({ value, children, className }: { value: number; children?: React.ReactNode; className?: string }) {
  const [last, setLast] = useState(value)
  const [dir, setDir] = useState(1)
  if (value !== last) {
    setDir(value > last ? 1 : -1)
    setLast(value)
  }
  const shown = children ?? value
  return (
    <span aria-hidden className={cn("relative inline-flex overflow-hidden tabular", className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={typeof shown === "string" || typeof shown === "number" ? String(shown) : value}
          custom={dir}
          variants={roll}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: duration.press + 0.06, ease: ease.out }}
          className="inline-block whitespace-nowrap"
        >
          {shown}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
