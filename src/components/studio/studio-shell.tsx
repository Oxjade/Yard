"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BellIcon,
  CalendarXIcon,
  ChartBarIcon,
  ChatsCircleIcon,
  CircleNotchIcon,
  ImagesSquareIcon,
  LightningIcon,
  MapPinIcon,
  MapPinPlusIcon,
  ShareNetworkIcon,
  TruckIcon,
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
  UploadSimpleIcon,
  UserIcon,
  UserSwitchIcon,
  UsersIcon,
  WalletIcon,
  WrenchIcon,
  LifebuoyIcon,
} from "@phosphor-icons/react"
import { useStudioSupport } from "@/components/studio/support/studio-support"
import { BrandMark } from "@/components/market/brand-mark"
import { currencies, type CurrencyCode } from "@/config/markets"
import { DemoAccountMenuBridge, SIGN_OUT_HREF, SWITCH_ACCOUNT_HREF } from "@/components/session/demo-account-menu"
import { Bone } from "@/components/feedback/skeletons"
import { WorkspaceNote } from "@/components/session/workspace-note"
import { AppShell, type ShellNavGroup, type ShellSearch } from "@/components/dashboard/app-shell"
import { PaletteGroup, PaletteItem, matches, queryTerms, topMatches } from "@/components/dashboard/shell/command-palette"
import { orderStatusMeta, productStatusMeta } from "@/components/dashboard/status-badge"
import { CommandItem } from "@/components/ui/command"
import { buildCustomers } from "@/components/studio/business/model"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { endSetupSession } from "@/lib/api/founding"
import type { PayoutSummaryDto } from "@/lib/api/contracts/payouts"
import { brandById } from "@/lib/data/brands"
import { listStudioLocations, STUDIO_LOCATIONS_KEY } from "@/lib/api/around"
import { listStudioConversations } from "@/lib/api/inbox"
import { accountsKey, getAccounts, getStudioPosts, studioPostsKey } from "@/lib/api/social"
import { useApi } from "@/lib/api/use-api"
import { kindLabel } from "@/lib/around/labels"
import { memberRoleLabel, type BrandPermission } from "@/lib/permissions"
import { useUnread } from "@/lib/realtime/unread"
import { useRealtimeEvent, useRealtimeEventName } from "@/lib/realtime/use-realtime"
import { afterIdentityChange } from "@/lib/session/identity"
import { useSampleData, useServerSession } from "@/lib/session/use-server-session"
import type { MerchantOrder } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { payoutBalances, payoutBlockedReason } from "@/lib/payouts"
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

/** The query once it has stopped changing for `ms` (the palette's server records wait for it). */
function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * A Studio link with a #section (the palette's "Holidays & closures" → /studio/shipping#holidays)
 * lands on that section even when it renders only after the page's data loads, where the browser's
 * own jump finds nothing. Once the target appears it is scrolled into view (the page's section nav
 * follows the scroll); a scroll, tap or key press by the merchant first cancels it, and so do 8 s.
 */
function useLateHashTarget() {
  const pathname = usePathname()
  useEffect(() => {
    let id = ""
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      return // a malformed #fragment names nothing
    }
    if (!id || document.getElementById(id)) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const mo = new MutationObserver(() => {
      const el = document.getElementById(id)
      if (!el) return
      stop()
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    })
    const t = window.setTimeout(() => stop(), 8000)
    const cancel = ["wheel", "touchstart", "keydown", "pointerdown"] as const
    function stop() {
      mo.disconnect()
      window.clearTimeout(t)
      for (const ev of cancel) window.removeEventListener(ev, stop)
    }
    mo.observe(document.body, { childList: true, subtree: true })
    for (const ev of cancel) window.addEventListener(ev, stop, { passive: true, once: true })
    return stop
  }, [pathname])
}

/** A row that holds the list while server records load, so "No matches" never flashes first. */
function LoadingRow({ label }: { label: string }) {
  return (
    <CommandItem disabled value="loading" className="gap-3 rounded-xl px-2.5 py-2 text-[13px] text-ink-3 data-[disabled=true]:opacity-100">
      <CircleNotchIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      {label}
    </CommandItem>
  )
}

