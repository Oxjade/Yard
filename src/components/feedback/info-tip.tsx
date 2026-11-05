"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * A small explanation behind an info icon — for metric definitions, commission
 * breakdowns, payout statuses and disabled actions. Reachable by keyboard; never on
 * obvious controls.
 */
export function InfoTip({ children, label = "More information", className, side = "top" }: { children: React.ReactNode; label?: string; className?: string; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className={cn("inline-flex size-5 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink focus-visible:text-ink", className)}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-left text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Wraps a disabled control so its reason is still discoverable on hover or focus. */
export function DisabledReason({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-violet">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 text-xs">{reason}</TooltipContent>
    </Tooltip>
  )
}
