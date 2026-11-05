"use client"

import Link from "next/link"
import { PulseIcon as Activity, SealCheckIcon as BadgeCheck, MoneyIcon as Banknote, FlagIcon as Flag, SquaresFourIcon as LayoutDashboard, SignOutIcon as LogOut, MegaphoneIcon as Megaphone, ShieldCheckIcon as ShieldCheck, ShoppingCartIcon as ShoppingCart, UsersIcon as Users } from "@phosphor-icons/react"
import { AppShell, type ShellNavGroup } from "@/components/dashboard/app-shell"
import { useHydrated } from "@/hooks/use-hydrated"
import { adminRoles, adminUser, healthServices } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { site } from "@/config/site"
import { cn } from "@/lib/utils"

/** System status pill for the top bar: operational, or how many services are degraded. */
function SystemStatus() {
  const degraded = healthServices.filter((s) => s.status !== "operational").length
  return (
    <Link
      href="/admin/health"
      className={cn(
        "hidden h-8 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors md:inline-flex",
        degraded ? "border-acid/40 text-acid hover:bg-acid/5" : "border-[var(--admin-hairline-strong)] text-ink-2 hover:text-ink",
      )}
    >
      <span className="relative flex size-2">
        {degraded ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-acid/70" /> : null}
        <span className={cn("relative inline-flex size-2 rounded-full", degraded ? "bg-acid" : "bg-violet")} />
      </span>
      {degraded ? `${degraded} service degraded` : "All systems operational"}
    </Link>
  )
}

/** The internal Admin Control Center: a control room — dense, operational, data-first. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated()
  const pendingBrands = useAdmin((s) => s.applications.filter((a) => a.status === "pending_review").length)
  const openModeration = useAdmin((s) => s.moderation.filter((m) => m.status === "open" || m.status === "escalated").length)
  const refunds = useAdmin((s) => s.refunds.filter((r) => r.status === "requested").length)
  const payoutsToApprove = useAdmin((s) => s.payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held").length)
  const inReview = useAdmin((s) => s.campaigns.filter((c) => c.status === "in_review").length)
  const n = (v: number) => (hydrated && v > 0 ? v : undefined)

  const groups: ShellNavGroup[] = [
    { items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard }] },
    {
      label: "Marketplace",
      items: [
        { href: "/admin/brands", label: "Brands", icon: BadgeCheck, badge: n(pendingBrands) },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/products", label: "Moderation", icon: Flag, badge: n(openModeration) },
        { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
      ],
    },
    {
      label: "Money",
      items: [
        { href: "/admin/finance", label: "Finance", icon: Banknote, badge: n(refunds + payoutsToApprove) },
        { href: "/admin/advertising", label: "Advertising", icon: Megaphone, badge: n(inReview) },
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
        <div className="flex items-center justify-between gap-2 px-1 py-1.5">
          <div className="min-w-0">
            <p className="font-wide chrome-text truncate text-[13px] tracking-[0.16em]">{site.name}</p>
            <p className="font-label mt-1.5 text-[11px] text-ink-3">Control Center</p>
          </div>
          <span className="rounded-[5px] border border-acid/40 px-1.5 py-0.5 text-[10px] font-medium text-acid">Internal</span>
        </div>
      }
      footer={
        <div className="flex items-center gap-2.5 px-1">
          <span className="relative inline-flex size-8 items-center justify-center rounded-full bg-purple text-[11px] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            KA
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-[#0a0a0a] bg-violet" aria-label="Online" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-ink">{adminUser.name}</p>
            <p className="truncate text-[11px] text-ink-3">{adminRoles[adminUser.role].name}, MFA on</p>
          </div>
          <Link href="/" aria-label="Leave the Control Center" className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/5 hover:text-ink">
            <LogOut className="size-3.5" />
          </Link>
        </div>
      }
      topbar={<SystemStatus />}
    >
      {children}
    </AppShell>
  )
}
