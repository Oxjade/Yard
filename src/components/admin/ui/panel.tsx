"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { AlertTriangle, ArrowUpRight, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { RevealItem, springs } from "./motion"

/**
 * The Control Center panel: a layered surface with a hairline border, a top light
 * falloff and an inner highlight. `interactive` panels lift slightly on hover.
 */
export function Panel({
  title,
  description,
  action,
  href,
  hrefLabel = "Open",
  children,
  className,
  bodyClassName,
  glow = false,
  attention = false,
  interactive = false,
  as = "section",
  labelledBy,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  href?: string
  hrefLabel?: string
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  glow?: boolean
  attention?: boolean
  interactive?: boolean
  as?: "section" | "div" | "article"
  labelledBy?: string
}) {
  const id = labelledBy ?? (title ? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined)
  return (
    <RevealItem
      as={as}
      aria-labelledby={title ? id : undefined}
      className={cn("admin-panel overflow-hidden", glow && "admin-panel-glow", attention && "admin-panel-attention", className)}
      {...(interactive ? { whileHover: { y: -2 }, transition: springs.tactile } : {})}
    >
      {title ? (
        <header className="relative flex items-start justify-between gap-3 px-4 pt-4 pb-3 md:px-5">
          <div className="min-w-0">
            <h2 id={id} className="font-label text-[13px] text-ink">{title}</h2>
            {description ? <p className="mt-1 text-[12px] leading-snug text-ink-2">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {action}
            {href ? (
              <Link href={href} className="group inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink">
                {hrefLabel}
                <ArrowUpRight className="size-3.5 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            ) : null}
          </div>
        </header>
      ) : null}
      <div className={cn("relative", title ? "px-4 pb-4 md:px-5 md:pb-5" : "p-4 md:p-5", bodyClassName)}>{children}</div>
    </RevealItem>
  )
}

/** Error state for a panel whose data failed to load: what happened, and the retry. */
export function PanelError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="admin-inset flex items-start gap-3 p-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink">{message}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-2 hover:text-ink">
            <RotateCcw className="size-3.5" /> Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Same-size placeholder so content can arrive without shifting the layout. */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-white/[0.025]", className)} aria-hidden>
      <motion.span
        className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
        animate={{ x: ["0%", "400%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  )
}
