"use client"

import { motion, type Variants } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"

/** Spring presets for the Control Center. Mass/stiffness/damping are explicit on purpose. */
export const springs = {
  /** Entrance reveals: settles without overshoot. */
  reveal: { type: "spring", stiffness: 240, damping: 28, mass: 0.9 },
  /** Hover lift and press feedback: quick and tight. */
  tactile: { type: "spring", stiffness: 420, damping: 26, mass: 0.6 },
  /** Sliding pills and tab underlines. */
  pill: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
} as const

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
}

// Transform and opacity only (only the admin overview uses this; grepped).
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: springs.reveal },
}

/**
 * Staggered entrance for a page or a grid. Children that should reveal in sequence are
 * wrapped in <RevealItem>. Opacity only (no movement) for people who prefer reduced motion —
 * MotionConfig at the root strips the transform.
 */
export function Reveal({ children, className, as = "div", ssrVisible = false }: { children: React.ReactNode; className?: string; as?: "div" | "section" | "ul"; /** Render the server HTML visible (skeletons and all) and stagger only on client-side navigation, so nothing is blank before hydration. */ ssrVisible?: boolean }) {
  const Comp = as === "section" ? motion.section : as === "ul" ? motion.ul : motion.div
  const hydrated = useHydrated()
  return (
    <Comp variants={container} initial={ssrVisible && !hydrated ? false : "hidden"} animate="show" className={className}>
      {children}
    </Comp>
  )
}

export function RevealItem({ children, className, as = "div", ...rest }: { children: React.ReactNode; className?: string; as?: "div" | "section" | "li" | "article" } & Record<string, unknown>) {
  const Comp = as === "section" ? motion.section : as === "li" ? motion.li : as === "article" ? motion.article : motion.div
  return (
    <Comp variants={item} className={cn(className)} {...rest}>
      {children}
    </Comp>
  )
}
