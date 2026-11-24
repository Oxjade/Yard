"use client"

import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { askBrandHref } from "@/lib/ask-brand"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import { useMessageBrand, type MessageTarget } from "./message-brand-button"

/**
 * "Ask the brand" on a sold-out piece or size (PDP, quick add): opens the brand's conversation with
 * the piece (and size) attached and "Is … available, or coming back soon?" in the composer,
 * editable. A guest signs in first ("Sign in to message brands") and lands back in the composer.
 * Nothing for the brand's own members: brands reply from Studio and never start conversations.
 */
export function AskBrandButton({ brand, productId, variantId, size = "xl", className, onOpen }: { brand: MessageTarget; productId: string; variantId?: string | null; size?: "xl" | "lg" | "default"; className?: string; onOpen?: () => void }) {
  const own = useServerSession((s) => s.brand?.brand.id === brand.id)
  const go = useMessageBrand()
  if (own) return null
  return (
    <Button
      type="button"
      variant="primary"
      size={size}
      className={cn(size === "xl" && "h-14 text-base", className)}
      onClick={() => {
        onOpen?.()
        go(askBrandHref(brand, productId, variantId))
      }}
    >
      <ChatCircleDotsIcon className="size-5" aria-hidden />
      Ask the brand
    </Button>
  )
}

/** Whether "Ask the brand" shows for this brand (its own members don't get it). */
export function useCanAskBrand(brandId: string) {
  return !useServerSession((s) => s.brand?.brand.id === brandId)
}
