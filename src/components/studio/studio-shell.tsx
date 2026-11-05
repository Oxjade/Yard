"use client"

import Link from "next/link"
import { BarChart3, Boxes, CalendarClock, LayoutDashboard, LayoutTemplate, Megaphone, Package, PackageSearch, Settings, ShoppingCart, Tags, Users, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { AppShell, type ShellNavGroup } from "@/components/dashboard/app-shell"
import { useHydrated } from "@/hooks/use-hydrated"
import { brandById } from "@/lib/data/brands"
import { useStudio } from "@/lib/stores/studio"
import { site } from "@/config/site"

/** Brand Studio: the merchant's operating environment. Calm, structured, functional. */
export function StudioShell({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated()
  const brandId = useStudio((s) => s.brandId)
  const toFulfil = useStudio((s) => s.orders.filter((o) => o.status === "paid" || o.status === "processing").length)
  const brand = brandById.get(brandId)!

  const groups: ShellNavGroup[] = [
    {
      items: [
        { href: "/studio", label: "Overview", icon: LayoutDashboard },
        { href: "/studio/storefront", label: "Storefront", icon: LayoutTemplate },
      ],
    },
    {
      label: "Catalogue",
      items: [
        { href: "/studio/products", label: "Products", icon: Package },
        { href: "/studio/collections", label: "Collections", icon: Boxes },
        { href: "/studio/inventory", label: "Inventory", icon: PackageSearch },
        { href: "/studio/drops", label: "Drops", icon: CalendarClock },
      ],
    },
    {
      label: "Growth",
      items: [
        { href: "/studio/campaigns", label: "Campaigns", icon: Tags },
        { href: "/studio/advertising", label: "Advertising", icon: Megaphone },
      ],
    },
    {
      label: "Business",
      items: [
        { href: "/studio/orders", label: "Orders", icon: ShoppingCart, badge: hydrated && toFulfil ? toFulfil : undefined },
        { href: "/studio/customers", label: "Customers", icon: Users },
        { href: "/studio/analytics", label: "Analytics", icon: BarChart3 },
        { href: "/studio/settings", label: "Settings", icon: Settings },
      ],
    },
  ]

  return (
    <AppShell
      surface="studio"
      root="/studio"
      groups={groups}
      header={
        <div className="flex items-center gap-2.5 rounded-md p-1.5">
          <BrandMark brand={brand} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{brand.name}</p>
            <p className="truncate text-[11px] text-ink-3">Brand Studio</p>
          </div>
        </div>
      }
      footer={
        <div className="grid gap-2">
          <Link href="/" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-3 hover:text-ink">
            <Zap className="size-3.5" /> Back to {site.name}
          </Link>
        </div>
      }
      topbar={
        <Button asChild size="sm" variant="secondary" className="hidden sm:inline-flex">
          <Link href={`/brands/${brand.handle}`} target="_blank">View storefront</Link>
        </Button>
      }
    >
      {children}
    </AppShell>
  )
}
