"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

export type MessageTarget = { id: string; handle: string; name: string }

/** /inbox?brand=… with the product (and variant) or order pre-attached as a removable chip (§6.2). */
export function inboxHrefFor(brand: { handle: string }, opts: { productId?: string | null; variantId?: string | null; orderId?: string | null } = {}) {
  const q = new URLSearchParams({ brand: brand.handle })
  if (opts.productId) q.set("product", opts.productId)
  if (opts.productId && opts.variantId) q.set("variant", opts.variantId)
  if (!opts.productId && opts.orderId) q.set("order", opts.orderId)
  return `/inbox?${q.toString()}`
}

/** Sends a guest through sign-in ("Sign in to message brands") first, then opens the thread. */
export function useMessageBrand() {
  const router = useRouter()
  const requireAuth = useSession((s) => s.requireAuth)
  return (href: string) => {
    if (requireAuth("message", () => router.push(href))) router.push(href)
  }
}

/**
 * Message a brand (§6.2 entry points; N mounts it). A member of that brand signed in to Studio
 * sees "Open Studio inbox" instead: brands reply from Studio and never start conversations.
 */
export function MessageBrandButton({ brand, productId, variantId, size = "default", variant = "label", className }: { brand: MessageTarget; productId?: string; variantId?: string | null; size?: "sm" | "default"; variant?: "icon" | "label"; className?: string }) {
  const own = useServerSession((s) => s.brand?.brand.id === brand.id)
  const go = useMessageBrand()
  if (own) {
    return (
      <Button asChild size={variant === "icon" ? "icon" : size} variant="secondary" className={cn(variant === "icon" && "rounded-full", className)}>
        <Link href="/studio/inbox" aria-label={variant === "icon" ? "Open Studio inbox" : undefined}>
          <ChatCircleDotsIcon />
          {variant === "icon" ? null : "Open Studio inbox"}
        </Link>
      </Button>
    )
  }
  const href = inboxHrefFor(brand, { productId, variantId })
  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" size="icon" variant="secondary" aria-label={`Message ${brand.name}`} onClick={() => go(href)} className={cn("rounded-full", className)}>
            <ChatCircleDotsIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Message {brand.name}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button type="button" size={size} variant="secondary" onClick={() => go(href)} className={className}>
      <ChatCircleDotsIcon /> Message {brand.name}
    </Button>
  )
}
