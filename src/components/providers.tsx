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
      if (active) return useCart.getState().syncFromServer()
    })
    return () => {
      active = false
    }
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
