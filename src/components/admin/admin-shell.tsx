"use client"

import { useMemo, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  PulseIcon,
  SealCheckIcon,
  MoneyIcon,
  FlagIcon,
  SquaresFourIcon,
  SignOutIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  BellIcon,
  ListChecksIcon,
  ReceiptIcon,
  UserIcon,
  WalletIcon,
  HeartbeatIcon,
} from "@phosphor-icons/react"
import { AppShell, type ShellNavGroup, type ShellSearch } from "@/components/dashboard/app-shell"
import { PaletteGroup, PaletteItem, matches, queryTerms, topMatches } from "@/components/dashboard/shell/command-palette"
import { buildOrderRows, type OrderRow } from "@/components/admin/finance/derive"
import { moderationReasonMeta, moderationStatusMeta } from "@/components/admin/marketplace/meta"
import { adminRoles, adminUser, healthServices, type BrandApplication, type Payout, type PlatformUser } from "@/lib/data/admin"
import { categories } from "@/lib/data/catalog"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useOrders } from "@/lib/stores/orders"
import { site } from "@/config/site"
import { cn } from "@/lib/utils"

/** System status pill for the top bar: operational, or how many services are degraded. A static dot: nothing loops for attention. */
function SystemStatus() {
  const degraded = healthServices.filter((s) => s.status !== "operational").length
  return (
    <Link
      href="/admin/health"
      className={cn(
        "hidden h-10 items-center gap-2 rounded-full border px-3.5 text-[12px] transition-colors duration-150 md:inline-flex",
        degraded ? "border-acid/40 text-acid hover:bg-acid/5" : "border-white/[0.08] bg-white/[0.025] text-ink-2 hover:text-ink",
      )}
    >
      <span aria-hidden className={cn("inline-flex size-2 rounded-full", degraded ? "bg-acid" : "bg-violet")} />
      {degraded ? `${degraded} ${degraded === 1 ? "service" : "services"} degraded` : "All systems operational"}
    </Link>
  )
}

const applicationStatus: Record<BrandApplication["status"], string> = { pending_review: "Pending review", verified: "Verified", restricted: "Restricted", suspended: "Suspended" }
const userStatus: Record<PlatformUser["status"], string> = { active: "Active", restricted: "Restricted", suspended: "Suspended" }
const payoutStatus: Record<Payout["status"], string> = { awaiting_approval: "Awaiting approval", scheduled: "Scheduled", processing: "Processing", paid: "Paid", held: "On hold" }

const categoryName = new Map(categories.map((c) => [c.slug as string, c.name]))

/**
 * Command palette records: brands, users, moderation cases, orders (by reference or customer)
 * and payouts. Each opens on its own screen through the URL (?review=, ?case=, ?user=,
 * ?order=, ?focus=), on the page you're on too.
 */