/**
 * The palette's server records for the signed-in brand (§7.5): conversations (searched by the
 * Inbox's own search), places and social posts. Places and posts are fetched once and filtered
 * here with the query as typed. Conversations are searched on the server 200ms after typing stops;
 * until that answer belongs to the query on screen, no conversation rows show (never an older
 * query's), only the loading row. Only what the member's role can read is asked for.
 */
function StudioServerResults({ query, go }: { query: string; go: (href: string) => void }) {
  const member = useServerSession((s) => s.brand)
  const settled = useDebounced(query, 200)
  const live = query.length >= 2 ? query : ""
  const q = settled.length >= 2 ? settled : ""
  const can = (p: BrandPermission) => !!member?.permissions.includes(p)
  // Yard setup reaches the catalogue, storefront and shipping only: no inbox, places or posts.
  const full = !!member && member.role !== "yard_setup"
  const convKey = full && q && can("inbox.read") ? `/api/studio/inbox/conversations?q=${encodeURIComponent(q)}` : null
  const conv = useApi(convKey, () => listStudioConversations({ q }), { revalidateOnFocus: false, keepPrevious: false })
  const places = useApi(full && live ? STUDIO_LOCATIONS_KEY : null, listStudioLocations, { revalidateOnFocus: false })
  const postsKey = full && live ? studioPostsKey("all", "all") : null
  const posts = useApi(postsKey, getStudioPosts, { revalidateOnFocus: false })
  if (!member || query.length < 2) return null
  const fresh = query === settled
  const waiting = !fresh || (convKey && conv.isLoading) || (places.isLoading && !places.data) || (postsKey && posts.isLoading && !posts.data)

  const c = fresh ? (conv.data?.items ?? []).slice(0, 5) : []
  const l = topMatches(places.data?.locations ?? [], live, (x) => x.name, (x) => [kindLabel[x.kind], x.neighbourhood, x.city])
  const p = topMatches(posts.data?.posts ?? [], live, (x) => x.caption || "Untitled post", (x) => [x.source])
  return (
    <>
      {c.length ? (
        <PaletteGroup heading="Conversations">
          {c.map((x) => (
            <PaletteItem
              key={x.id}
              value={`conversation ${x.id}`}
              icon={ChatsCircleIcon}
              title={x.customer?.name ?? "Customer"}
              detail={x.lastMessage?.preview || "No messages yet"}
              meta={x.status === "resolved" ? "Resolved" : x.unread > 0 || x.markedUnread ? "Unread" : undefined}
              onSelect={() => go(`/studio/inbox?thread=${encodeURIComponent(x.id)}`)}
            />
          ))}
        </PaletteGroup>
      ) : null}
      {l.length ? (
        <PaletteGroup heading="Locations">
          {l.map((x) => (
            <PaletteItem key={x.id} value={`location ${x.id}`} icon={MapPinIcon} title={x.name} detail={`${kindLabel[x.kind]}, ${x.neighbourhood ? `${x.neighbourhood}, ` : ""}${x.city}`} onSelect={() => go(`/studio/locations/edit?id=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {p.length ? (
        <PaletteGroup heading="Posts">
          {p.map((x) => (
            <PaletteItem key={x.id} value={`post ${x.id}`} icon={ImagesSquareIcon} title={x.caption ? x.caption.slice(0, 80) : "Untitled post"} detail={x.moderationStatus === "removed" ? "Removed by Yard" : x.visibility === "published" ? "On your storefront" : x.visibility === "draft" ? "Draft" : "Hidden"} onSelect={() => go(`/studio/social?tab=content&status=${x.moderationStatus === "removed" ? "removed" : x.visibility}&post=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {waiting ? <LoadingRow label="Searching conversations, places and posts…" /> : null}
    </>
  )
}

/** Command palette records: the brand's products, orders (by reference) and customers from this browser, then the server's records. */
function StudioResults({ query, go }: { query: string; go: (href: string) => void }) {
  return (
    <>
      <StudioLocalResults query={query} go={go} />
      <StudioServerResults query={query} go={go} />
    </>
  )
}

function StudioLocalResults({ query, go }: { query: string; go: (href: string) => void }) {
  const products = useStudio((s) => s.products)
  const orders = useStudio((s) => s.orders)
  const brandId = useStudio((s) => s.brandId)
  const currency = brandById.get(brandId)!.currency
  // Customers is a sample-data screen: production has no Customers page, so no customer rows either.
  const sample = useSampleData()
  // The Customers page's own derivation, so a result's order count matches the panel it opens.
  const customers = useMemo(() => (sample ? buildCustomers(orders, currency) : []), [sample, orders, currency])
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
  placeholder: "Search orders, products, customers, conversations",
  destinations: [
    { label: "Add a product", href: "/studio/products/new", icon: PlusIcon, hint: "Catalogue" },
    { label: "Social connections", href: "/studio/social?tab=connections", icon: ShareNetworkIcon, hint: "Brand" },
    { label: "Content Studio", href: "/studio/social?tab=content", icon: ImagesSquareIcon, hint: "Brand" },
    { label: "Upload content", href: "/studio/social?tab=content&upload=1", icon: UploadSimpleIcon, hint: "Brand" },
    { label: "Add a location", href: "/studio/locations/new", icon: MapPinPlusIcon, hint: "Brand" },
    { label: "Quick replies", href: "/studio/inbox?sheet=quick-replies", icon: LightningIcon, hint: "Inbox" },
    { label: "Holidays & closures", href: "/studio/shipping#holidays", icon: CalendarXIcon, hint: "Business" },
    { label: "Notifications", href: "/studio/notifications", icon: BellIcon },
  ],
  Results: StudioResults,
}

/**
 * Yard setup (founding brands): Yard staff setting up an unclaimed brand before its owner claims
 * it. The server allows the catalogue, storefront, shipping and uploads only (route() allow-list),
 * so the workspace offers just those pages and sends anything else to Products.
 */
const YARD_SETUP_PAGES = ["/studio/products", "/studio/inventory", "/studio/collections", "/studio/storefront", "/studio/shipping"]
const yardSetupAllows = (pathname: string) => YARD_SETUP_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
const yardSetupSearch: ShellSearch = {
  ...search,
  placeholder: "Search products",
  destinations: [
    { label: "Add a product", href: "/studio/products/new", icon: PlusIcon, hint: "Catalogue" },
    { label: "Holidays & closures", href: "/studio/shipping#holidays", icon: CalendarXIcon, hint: "Shipping" },
  ],
}
const yardSetupGroups: ShellNavGroup[] = [
  {
    label: "Catalogue",
    items: [
      { href: "/studio/products", label: "Products", icon: PackageIcon },
      { href: "/studio/collections", label: "Collections", icon: StackIcon },
      { href: "/studio/inventory", label: "Inventory", icon: WarehouseIcon },
    ],
  },
  {
    label: "Brand",
    items: [
      { href: "/studio/storefront", label: "Storefront", icon: LayoutIcon },
      { href: "/studio/shipping", label: "Shipping & fulfilment", icon: TruckIcon },
      { href: "/studio/locations", label: "Locations", icon: MapPinIcon },
    ],
  },
]

/** The Yard setup notice over every Studio page: whose brand this is, and the way back. */
function YardSetupBanner({ brandId, brandName }: { brandId: string; brandName: string }) {
  const router = useRouter()
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const back = `/admin/brands?tab=founding&brand=${encodeURIComponent(brandId)}`
  async function end() {
    setEnding(true)
    setError(null)
    try {
      await endSetupSession(brandId)
      await afterIdentityChange("studio")
      router.push(back)
    } catch (cause) {
      setError(errorMessage(cause, "Yard setup couldn't be ended. Try again."))
      setEnding(false)
    }
  }
  return (
    <div role="region" aria-label="Yard setup" className="mb-4 grid gap-3 rounded-xl border border-violet/40 bg-violet/[0.08] p-3 sm:flex sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-violet/40 text-violet">
          <WrenchIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-ink">Yard setup: {brandName}</p>
          <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-2">
            You&apos;re preparing this founding brand for its owner as Yard staff. Products, photos, collections, storefront and shipping only; every change is recorded under your name. It ends when the owner claims the brand, or after 8 hours.
          </p>
          {error ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        <Button asChild size="sm" variant="secondary" className="h-10 sm:h-9">
          <Link href={back}>
            <ArrowLeftIcon /> Back to Control Center
          </Link>
        </Button>
        <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-9" loading={ending} disabled={ending} onClick={() => void end()}>
          End setup
        </Button>
      </div>
    </div>
  )
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
  useLateHashTarget()
  const pathname = usePathname()
  const router = useRouter()
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
  // A brand that joined through onboarding isn't in the sample map: the header shows its own name,
  // mark and storefront, never the sample brand's.
  const workspaceBrand = useMemo(
    () => sessionBrand ?? (member ? { ...brand, id: member.brand.id, name: member.brand.name, handle: member.brand.handle, mark: { text: member.brand.name.slice(0, 2).toUpperCase(), style: "condensed" as const }, logoSrc: member.brand.logoSrc ?? null } : brand),
    [sessionBrand, member, brand],
  )
  const mismatch = !!sessionBrand && sessionBrand.id !== brand.id
  const yardSetup = member?.role === "yard_setup"
  // Yard setup on a page outside its reach: straight to Products (the server would refuse the page's reads).
  const offLimits = yardSetup && !yardSetupAllows(pathname)
  useEffect(() => {
    if (offLimits) router.replace("/studio/products")
  }, [offLimits, router])
  const demoOn = !!session.demoAuth?.brand
  const sampleData = session.sampleData === true
  // Signed out with the sample data off (production): there is no workspace brand to show, never
  // the browser's sample brand or a link to its storefront. The header stays neutral, as while checking.
  const neutral = checking || (!member && !sampleData)
  // Paid or processing: everything not yet shipped (the To fulfil and Processing tabs together,
  // and the Overview's "Paid, not yet shipped" figure).
  // The browser's sample orders belong to the sample brand; a brand that isn't in the sample gets no count from them.
  // Production has no sample orders at all (the demo switch is off), so nothing is counted from them.
  const notShipped = !sampleData || (member && !sessionBrand) ? 0 : orders.filter((o) => o.status === "paid" || o.status === "processing").length
  // A real brand's card reads the ledger, the same summary the Payouts page uses. The demo brand
  // keeps the browser sample, so both never disagree on screen.
  const liveBrand = member && !member.demo ? member.brand.id : null
  // Only owners, admins and finance can read payouts (the server's finance view roles); other team
  // roles get no payout card rather than a request that always answers 403.
  const financeView = !!member && (member.role === "owner" || member.role === "admin" || member.role === "finance")
  const livePayouts = useApi<PayoutSummaryDto>(liveBrand && financeView ? `studio.payouts:${liveBrand}` : null, () => api<PayoutSummaryDto>("/api/studio/payouts"), { revalidateOnFocus: true })
  useRealtimeEventName("payout.updated", () => {
    if (liveBrand && financeView) void livePayouts.revalidate()
  })
  // Only the balance in the payout currency counts: another currency's figure would show under the wrong label.
  const liveBalance = livePayouts.data?.balances.find((b) => b.currency === livePayouts.data?.currency)
  const demoAvailable = useMemo(() => payoutBalances(orders, payouts, brandId, brand.currency).available, [orders, payouts, brandId, brand.currency])
  const available = liveBrand ? Math.max(0, liveBalance?.availableMinor ?? 0) : demoAvailable
  const currency = livePayouts.data?.currency
  const cur: CurrencyCode = currency && currency in currencies ? (currency as CurrencyCode) : brand.currency
  const ready = liveBrand ? !!livePayouts.data : studioReady && adminReady
  // A failed read resolves the card (no endless placeholder); the Payouts page shows the error and a retry.
  const payoutsFailed = !!liveBrand && !livePayouts.data && !!livePayouts.error
  const otherCurrencyEarnings = liveBrand && !liveBalance ? (livePayouts.data?.balances.find((b) => b.availableMinor > 0 || b.pendingMinor > 0)?.currency ?? null) : null
  const payoutReason = liveBrand && financeView ? payoutBlockedReason({
    hasSummary: !!livePayouts.data,
    failed: !!livePayouts.error,
    onHold: livePayouts.data?.rules.onHold ?? false,
    holdReason: livePayouts.data?.rules.holdReason ?? null,
    hasAccount: !!livePayouts.data?.account,
    cooldownUntil: livePayouts.data?.rules.cooldownUntil ?? null,
    otherCurrency: otherCurrencyEarnings,
    availableMinor: liveBalance?.availableMinor ?? 0,
    minimumMinor: livePayouts.data?.rules.minPayoutMinor ?? 0,
    currency: cur,
  }) : null
  const amount = formatMoney(available, cur)

  // Live counts for the signed-in brand: unread conversations (the realtime provider keeps the
  // Studio unread store current) and social accounts that need reconnecting. Unknown or zero
  // shows no badge.
  const studioUnread = useUnread("studio")
  const inboxBadge = member && studioUnread ? studioUnread : undefined
  const social = useApi(member && !yardSetup ? accountsKey : null, getAccounts, { revalidateOnFocus: false })
  useRealtimeEvent("social.status", () => void social.revalidate())
  const reconnect = member ? (social.data?.accounts.filter((a) => a.status === "needs_reauth" || a.status === "error").length ?? 0) : 0
  // Yard Support: the brand's thread with the Yard team; its unread replies badge the item.
  const support = useStudioSupport(!!member && !yardSetup)
  const supportUnread = support.data?.conversation?.unread ?? 0

  // §7.5: 17 items in 5 groups. The daily-work items with badges sit at the top; Social holds the
  // owner's "Social connections" and "Content Studio" as its two tabs (§7.8 decision 1).
  const groups: ShellNavGroup[] = [
    {
      items: [
        { href: "/studio", label: "Overview", icon: SquaresFourIcon },
        { href: "/studio/inbox", label: "Inbox", icon: ChatsCircleIcon, badge: inboxBadge, badgeLabel: "unread", tone: "attention" },
        { href: "/studio/orders", label: "Orders", icon: ShoppingCartIcon, badge: studioReady && notShipped ? notShipped : undefined, badgeLabel: "not yet shipped", tone: "attention" },
      ],
    },
    {
      label: "Brand",
      items: [
        { href: "/studio/storefront", label: "Storefront", icon: LayoutIcon },
        { href: "/studio/social", label: "Social", icon: ShareNetworkIcon, badge: reconnect || undefined, badgeLabel: "to reconnect", tone: "attention" },
        { href: "/studio/locations", label: "Locations", icon: MapPinIcon },
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
    // Promotions, Advertising, Customers and Analytics have only sample data so far: they show in
    // demo and development only (production serves them as "coming soon", src/proxy.ts). Until the
    // session says which, they stay hidden, so production never flashes them.
    ...(sampleData
      ? [
          {
            label: "Growth",
            items: [
              { href: "/studio/campaigns", label: "Promotions", icon: TagIcon },
              { href: "/studio/advertising", label: "Advertising", icon: MegaphoneIcon },
            ],
          },
        ]
      : []),
    {
      label: "Business",
      items: [
        { href: "/studio/shipping", label: "Shipping & fulfilment", icon: TruckIcon },
        { href: "/studio/payouts", label: "Payouts", icon: WalletIcon },
        ...(sampleData
          ? [
              { href: "/studio/customers", label: "Customers", icon: UsersIcon },
              { href: "/studio/analytics", label: "Analytics", icon: ChartBarIcon },
            ]
          : []),
        { href: "/studio/settings", label: "Settings", icon: GearIcon },
        { href: "/studio/support", label: "Yard Support", icon: LifebuoyIcon, badge: supportUnread || undefined, badgeLabel: "unread", tone: "attention" },
      ],
    },
  ]

  return (
    <AppShell
      surface="studio"
      root={yardSetup ? "/studio/products" : "/studio"}
      groups={yardSetup ? yardSetupGroups : groups}
      search={yardSetup ? yardSetupSearch : search}
      workspace={{
        mark: checking ? <Bone className="size-8 rounded-[5px]" /> : neutral ? <BrandMark brand={{ name: "Yard", mark: { text: "Y", style: "condensed" } }} size="sm" /> : <BrandMark brand={workspaceBrand} size="sm" />,
        name: neutral ? "Brand Studio" : workspaceBrand.name,
        caption: checking ? "Checking your session" : neutral ? "Sign in to continue" : "Brand Studio",
        label: neutral ? "Brand Studio" : `${workspaceBrand.name}, Brand Studio`,
        menu: yardSetup && member ? [
          { label: "Edit storefront", href: "/studio/storefront", icon: LayoutIcon },
          { label: "Back to Control Center", href: `/admin/brands?tab=founding&brand=${encodeURIComponent(member.brand.id)}`, icon: ArrowLeftIcon, separated: true },
        ] : [
          ...(neutral ? [] : [{ label: "View storefront", href: `/brands/${workspaceBrand.handle}`, icon: StorefrontIcon, external: true }]),
          { label: "Edit storefront", href: "/studio/storefront", icon: LayoutIcon },
          { label: "Settings", href: "/studio/settings", icon: GearIcon },
          { label: "Notifications", href: "/studio/notifications", icon: BellIcon },
          { label: "Contact Yard Support", href: "/studio/support", icon: LifebuoyIcon },
          ...(demoOn ? [{ label: "Switch demo account…", href: SWITCH_ACCOUNT_HREF, icon: UserSwitchIcon, separated: true }] : []),
          // Signing out never depends on the demo flag: whoever holds a session can always end it.
          ...(member ? [{ label: member.demo ? "Sign out of demo account" : "Sign out", href: SIGN_OUT_HREF, icon: SignOutIcon, separated: !demoOn }] : []),
          { label: "Back to the marketplace", href: "/", icon: SignOutIcon, separated: true },
        ],
      }}
      status={
        // A real brand's card reads the ledger; the browser's sample balance shows in demo and development only.
        (liveBrand && !financeView) || (!liveBrand && !sampleData)
          ? undefined
          : payoutsFailed
            ? {
                icon: WalletIcon,
                label: "Available to pay out",
                value: "Unavailable",
                quiet: true,
                action: "View payouts",
                href: "/studio/payouts",
                attention: false,
                dot: false,
                summary: "Available to pay out: couldn't load",
              }
            : {
                icon: WalletIcon,
                label: "Available to pay out",
                value: ready ? amount : null,
                action: available > 0 && !payoutReason ? "Request payout" : "View payouts",
                href: "/studio/payouts",
                attention: false,
                dot: available > 0 && !payoutReason,
                summary: payoutReason ? `${payoutReason} Available to pay out: ${amount}` : `Available to pay out: ${amount}`,
              }
      }
      account={
        member
          ? { initials: initialsOf(member.name), name: member.name, caption: member.demo ? `${memberRoleLabel(member.role)}, demo account` : memberRoleLabel(member.role) }
          : checking
            ? { initials: "", name: "Brand Studio", caption: "Checking your session" }
            : session.status === "error"
              ? { initials: "!", name: "Session unavailable", caption: "Couldn't reach Yard" }
              : { initials: "–", name: "Not signed in", caption: sampleData ? "Sample pages work without signing in" : "Sign in to use Brand Studio" }
      }
      topbar={
        <>
          {mismatch ? <WorkspaceNote text={MISMATCH_NOTE.replace("Lagos Static", brand.name)} label="About this workspace's data" /> : null}
          {checking ? (
            <Bone className="hidden h-10 w-[9.5rem] rounded-full sm:block" />
          ) : yardSetup || neutral ? null : (
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
      {yardSetup && member ? <YardSetupBanner brandId={member.brand.id} brandName={member.brand.name} /> : null}
      {offLimits ? (
        <p role="status" className="py-10 text-center text-sm text-ink-2">
          Yard setup covers products, collections, inventory, storefront and shipping. Opening Products…
        </p>
      ) : (
        children
      )}
      <DemoAccountMenuBridge surface="studio" />
    </AppShell>
  )
}

