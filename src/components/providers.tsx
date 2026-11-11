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
import { sampleDataOff } from "@/lib/sample-switch"
import { noticeSamplePurge } from "@/lib/stores/cart"
import { purgeSampleNotifications } from "@/lib/notification-events"

/**
 * Production: everything this browser kept from the sample catalogue (cart lines, saved lists,
 * sample notifications, the demo shopper's sample checkouts) goes, with one notice when the cart
 * lost pieces. Runs once /api/session (the request-time demo switch) says the sample data is off;
 * the persisted stores also drop sample ids as they rehydrate when that answer is already in.
 *
 * The switch is never handed down from the root layout: that layout is prerendered at build, so a
 * value read there would be the build's, not this server's (see src/proxy.ts).
 */
function purgeSampleState() {
  const fromCart = useCart.getState().purgeSample()
  useSaved.getState().purgeSample()
  useOrders.getState().purgeSample()
  purgeSampleNotifications()
  // Write the cleaned lists back so they leave this browser's storage too.
  useCart.setState({})
  useSaved.setState({})
  useNotifications.setState({})
  noticeSamplePurge(fromCart)
}

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
      // Production: the rehydrate already dropped sample ids from what's shown; write the cleaned
      // lists back so they leave this browser's storage too, and say once that pieces left the cart.
      if (sampleDataOff()) {
        useOrders.getState().purgeSample()
        purgeSampleNotifications()
        useCart.setState({})
        useSaved.setState({})
        useNotifications.setState({})
        noticeSamplePurge()
      }
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
  //
  // The demo shopper's cookie renews by a moment without a server shopper while this browser still
  // holds the demo user (SessionSync then signs the demo in again): the bag is left as it is for
  // that moment, so it doesn't empty and refill. It's cleared as usual if the local user goes too
  // (a real sign-out, another tab, a failed renewal) or a different shopper signs in instead.
  useEffect(() => {
    const shopperOf = () => {
      const s = getServerSessionState()
      return s.status === "ready" ? (s.shopper?.id ?? null) : undefined
    }
    let last = shopperOf()
    let lastDemo = !!getServerSessionState().shopper?.demo
    /** The demo shopper whose bag is held while its session renews. */
    let held: string | null = null
    const release = (reset: boolean) => {
      held = null
      void useCart.getState().syncFromServer({ reset })
    }
    const unsubscribeServer = subscribeServerSession(() => {
      const next = shopperOf()
      if (next === undefined || next === last) return
      const previous = last
      const previousDemo = lastDemo
      last = next
      lastDemo = !!getServerSessionState().shopper?.demo
      if (previous === undefined) return
      useOrders.getState().scopeTo(next)
      const local = useSession.getState()
      if (next === null && previous && previousDemo && local.user?.id === previous && !local.signedOutAt && !local.serverPending) {
        held = previous
        return
      }
      if (held) return release(next !== held)
      void useCart.getState().syncFromServer({ reset: previous !== null })
    })
    // The local user leaving (or changing) while a demo bag is held: that was a sign-out after all.
    const unsubscribeLocal = useSession.subscribe((state) => {
      if (held && state.user?.id !== held && !getServerSessionState().shopper) release(true)
    })
    return () => {
      unsubscribeServer()
      unsubscribeLocal()
    }
  }, [])
  // /api/session is the request-time answer: if it says the sample data is off, purge whatever is left.
  useEffect(() => {
    let done = false
    const check = () => {
      if (done || getServerSessionState().sampleData !== false) return
      done = true
      if ([useCart, useSaved, useNotifications, useOrders].every((st) => st.persist.hasHydrated())) purgeSampleState()
      else window.setTimeout(() => ((done = false), check()), 100)
    }
    check()
    return subscribeServerSession(check)
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
