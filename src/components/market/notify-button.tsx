"use client"

import { BellIcon as Bell, BellRingingIcon as BellRing } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"

/**
 * Set a reminder, or enter the draw, before a drop opens. Both are saved in this browser (the
 * saved store). A reminder becomes an alert in Notifications when the drop opens while NOCTURNE
 * is open (notification-events checks it against the demo clock); email, push and picking draw
 * winners need backends this build doesn't have, so the feedback says exactly that.
 *
 * `quiet` skips the toast where the page already explains the result next to the button (the
 * drop page's release panel); the button's own label and pressed state still change.
 */
export function NotifyButton({
  drop,
  size = "sm",
  variant = "secondary",
  quiet = false,
  className,
}: {
  drop: Drop
  size?: "sm" | "default" | "lg"
  variant?: "secondary" | "glass" | "primary"
  quiet?: boolean
  className?: string
}) {
  const hydrated = useHydrated()
  const on = useSaved((s) => s.notify.includes(drop.id))
  const toggle = useSaved((s) => s.toggleNotify)
  const requireAuth = useSession((s) => s.requireAuth)
  const active = hydrated && on
  const draw = drop.access === "draw"
  const label = draw ? (active ? "Entered" : "Enter the draw") : active ? "Reminder set" : "Notify me"

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(drop.id)
      if (quiet) return
      if (draw) toast(now ? "Entry saved in this browser" : "Entry withdrawn", { description: now ? "Picking winners isn't connected in this build." : undefined })
      else
        toast(now ? "Reminder saved in this browser" : "Reminder removed", {
          description: now ? "You'll see an alert in Notifications when it opens while NOCTURNE is open. Email and push aren't connected in this build." : undefined,
        })
    }
    if (requireAuth("notify", run)) run()
  }

  return (
    <Button type="button" size={size} variant={active ? "brand" : variant} aria-pressed={active} onClick={onClick} className={cn("relative z-10", className)}>
      {active ? <BellRing /> : <Bell />}
      {label}
    </Button>
  )
}
