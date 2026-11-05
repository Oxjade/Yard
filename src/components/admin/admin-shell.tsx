"use client"

import Link from "next/link"
import { Activity, BadgeCheck, Banknote, Flag, LayoutDashboard, Megaphone, Package, ShieldCheck, ShoppingCart, Users } from "lucide-react"
import { AppShell, type ShellNavGroup } from "@/components/dashboard/app-shell"
import { adminRoles, adminUser, brandApplications, moderationQueue, refunds } from "@/lib/data/admin"
import { campaigns } from "@/lib/data/ads"
import { site } from "@/config/site"

/** The internal Admin Control Center: dense, operational, data-first. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const groups: ShellNavGroup[] = [
    { items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard }] },
    {
      label: "Marketplace",
      items: [
        { href: "/admin/brands", label: "Brands", icon: BadgeCheck, badge: brandApplications.filter((a) => a.status === "pending_review").length },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/products", label: "Moderation", icon: Flag, badge: moderationQueue.filter((m) => m.status === "open" || m.status === "escalated").length },
        { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
      ],
    },
    {
      label: "Money",
      items: [
        { href: "/admin/finance", label: "Finance", icon: Banknote, badge: refunds.filter((r) => r.status === "requested").length || undefined },
        { href: "/admin/advertising", label: "Advertising", icon: Megaphone, badge: campaigns.filter((c) => c.status === "in_review").length || undefined },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/admin/health", label: "Health", icon: Activity },
        { href: "/admin/security", label: "Security", icon: ShieldCheck },
      ],
    },
  ]

  return (
    <AppShell
      surface="admin"
      root="/admin"
      density="dense"
      groups={groups}
      header={
        <div className="flex items-center justify-between gap-2 p-1">
          <div className="min-w-0">
            <p className="font-wide chrome-text truncate text-[13px] tracking-[0.14em]">{site.name}</p>
            <p className="mt-1 text-[11px] text-ink-3">Control Center</p>
          </div>
          <span className="rounded-[4px] border border-acid/30 bg-acid/10 px-1.5 py-0.5 text-[10px] font-medium text-acid">Internal</span>
        </div>
      }
      footer={
        <div className="flex items-center gap-2.5 px-1.5">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-elevated text-[11px] font-semibold">KA</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink">{adminUser.name}</p>
            <p className="truncate text-[11px] text-ink-3">{adminRoles[adminUser.role].name}, MFA on</p>
          </div>
          <Link href="/" className="text-[11px] text-ink-3 hover:text-ink">Exit</Link>
        </div>
      }
      topbar={<span className="hidden text-xs text-ink-3 md:inline">Production view, development data</span>}
    >
      {children}
    </AppShell>
  )
}
