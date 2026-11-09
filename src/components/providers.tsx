"use client"

import { useEffect } from "react"
import { MotionConfig } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { useStudio } from "@/lib/stores/studio"
import { useOrders } from "@/lib/stores/orders"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useNotificationEvents } from "@/lib/notification-events"
import { getServerSessionState, subscribeServerSession } from "@/lib/session/use-server-session"

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Stores skip hydration so server HTML and the first client render agree.
    let active = true
    void Promise.all([
      useCart.persist.rehydrate(),
      useSaved.persist.rehydrate(),
      useSession.persist.rehydrate(),
      useStudio.persist.rehydrate(),
      useOrders.persist.rehydrate(),
      useAdmin.persist.rehydrate(),
      useNotifications.persist.rehydrate(),
    ]).then(() => {
      if (!active) return
      // Real accounts' checkouts are never kept in this browser: drop any an earlier build saved.
      useOrders.getState().scopeTo(null)
      return useCart.getState().syncFromServer()
    })
    return () => {
      active = false
    }
  }, [])

  // Every change of signed-in shopper (sign-in, sign-out, a switch, another tab, an expired
  // session): reload the bag from the server cart and keep only the orders the new shopper may see.
  // On sign-out or a switch the previous shopper's lines leave the bag at once; their server cart
  // stays theirs. A sign-in keeps the lines on screen while the merged cart loads.
  useEffect(() => {
    const shopperOf = () => {
      const s = getServerSessionState()
      return s.status === "ready" ? (s.shopper?.id ?? null) : undefined
    }
    let last = shopperOf()
    return subscribeServerSession(() => {
      const next = shopperOf()
      if (next === undefined || next === last) return
      const previous = last
      last = next
      if (previous === undefined) return
      useOrders.getState().scopeTo(next)
      void useCart.getState().syncFromServer({ reset: previous !== null })
    })
  }, [])
  useNotificationEvents()

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}>
      <TooltipProvider delayDuration={250}>
        {children}
      </TooltipProvider>
    </MotionConfig>
  )
}