function AdminResults({ query, go }: { query: string; go: (href: string) => void }) {
  const applications = useAdmin((s) => s.applications)
  const users = useAdmin((s) => s.users)
  const payouts = useAdmin((s) => s.payouts)
  const clientOrders = useOrders((s) => s.orders)
  const groups = useOrders((s) => s.groups)
  const refunds = useAdmin((s) => s.refunds)
  const moderation = useAdmin((s) => s.moderation)
  // The Orders page's own rows, so the palette finds what its search finds (checkout reference and email too).
  const orders = useMemo(() => buildOrderRows(clientOrders, groups, refunds), [clientOrders, groups, refunds])
  if (!query) return null

  // An order found by its checkout reference or the customer's email says so in its detail line.
  const terms = queryTerms(query)
  const matchedBy = (r: OrderRow) => {
    if (matches(query, r.order.reference, r.customer.name, r.brand.name)) return ""
    if (terms.some((t) => r.groupRef.toLowerCase().includes(t))) return `, checkout ${r.groupRef}`
    if (terms.some((t) => r.customer.email.toLowerCase().includes(t))) return `, ${r.customer.email}`
    return ""
  }

  const b = topMatches(applications, query, (x) => x.brandName, (x) => [x.handle, x.country, categoryName.get(x.category), applicationStatus[x.status]])
  const m = topMatches(moderation, query, (x) => x.title, (x) => [x.brandName, moderationReasonMeta[x.reason].label, moderationStatusMeta[x.status].label])
  const u = topMatches(users, query, (x) => x.name, (x) => [x.email, x.country, userStatus[x.status]])
  const o = topMatches(orders, query, (x) => x.order.reference, (x) => [x.search])
  const p = topMatches(payouts, query, (x) => x.brandName, (x) => [x.id, payoutStatus[x.status], x.method])
  return (
    <>
      {b.length ? (
        <PaletteGroup heading="Brands">
          {b.map((x) => (
            <PaletteItem key={x.id} value={`brand ${x.id}`} icon={SealCheckIcon} title={x.brandName} detail={`${applicationStatus[x.status]}, ${categoryName.get(x.category) ?? x.category}`} onSelect={() => go(`/admin/brands?review=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {u.length ? (
        <PaletteGroup heading="Users">
          {u.map((x) => (
            <PaletteItem
              key={x.id}
              value={`user ${x.id}`}
              icon={UserIcon}
              title={x.name}
              detail={`${x.email}, ${x.country}, ${x.orders} ${x.orders === 1 ? "order" : "orders"}`}
              meta={userStatus[x.status]}
              onSelect={() => go(`/admin/users?user=${encodeURIComponent(x.id)}`)}
            />
          ))}
        </PaletteGroup>
      ) : null}
      {m.length ? (
        <PaletteGroup heading="Moderation">
          {m.map((x) => (
            <PaletteItem key={x.id} value={`case ${x.id}`} icon={FlagIcon} title={x.title} detail={`${moderationReasonMeta[x.reason].label}, ${x.brandName}`} meta={moderationStatusMeta[x.status].label} onSelect={() => go(`/admin/products?case=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {o.length ? (
        <PaletteGroup heading="Orders">
          {o.map((x) => (
            <PaletteItem key={x.order.id} value={`order ${x.order.id}`} icon={ReceiptIcon} title={`#${x.order.reference}`} detail={`${x.customer.name}, ${x.brand.name}${matchedBy(x)}`} meta={formatMoney(x.totalUsd, "USD")} onSelect={() => go(`/admin/orders?order=${encodeURIComponent(x.order.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {p.length ? (
        <PaletteGroup heading="Payouts">
          {p.map((x) => (
            <PaletteItem key={x.id} value={`payout ${x.id}`} icon={WalletIcon} title={x.brandName} detail={`${payoutStatus[x.status]}, ${x.method}`} meta={formatMoney(x.amountUsd, "USD")} onSelect={() => go(`/admin/finance?tab=payouts&focus=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
    </>
  )
}

const search: ShellSearch = {
  placeholder: "Search brands, users, cases, orders, payouts",
  destinations: [{ label: "Notifications", href: "/admin/notifications", icon: BellIcon }],
  Results: AdminResults,
}

function useAdminReady() {
  return useSyncExternalStore(
    (cb) => useAdmin.persist.onFinishHydration(cb),
    () => useAdmin.persist.hasHydrated(),
    () => false,
  )
}

/** The internal Admin Control Center: a control room — dense, operational, data-first. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const ready = useAdminReady()
  const pendingBrands = useAdmin((s) => s.applications.filter((a) => a.status === "pending_review").length)
  const openModeration = useAdmin((s) => s.moderation.filter((m) => m.status === "open" || m.status === "escalated").length)
  const refunds = useAdmin((s) => s.refunds.filter((r) => r.status === "requested").length)
  const payoutsToApprove = useAdmin((s) => s.payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held").length)
  const inReview = useAdmin((s) => s.campaigns.filter((c) => c.status === "in_review").length)
  // Counts appear once the store has loaded from this browser, so they never flash a stale figure.
  const n = (v: number) => (ready && v > 0 ? v : undefined)
  const decisions = pendingBrands + openModeration + refunds + payoutsToApprove + inReview

  const groups: ShellNavGroup[] = [
    { items: [{ href: "/admin", label: "Overview", icon: SquaresFourIcon }] },
    {
      label: "Marketplace",
      items: [
        { href: "/admin/brands", label: "Brands", icon: SealCheckIcon, badge: n(pendingBrands), badgeLabel: "to review", tone: "attention" },
        { href: "/admin/users", label: "Users", icon: UsersIcon },
        { href: "/admin/products", label: "Moderation", icon: FlagIcon, badge: n(openModeration), badgeLabel: "open or escalated", tone: "attention" },
        { href: "/admin/orders", label: "Orders", icon: ShoppingCartIcon },
      ],
    },
    {
      label: "Money",
      items: [
        { href: "/admin/finance", label: "Finance", icon: MoneyIcon, badge: n(refunds + payoutsToApprove), badgeLabel: "to decide", tone: "attention" },
        { href: "/admin/advertising", label: "Advertising", icon: MegaphoneIcon, badge: n(inReview), badgeLabel: "in review", tone: "attention" },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/admin/health", label: "Health", icon: PulseIcon },
        { href: "/admin/security", label: "Security", icon: ShieldCheckIcon },
      ],
    },
  ]

  const initials = adminUser.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <AppShell
      surface="admin"
      root="/admin"
      density="dense"
      groups={groups}
      search={search}
      workspace={{
        mark: (
          <span className="inline-flex size-8 items-center justify-center rounded-[9px] border border-white/12 bg-obsidian">
            <span className="font-wide text-[13px] leading-none text-ink uppercase">{site.name.charAt(0)}</span>
          </span>
        ),
        // The wordmark is set in capitals by CSS (site.name is sentence case in copy); a four-letter
        // name carries a touch more tracking so it holds the line the way a longer one did.
        name: <span className="font-wide text-[13px] tracking-[0.22em] text-ink uppercase">{site.name}</span>,
        caption: (
          <>
            Control Center
            <span className="rounded-[4px] border border-white/15 px-1 py-px text-[10px] leading-none font-medium text-ink-2">Internal</span>
          </>
        ),
        label: `${site.name} Control Center`,
        menu: [
          { label: "Notifications", href: "/admin/notifications", icon: BellIcon },
          { label: "Security and audit log", href: "/admin/security", icon: ShieldCheckIcon },
          { label: "System health", href: "/admin/health", icon: HeartbeatIcon },
          { label: "Leave the Control Center", href: "/", icon: SignOutIcon, separated: true },
        ],
      }}
      status={{
        icon: ListChecksIcon,
        // Until the store loads, the card shows a skeleton under the usual label; only a cleared
        // queue (known once loaded) relabels it.
        label: ready && decisions === 0 ? "Decision queue" : "Decisions waiting",
        value: ready ? (decisions > 0 ? decisions : "Queue clear") : null,
        quiet: decisions === 0,
        action: decisions > 0 ? "Open the decision queue" : "Nothing needs a decision",
        // The Overview's Decision queue panel carries this anchor; Next scrolls to it, also from /admin itself.
        href: "/admin#decision-queue",
        attention: decisions > 0,
        dot: decisions > 0,
        summary: decisions > 0 ? `${decisions} ${decisions === 1 ? "decision" : "decisions"} waiting` : "Queue clear",
      }}
      account={{ initials, name: adminUser.name, caption: `${adminRoles[adminUser.role].name}, ${adminUser.mfa ? "MFA on" : "MFA off"}` }}
      topbar={<SystemStatus />}
    >
      {children}
    </AppShell>
  )
}
