"use client"

import { useEffect } from "react"
import { MotionConfig } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { useStudio } from "@/lib/stores/studio"
import { useOrders } from "@/lib/stores/orders"
import { useAdmin } from "@/lib/stores/admin"

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Stores skip hydration so server HTML and the first client render agree.
    void useCart.persist.rehydrate()
    void useSaved.persist.rehydrate()
    void useSession.persist.rehydrate()
    void useStudio.persist.rehydrate()
    void useOrders.persist.rehydrate()
    void useAdmin.persist.rehydrate()
  }, [])

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}>
      <TooltipProvider delayDuration={250}>
        {children}
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  )
}
