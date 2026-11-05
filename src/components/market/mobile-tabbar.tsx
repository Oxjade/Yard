"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Compass, Flame, Heart, LayoutGrid, User } from "lucide-react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { isActive } from "./market-header"

const tabs = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/shop", label: "Shop", icon: LayoutGrid },
  { href: "/drops", label: "Drops", icon: Flame },
  { href: "/wishlist", label: "Saved", icon: Heart },
  { href: "/you", label: "You", icon: User },
]

/** Phone navigation: a floating glass tab bar, as in the references the brief points to. */
export function MobileTabBar() {
  const pathname = usePathname()
  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <ul className="glass glass-sheen pointer-events-auto mx-auto grid h-16 max-w-md grid-cols-5 rounded-2xl px-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <li key={href} className="relative isolate">
              <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors", active ? "text-ink" : "text-ink-3")}>
                {active ? <motion.span layoutId="tab-pill" className="absolute inset-x-1.5 inset-y-1.5 -z-10 rounded-xl bg-purple" /> : null}
                <Icon className="size-5" strokeWidth={active ? 2 : 1.6} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
