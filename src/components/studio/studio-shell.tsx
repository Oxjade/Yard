"use client"

import { useMemo, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  ArrowUpRightIcon,
  BellIcon,
  ChartBarIcon,
  StackIcon,
  CalendarDotsIcon,
  GearIcon,
  LayoutIcon,
  MegaphoneIcon,
  PackageIcon,
  PlusIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  SignOutIcon,
  SquaresFourIcon,
  WarehouseIcon,
  StorefrontIcon,
  TagIcon,
  UserIcon,
  UserSwitchIcon,
  UsersIcon,
  WalletIcon,
} from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { DemoAccountMenuBridge, SIGN_OUT_HREF, SWITCH_ACCOUNT_HREF } from "@/components/session/demo-account-menu"
import { Bone } from "@/components/feedback/skeletons"
import { WorkspaceNote } from "@/components/session/workspace-note"
import { AppShell, type ShellNavGroup, type ShellSearch } from "@/components/dashboard/app-shell"
import { PaletteGroup, PaletteItem, matches, queryTerms, topMatches } from "@/components/dashboard/shell/command-palette"
import { orderStatusMeta, productStatusMeta } from "@/components/dashboard/status-badge"
import { buildCustomers } from "@/components/studio/business/model"
import { brandById } from "@/lib/data/brands"
import { teamRoleLabels } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import type { MerchantOrder } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { payoutBalances } from "@/lib/payouts"
import { useAdmin } from "@/lib/stores/admin"
import { useStudio } from "@/lib/stores/studio"

/** True once a persisted store has loaded from this browser, so figures never flash a wrong value. */
function useStoreReady(store: { persist: { onFinishHydration: (fn: () => void) => () => void; hasHydrated: () => boolean } }) {
  return useSyncExternalStore(
    (cb) => store.persist.onFinishHydration(cb),
    () => store.persist.hasHydrated(),
    () => false,
  )
}

