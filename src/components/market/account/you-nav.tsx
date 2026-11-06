"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { cn } from "@/lib/utils"

const items = [
  { href: "/you", label: "Overview", exact: true },
  { href: "/following", label: "Following", count: "following" },
  { href: "/wishlist", label: "Wishlist", count: "wishlist" },
  { href: "/you/orders", label: "Orders", count: "orders" },
  { href: "/you/settings", label: "Settings" },
] as const

/** The sub-navigation of Your World. The underline travels between tabs with a shared layoutId. */
export function YouNav({ className }: { className?: string }) {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const following = useSaved((s) => s.following.length)
  const wishlist = useSaved((s) => s.wishlist.length)
  const orders = useOrders((s) => s.groups.length)
  const counts = { following, wishlist, orders }

  return (
    <nav aria-label="Your World" className={cn("rail -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-line-soft">
        {items.map((item) => {
          const active = "exact" in item ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
          const count = "count" in item && hydrated ? counts[item.count] : null
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-11 items-center gap-2 px-3 text-sm transition-colors", active ? "text-ink" : "text-ink-2 hover:text-ink")}
              >
                {item.label}
                {count ? <span className="tabular text-xs text-ink-3">{count}</span> : null}
                {active ? <motion.span layoutId="you-nav-underline" className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-purple" /> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
