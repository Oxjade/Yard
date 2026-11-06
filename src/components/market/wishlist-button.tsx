"use client"

import { HeartIcon as Heart } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

export function WishlistButton({ productId, name, className, variant = "glass" }: { productId: string; name: string; className?: string; variant?: "glass" | "outline" | "button" }) {
  const hydrated = useHydrated()
  const saved = useSaved((s) => s.wishlist.includes(productId))
  const toggle = useSaved((s) => s.toggleWishlist)
  const requireAuth = useSession((s) => s.requireAuth)
  const active = hydrated && saved
  const [say, setSay] = useState<null | { text: string; n: number }>(null)
  useEffect(() => {
    if (!say) return
    const t = window.setTimeout(() => setSay(null), 1300)
    return () => window.clearTimeout(t)
  }, [say])

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(productId)
      setSay({ text: now ? "Saved!" : "Removed", n: Date.now() })
    }
    if (requireAuth("save", run)) run()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={variant === "button" ? (active ? `Saved: ${name}. Remove from wishlist` : `Save ${name} to wishlist`) : active ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      className={cn(
        "relative inline-flex items-center justify-center text-ink transition-[background-color,transform] duration-200",
        variant === "button"
          ? "h-14 w-14 gap-2 rounded-md border border-line px-0 text-sm font-medium hover:bg-elevated active:scale-[0.97] sm:w-auto sm:px-5"
          : // 36px to the eye, 40px to a finger (the inset counts from inside the 1px border).
            "size-9 rounded-full after:absolute after:-inset-[3px] after:rounded-full active:scale-90",
        variant === "glass" ? "glass hover:bg-[var(--glass-bg-strong)]" : variant === "outline" ? "border border-line hover:bg-elevated" : null,
        className,
      )}
    >
      <motion.span key={String(active)} initial={hydrated ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 18 }}>
        <Heart className={cn("transition-colors", variant === "button" ? "size-5" : "size-[17px]", active ? "text-violet" : "text-ink")} weight={active ? "fill" : "regular"} />
      </motion.span>
      {variant === "button" ? <span className="hidden sm:inline" aria-hidden>{active ? "Saved" : "Save"}</span> : null}
      <AnimatePresence>
        {say ? (
          <motion.span
            key={say.n}
            role="status"
            className="pop-bubble pop-tail pop-tail-right pointer-events-none absolute top-1/2 right-full mr-3 -mt-[15px] h-[30px] px-2.5 font-display text-[15px] leading-[26px] whitespace-nowrap"
            style={{ transformOrigin: "100% 50%" }}
            initial={{ opacity: 0, scale: 0.4, rotate: 8 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.14 } }}
            transition={{ type: "spring", stiffness: 620, damping: 20, mass: 0.6 }}
          >
            {say.text}
          </motion.span>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {active ? (
          <motion.span
            key="burst"
            aria-hidden
            className={cn("pointer-events-none absolute inset-0 border border-violet", variant === "button" ? "rounded-md" : "rounded-full")}
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
