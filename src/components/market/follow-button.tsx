"use client"

import { CheckIcon as Check, PlusIcon as Plus } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

/** Follow is a brand relationship, so it uses purple — the identity colour — when active. */
export function FollowButton({ brandId, brandName, size = "sm", className, variant = "default" }: { brandId: string; brandName: string; size?: "xs" | "sm" | "default" | "lg"; className?: string; variant?: "default" | "glass" }) {
  const hydrated = useHydrated()
  const following = useSaved((s) => s.following.includes(brandId))
  const toggle = useSaved((s) => s.toggleFollow)
  const requireAuth = useSession((s) => s.requireAuth)
  const active = hydrated && following

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(brandId)
      toast(now ? `Following ${brandName}` : `Unfollowed ${brandName}`, {
        description: now ? "New products, drops and stories will show up in Following." : undefined,
      })
    }
    if (requireAuth("follow", run)) run()
  }

  return (
    <Button
      type="button"
      size={size}
      variant={active ? "brand" : variant === "glass" ? "glass" : "secondary"}
      aria-pressed={active}
      onClick={onClick}
      className={cn("relative z-10", className)}
    >
      {active ? <Check /> : <Plus />}
      {active ? "Following" : "Follow"}
    </Button>
  )
}
