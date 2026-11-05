"use client"

import { Bell, BellRing } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"

export function NotifyButton({ drop, size = "sm", className, variant = "secondary" }: { drop: Drop; size?: "sm" | "default" | "lg"; className?: string; variant?: "secondary" | "glass" | "primary" }) {
  const hydrated = useHydrated()
  const on = useSaved((s) => s.notify.includes(drop.id))
  const toggle = useSaved((s) => s.toggleNotify)
  const requireAuth = useSession((s) => s.requireAuth)
  const prefs = useSession((s) => s.notifications)
  const active = hydrated && on
  const label = drop.access === "draw" ? (active ? "Entered" : "Enter the draw") : active ? "Reminder set" : "Notify me"

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(drop.id)
      const channel = prefs.push ? "a push notification" : prefs.email ? "an email" : "an alert in Following"
      toast(now ? (drop.access === "draw" ? "You're in the draw" : "We'll remind you") : "Reminder removed", {
        description: now ? `You'll get ${channel} when ${drop.name} goes live.` : undefined,
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
