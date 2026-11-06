"use client"

import { useId, useRef, useState } from "react"
import { InfoIcon as Info } from "@phosphor-icons/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Radix tooltips open on hover and keyboard focus but never on touch. This keeps that on
 * mouse and pen, and adds tap: a tap opens the tip, a second tap (or a tap anywhere else,
 * scrolling, Escape) closes it.
 */
function useTapToOpen() {
  const [open, setOpen] = useState(false)
  const pointer = useRef<string | null>(null)
  const wasOpen = useRef(false)
  return {
    open,
    onOpenChange: setOpen,
    trigger: {
      onPointerDown: (e: React.PointerEvent) => {
        pointer.current = e.pointerType
        // Read before Radix closes an open tip on pointer down.
        wasOpen.current = open
      },
      onClick: (e: React.MouseEvent) => {
        const touch = pointer.current === "touch"
        pointer.current = null
        if (!touch) return
        // Stops Radix's close-on-click for this tap.
        e.preventDefault()
        setOpen(!wasOpen.current)
      },
    },
  }
}

/**
 * The 40px touch target for a small trigger on touch screens, drawn as an invisible layer
 * centred on it, so the icon keeps its size and the layout doesn't move.
 */
const touchTarget = "relative pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-10 pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2"

/**
 * A small explanation behind an info icon — for metric definitions, commission
 * breakdowns, payout statuses and disabled actions. Opens on hover, keyboard focus and tap,
 * with a 40px target on touch screens. The text is also the button's accessible
 * description, so screen readers reach it without opening anything. Never on obvious
 * controls.
 */
export function InfoTip({ children, label = "More information", className, side = "top" }: { children: React.ReactNode; label?: string; className?: string; side?: "top" | "bottom" | "left" | "right" }) {
  const tap = useTapToOpen()
  const descId = useId()
  return (
    <Tooltip open={tap.open} onOpenChange={tap.onOpenChange}>
      <TooltipTrigger asChild {...tap.trigger}>
        <button type="button" aria-label={label} aria-describedby={descId} className={cn("inline-flex size-5 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink focus-visible:text-ink", touchTarget, className)}>
          <Info className="size-3.5" />
          <span id={descId} hidden>
            {children}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-left text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Wraps a disabled control so its reason is still discoverable on hover, focus or tap (at
 * least 40px of target on touch screens). The reason is the wrapper's accessible
 * description as well.
 */
export function DisabledReason({ reason, children }: { reason: string; children: React.ReactNode }) {
  const tap = useTapToOpen()
  const descId = useId()
  return (
    <Tooltip open={tap.open} onOpenChange={tap.onOpenChange}>
      <TooltipTrigger asChild {...tap.trigger}>
        <span tabIndex={0} aria-describedby={descId} className="relative inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-violet pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:h-full pointer-coarse:after:min-h-10 pointer-coarse:after:w-full pointer-coarse:after:min-w-10 pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2">
          {children}
          <span id={descId} hidden>
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 text-xs">{reason}</TooltipContent>
    </Tooltip>
  )
}
