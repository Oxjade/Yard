"use client"

import { Heart } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

export function WishlistButton({ productId, name, className, variant = "glass" }: { productId: string; name: string; className?: string; variant?: "glass" | "outline" }) {
  const hydrated = useHydrated()
  const saved = useSaved((s) => s.wishlist.includes(productId))
  const toggle = useSaved((s) => s.toggleWishlist)
  const requireAuth = useSession((s) => s.requireAuth)
  const active = hydrated && saved

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(productId)
      toast(now ? "Saved to your wishlist" : "Removed from your wishlist", { description: name })
    }
    if (requireAuth("save", run)) run()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-200 active:scale-90",
        variant === "glass" ? "glass hover:bg-[rgba(33,28,42,0.85)]" : "border border-line hover:bg-elevated",
        className,
      )}
    >
      <motion.span key={String(active)} initial={hydrated ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 18 }}>
        <Heart className={cn("size-[17px] transition-colors", active ? "fill-violet text-violet" : "text-ink")} strokeWidth={1.75} />
      </motion.span>
      <AnimatePresence>
        {active ? (
          <motion.span
            key="burst"
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border border-violet"
            initial={{ scale: 0.7, opacity: 0.9 }}
            animate={{ scale: 1.6, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
      </AnimatePresence>
    </button>
  )
}
