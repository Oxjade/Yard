"use client"

import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import type { StorefrontContext } from "@/components/storefront/parts"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { MessageBrandButton } from "./message-brand-button"

/**
 * The storefront hero's message button (§7.4; N mounts it between Follow and Share). Like
 * FollowAction it is an inert stand-in inside the editor preview.
 */
export function MessageAction({ ctx, className }: { ctx: StorefrontContext; className?: string }) {
  if (ctx.preview) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-full">
            <Button type="button" size="icon" variant="secondary" disabled aria-label={`Message ${ctx.brand.name}`} className={cn("rounded-full", className)}>
              <ChatCircleDotsIcon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Messaging works on your live storefront</TooltipContent>
      </Tooltip>
    )
  }
  return <MessageBrandButton brand={ctx.brand} variant="icon" className={className} />
}
