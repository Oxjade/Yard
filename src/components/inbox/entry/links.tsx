"use client"

import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { inboxHrefFor, useMessageBrand, type MessageTarget } from "./message-brand-button"

const link = "inline-flex min-h-10 items-center gap-1.5 text-left text-sm text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-violet"

/** "Questions about this piece? Ask {brand}" under the PDP's delivery summary (§7.4). */
export function AskAboutProductLink({ brand, productId, variantId, className }: { brand: MessageTarget; productId: string; variantId?: string | null; className?: string }) {
  const go = useMessageBrand()
  return (
    <button type="button" onClick={() => go(inboxHrefFor(brand, { productId, variantId }))} className={cn(link, className)}>
      <ChatCircleDotsIcon className="size-4 shrink-0" aria-hidden />
      <span>
        Questions about this piece? <span className="text-ink">Ask {brand.name}</span>
      </span>
    </button>
  )
}

/** "Message {brand} about this order" on /you/orders/[id], beside "Problem with delivery?" (§7.4). */
export function MessageAboutOrderLink({ orderId, brand, className }: { orderId: string; brand: MessageTarget; className?: string }) {
  const go = useMessageBrand()
  return (
    <button type="button" onClick={() => go(inboxHrefFor(brand, { orderId }))} className={cn(link, className)}>
      <ChatCircleDotsIcon className="size-4 shrink-0" aria-hidden />
      <span>Message {brand.name} about this order</span>
    </button>
  )
}