/** Command palette records: the brand's products, orders (by reference) and customers. */
function StudioResults({ query, go }: { query: string; go: (href: string) => void }) {
  const products = useStudio((s) => s.products)
  const orders = useStudio((s) => s.orders)
  const brandId = useStudio((s) => s.brandId)
  const currency = brandById.get(brandId)!.currency
  // The Customers page's own derivation, so a result's order count matches the panel it opens.
  const customers = useMemo(() => buildCustomers(orders, currency), [orders, currency])
  if (!query) return null

  // An order found by one of its items says which one, since its title and detail don't show it.
  const terms = queryTerms(query)
  const matchedLine = (x: MerchantOrder) => (matches(query, x.reference, x.shippingAddress.name) ? undefined : x.lines.find((l) => terms.some((t) => l.name.toLowerCase().includes(t)))?.name)

  const p = topMatches(products, query, (x) => x.name, (x) => [x.subcategory, x.category, productStatusMeta[x.status]?.label, ...x.tags])
  const o = topMatches(orders, query, (x) => x.reference, (x) => [x.shippingAddress.name, x.shippingAddress.city, orderStatusMeta[x.status]?.label, ...x.lines.map((l) => l.name)])
  const c = topMatches(customers, query, (x) => x.name, (x) => [x.city])
  return (
    <>
      {p.length ? (
        <PaletteGroup heading="Products">
          {p.map((x) => (
            <PaletteItem key={x.id} value={`product ${x.id}`} icon={PackageIcon} title={x.name} detail={`${productStatusMeta[x.status]?.label ?? x.status}, ${x.subcategory}`} meta={formatMoney(x.price, x.currency)} onSelect={() => go(`/studio/products/${x.id}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {c.length ? (
        <PaletteGroup heading="Customers">
          {c.map((x) => (
            <PaletteItem key={x.id} value={`customer ${x.id}`} icon={UserIcon} title={x.name} detail={`${x.city}, ${x.orderCount} ${x.orderCount === 1 ? "order" : "orders"}`} onSelect={() => go(`/studio/customers?customer=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {o.length ? (
        <PaletteGroup heading="Orders">
          {o.map((x) => {
            const line = matchedLine(x)
            return (
              <PaletteItem
                key={x.id}
                value={`order ${x.id}`}
                icon={ReceiptIcon}
                title={`#${x.reference}`}
                detail={`${x.shippingAddress.name}, ${orderStatusMeta[x.status]?.label ?? x.status}${line ? `, ${line}` : ""}`}
                meta={formatMoney(x.total, x.currency)}
                onSelect={() => go(`/studio/orders/${x.id}`)}
              />
            )
          })}
        </PaletteGroup>
      ) : null}
    </>
  )
}

const search: ShellSearch = {
  placeholder: "Search orders, products, customers",
  destinations: [
    { label: "Add a product", href: "/studio/products/new", icon: PlusIcon, hint: "Catalogue" },
    { label: "Notifications", href: "/studio/notifications", icon: BellIcon },
  ],
  Results: StudioResults,
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

const MISMATCH_NOTE = "Catalogue, orders and payouts still show Lagos Static's sample data in this browser."

/** Brand Studio: the merchant's operating environment. Calm, structured, functional. */
export function StudioShell({ children }: { children: React.ReactNode }) {
  const studioReady = useStoreReady(useStudio)
  const adminReady = useStoreReady(useAdmin)
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const payouts = useAdmin((s) => s.payouts)
  const brand = brandById.get(brandId)!
  // The demo brand session (§2.3). Pages with browser data keep the store's brand; the workspace
  // header follows the session's brand, with a note when the two differ.
  const session = useServerSession()
  const member = session.brand
  // Until /api/session answers, the header shows a neutral mark and "Brand Studio" rather than the
  // browser's sample brand, so it never flips from one brand to another (or its storefront link).
  const checking = session.status === "loading"
  const sessionBrand = member ? brandById.get(member.brand.id) : undefined
  const workspaceBrand = sessionBrand ?? brand
  const mismatch = !!sessionBrand && sessionBrand.id !== brand.id
  const demoOn = !!session.demoAuth?.brand
  // Paid or processing: everything not yet shipped (the To fulfil and Processing tabs together,
  // and the Overview's "Paid, not yet shipped" figure).
  const notShipped = orders.filter((o) => o.status === "paid" || o.status === "processing").length
  // The same derivation as the Payouts page (src/lib/payouts.ts), so the figures always agree.
  const available = useMemo(() => payoutBalances(orders, payouts, brandId, brand.currency).available, [orders, payouts, brandId, brand.currency])
  const ready = studioReady && adminReady
  const amount = formatMoney(available, brand.currency)

  const groups: ShellNavGroup[] = [
    {
      items: [
        { href: "/studio", label: "Overview", icon: SquaresFourIcon },
        { href: "/studio/storefront", label: "Storefront", icon: LayoutIcon },
      ],
    },
    {
      label: "Catalogue",
      items: [
        { href: "/studio/products", label: "Products", icon: PackageIcon },
        { href: "/studio/collections", label: "Collections", icon: StackIcon },
        { href: "/studio/inventory", label: "Inventory", icon: WarehouseIcon },
        { href: "/studio/drops", label: "Drops", icon: CalendarDotsIcon },
      ],
    },
    {
      label: "Growth",
      items: [
        { href: "/studio/campaigns", label: "Promotions", icon: TagIcon },
        { href: "/studio/advertising", label: "Advertising", icon: MegaphoneIcon },
      ],
    },
    {
      label: "Business",
      items: [
        { href: "/studio/orders", label: "Orders", icon: ShoppingCartIcon, badge: studioReady && notShipped ? notShipped : undefined, badgeLabel: "not yet shipped", tone: "attention" },
        { href: "/studio/payouts", label: "Payouts", icon: WalletIcon },
        { href: "/studio/customers", label: "Customers", icon: UsersIcon },
        { href: "/studio/analytics", label: "Analytics", icon: ChartBarIcon },
        { href: "/studio/settings", label: "Settings", icon: GearIcon },
      ],
    },
  ]

  return (
    <AppShell
      surface="studio"
      root="/studio"
      groups={groups}
      search={search}
      workspace={{
        mark: checking ? <Bone className="size-8 rounded-[5px]" /> : <BrandMark brand={workspaceBrand} size="sm" />,
        name: checking ? "Brand Studio" : workspaceBrand.name,
        caption: checking ? "Checking your session" : "Brand Studio",
        label: checking ? "Brand Studio" : `${workspaceBrand.name}, Brand Studio`,
        menu: [
          ...(checking ? [] : [{ label: "View storefront", href: `/brands/${workspaceBrand.handle}`, icon: StorefrontIcon, external: true }]),
          { label: "Edit storefront", href: "/studio/storefront", icon: LayoutIcon },
          { label: "Settings", href: "/studio/settings", icon: GearIcon },
          { label: "Notifications", href: "/studio/notifications", icon: BellIcon },
          ...(demoOn ? [{ label: "Switch demo account…", href: SWITCH_ACCOUNT_HREF, icon: UserSwitchIcon, separated: true }] : []),
          // Signing out never depends on the demo flag: whoever holds a session can always end it.
          ...(member ? [{ label: "Sign out of demo account", href: SIGN_OUT_HREF, icon: SignOutIcon, separated: !demoOn }] : []),
          { label: "Back to the marketplace", href: "/", icon: SignOutIcon, separated: true },
        ],
      }}
      status={{
        icon: WalletIcon,
        label: "Available to pay out",
        value: ready ? amount : null,
        action: available > 0 ? "Request payout" : "View payouts",
        href: "/studio/payouts",
        attention: false,
        dot: available > 0,
        summary: `Available to pay out: ${amount}`,
      }}
      account={
        member
          ? { initials: initialsOf(member.name), name: member.name, caption: `${teamRoleLabels[member.role]}, demo account` }
          : checking
            ? { initials: "", name: "Brand Studio", caption: "Checking your session" }
            : session.status === "error"
              ? { initials: "!", name: "Session unavailable", caption: "Couldn't reach Yard" }
              : { initials: "–", name: "Not signed in", caption: "Sample pages work without signing in" }
      }
      topbar={
        <>
          {mismatch ? <WorkspaceNote text={MISMATCH_NOTE.replace("Lagos Static", brand.name)} label="About this workspace's data" /> : null}
          {checking ? (
            <Bone className="hidden h-10 w-[9.5rem] rounded-full sm:block" />
          ) : (
            <Link
              href={`/brands/${workspaceBrand.handle}`}
              target="_blank"
              rel="noopener"
              className="hidden h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] pr-3.5 pl-4 text-[13px] text-ink-2 transition-colors duration-150 hover:border-white/[0.16] hover:text-ink sm:inline-flex"
            >
              View storefront
              <ArrowUpRightIcon aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
          )}
        </>
      }
    >
      {children}
      <DemoAccountMenuBridge surface="studio" />
    </AppShell>
  )
}

