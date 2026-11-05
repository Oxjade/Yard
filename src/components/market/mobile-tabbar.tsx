"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CompassIcon, FireIcon, HeartIcon, SquaresFourIcon, UserIcon, type Icon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { isActive } from "./market-header"

const tabs: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Discover", icon: CompassIcon },
  { href: "/shop", label: "Shop", icon: SquaresFourIcon },
  { href: "/drops", label: "Drops", icon: FireIcon },
  { href: "/wishlist", label: "Saved", icon: HeartIcon },
  { href: "/you", label: "You", icon: UserIcon },
]

/**
 * Phone navigation: a compact black capsule of white icons — no labels on screen (they're
 * announced to screen readers). The active tab sits on a purple disc with a filled icon.
 */
export function MobileTabBar() {
  const pathname = usePathname()
  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:hidden">
      <ul className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-obsidian p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <li key={href} className="relative isolate">
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn("flex size-11 items-center justify-center rounded-full transition-[color,transform] duration-150 active:scale-90", active ? "text-ink" : "text-ink/85 hover:text-ink")}
              >
                {active ? <motion.span layoutId="tab-disc" className="absolute inset-0 -z-10 rounded-full bg-purple" transition={{ type: "spring", stiffness: 500, damping: 38 }} /> : null}
                <Icon className="size-[22px]" weight={active ? "fill" : "regular"} />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
