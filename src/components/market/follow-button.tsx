"use client"

import { CheckIcon as Check, PlusIcon as Plus } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { transition } from "@/lib/motion"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

/**
 * The small sizes look the same but answer a 40px tap: an invisible extension above and below
 * (inset from inside the button's 1px border), as in brand rows on Following and Your World.
 */
const hitArea: Partial<Record<"xs" | "sm" | "default" | "lg", string>> = {
  xs: "after:absolute after:inset-x-0 after:-inset-y-[7px]",
  sm: "after:absolute after:inset-x-0 after:-inset-y-[5px]",
}

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
      className={cn("relative z-10", hitArea[size], className)}
    >
      {/* The plus turns into the check as the follow lands; the label crossfades with it. Only
          after hydration, so the first paint never animates. */}
      <span className="relative inline-flex items-center justify-center" aria-hidden>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={active ? "on" : "off"}
            className="inline-flex"
            initial={hydrated ? { opacity: 0, scale: 0.5, rotate: active ? -90 : 90 } : false}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, transition: transition.exit }}
            transition={transition.badge}
          >
            {active ? <Check weight="bold" /> : <Plus />}
          </motion.span>
        </AnimatePresence>
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={active ? "on" : "off"} initial={hydrated ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: transition.exit }} transition={transition.crossfade}>
          {active ? "Following" : "Follow"}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}
