"use client"

import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMessageBrand } from "./message-brand-button"

/** /inbox?support=1, with an order attached as a chip ("Get help from Yard" on an order). */
export function supportHref(order?: { id: string; reference: string } | null) {
  const q = new URLSearchParams({ support: "1" })
  if (order) {
    q.set("order", order.id)
    q.set("orderRef", order.reference)
  }
  return `/inbox?${q.toString()}`
}

/** "Message Yard Support": opens the shopper's Yard Support thread in the inbox (a guest signs in first). */
export function MessageSupportButton({ order, label = "Message Yard Support", variant = "secondary", size = "default", className }: { order?: { id: string; reference: string } | null; label?: string; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "default"; className?: string }) {
  const go = useMessageBrand()
  return (
    <Button type="button" variant={variant} size={size} onClick={() => go(supportHref(order))} className={cn(className)}>
      <ChatCircleDotsIcon /> {label}
    </Button>
  )
}
